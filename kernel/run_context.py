"""How user code runs inside a run worker (design note sections 2.6, 2.12, 2.13).

``WorkerRuntime`` lives in a pooled worker process (``run_worker_main``).  It executes the
researcher's program as a real ``__main__`` module with the project as working directory and
``sys.path`` head, hides Nuclei's own ``kernel`` package while the program runs (so a sibling
``kernel.py`` / ``noise.py`` / ``models.py`` wins), records the project files the program reads
(cache dependencies), and then restores every piece of process state it touched so the preview
worker can be reused.

Outside a worker this module only provides the in-process tripwire: the server process must
never execute user code itself (:func:`forbid_inprocess_exec`).
"""

from __future__ import annotations

import builtins
import importlib.abc
import importlib.machinery
import linecache
import logging
import os
import random
import shutil
import sys
import tempfile
import threading
import time
import traceback
import types
import warnings
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator

from kernel import run_cache, run_figures
from kernel.run_cache import LoadedProgram

CPU_HEADROOM_SECONDS = 60
UNSAVED_FILENAME = "<nuclei>"
FIGURE_OPS = frozenset({"execute", "run_python"})
INPUT_MESSAGE = "interactive input() is not supported in Nuclei runs; use params or read a file"


# ----------------------------------------------------------------------- tripwire


class InProcessExecForbidden(RuntimeError):
    """User code was about to run inside the kernel server process (design note D12)."""


_forbidden = False
_runtime: "WorkerRuntime | None" = None


def forbid_inprocess_exec() -> None:
    global _forbidden
    _forbidden = True


def allow_inprocess_exec() -> None:
    global _forbidden
    _forbidden = False


def inprocess_exec_forbidden() -> bool:
    return _forbidden and _runtime is None


def assert_inprocess_exec_allowed(what: str) -> None:
    if inprocess_exec_forbidden():
        raise InProcessExecForbidden(
            f"{what} would execute user code inside the kernel server process; route it through the run-worker pool."
        )


def current() -> "WorkerRuntime | None":
    return _runtime


def in_worker() -> bool:
    return _runtime is not None


# ------------------------------------------------------------------- errors / text


def error_dict(code: str, message: str, tb: str | None = None, **extra: Any) -> dict:
    out: dict[str, Any] = {"code": code, "message": message}
    if tb:
        out["traceback"] = tb
    out.update(extra)
    return out


def short_message(text: str) -> str:
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    return lines[-1] if lines else "Execution failed."


def user_traceback(exc: BaseException, kernel_dir: str) -> str:
    """The traceback with Nuclei's own frames dropped (the user sees only their program)."""
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if not f.filename.startswith(kernel_dir)]
    lines = ["Traceback (most recent call last):\n"] if frames else []
    lines.extend(traceback.format_list(frames))
    lines.extend(traceback.format_exception_only(type(exc), exc))
    return "".join(lines)


# ------------------------------------------------------------------ module finder


class NucleiKernelFinder(importlib.abc.MetaPathFinder):
    """Serves ``kernel`` and ``kernel.*`` from the repo, but only outside the user context."""

    def __init__(self, repo_root: str):
        self.repo_root = repo_root
        self.active = True

    def find_spec(self, fullname, path=None, target=None):
        if not self.active or not (fullname == "kernel" or fullname.startswith("kernel.")):
            return None
        search = [self.repo_root] if fullname == "kernel" else path
        return importlib.machinery.PathFinder.find_spec(fullname, search)


def _is_kernel_module(name: str) -> bool:
    return name == "kernel" or name.startswith("kernel.")


# ------------------------------------------------------------- dependency recorder


class DepRecorder:
    """Project files and directories read while the user program runs."""

    def __init__(self, root: str | None, ignore: tuple[str, ...]):
        self.root = root
        self.ignore = ignore
        self.files: dict[str, str] = {}
        self.overflow = False

    def add(self, path: object, kind: str) -> None:
        if self.root is None or not isinstance(path, (str, bytes, os.PathLike)):
            return
        try:
            full = os.path.abspath(os.fsdecode(path))
        except (TypeError, ValueError):
            return
        if not (full == self.root or full.startswith(self.root + os.sep)):
            return
        if any(full.startswith(prefix) for prefix in self.ignore):
            return
        if full not in self.files:
            if len(self.files) >= run_cache.MAX_DEPS:
                self.overflow = True
                return
            self.files[full] = kind

    def deps(self) -> tuple[run_cache.Dep, ...]:
        return tuple(run_cache.stat_dep(path, kind) for path, kind in self.files.items())


_recorder: DepRecorder | None = None
_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC


def _audit(event: str, args: tuple) -> None:
    recorder = _recorder
    if recorder is None:
        return
    if event == "open":
        path, mode, flags = args
        if isinstance(mode, str) and any(c in mode for c in "wax+"):
            return
        if isinstance(flags, int) and flags & _WRITE_FLAGS:
            return
        recorder.add(path, "file")
    elif event in ("os.listdir", "os.scandir"):
        recorder.add(args[0] if args and args[0] is not None else os.getcwd(), "dir")
    elif event == "glob.glob":
        pattern = os.fsdecode(args[0])
        recorder.add(os.path.dirname(pattern) or os.getcwd(), "dir")


def install_audit_hook() -> None:
    sys.addaudithook(_audit)


# ---------------------------------------------------------------------- baseline


def _count_fds() -> int:
    for fd_dir in ("/proc/self/fd", "/dev/fd"):
        try:
            return len(os.listdir(fd_dir))
        except OSError:
            continue
    return 0


class Baseline:
    """Process state captured once at worker start and restored after every request."""

    def __init__(self) -> None:
        self.modules = frozenset(sys.modules)
        self.environ = dict(os.environ)
        self.builtins = dict(vars(builtins))
        self.streams = (sys.stdin, sys.stdout, sys.stderr)
        self.hooks = (sys.displayhook, sys.excepthook, sys.breakpointhook)
        self.recursion = sys.getrecursionlimit()
        self.warn_filters = list(warnings.filters)
        self.showwarning = warnings.showwarning
        self.log = (list(logging.root.handlers), logging.root.level, logging.root.manager.disable)
        self.meta_path = list(sys.meta_path)
        self.path_hooks = list(sys.path_hooks)
        self.argv = list(sys.argv)
        self.main = sys.modules.get("__main__")
        self.gc_enabled = __import__("gc").isenabled()
        self.trace = (sys.gettrace(), sys.getprofile())
        self.threads = threading.active_count()
        self.fds = _count_fds()
        self.umask = os.umask(0o077)
        os.umask(self.umask)
        self.signals = self._signals()
        self.numpy = self._numpy()
        self.mpl = self._mpl()

    @staticmethod
    def _signals() -> dict:
        import signal

        names = ("SIGINT", "SIGTERM", "SIGALRM", "SIGXCPU", "SIGUSR1", "SIGUSR2")
        return {getattr(signal, n): signal.getsignal(getattr(signal, n)) for n in names if hasattr(signal, n)}

    @staticmethod
    def _numpy() -> tuple | None:
        np = sys.modules.get("numpy")
        return None if np is None else (np.geterr(), np.get_printoptions())

    @staticmethod
    def _mpl() -> dict | None:
        mpl = sys.modules.get("matplotlib")
        return None if mpl is None else dict(mpl.rcParams)

    def restore(self) -> list[str]:
        """Put everything back; returns the names of the steps that failed."""
        failed: list[str] = []
        for name, step in (
            ("environ", self._environ), ("builtins", self._builtins), ("streams", self._streams),
            ("hooks", self._hooks), ("warnings", self._warnings), ("logging", self._logging),
            ("importers", self._importers), ("signals", self._restore_signals), ("process", self._process),
            ("numpy", self._restore_numpy), ("matplotlib", self._restore_mpl), ("random", self._random),
        ):
            try:
                step()
            except Exception:  # noqa: BLE001 - a failed step only marks the worker dirty
                failed.append(name)
        return failed

    def _environ(self) -> None:
        os.environ.clear()
        os.environ.update(self.environ)

    def _builtins(self) -> None:
        live = vars(builtins)
        for key in [k for k in live if k not in self.builtins]:
            del live[key]
        live.update(self.builtins)

    def _streams(self) -> None:
        sys.stdin, sys.stdout, sys.stderr = self.streams

    def _hooks(self) -> None:
        sys.displayhook, sys.excepthook, sys.breakpointhook = self.hooks
        sys.setrecursionlimit(self.recursion)
        sys.settrace(self.trace[0])
        sys.setprofile(self.trace[1])
        threading.settrace(None)
        threading.setprofile(None)

    def _warnings(self) -> None:
        warnings.filters[:] = self.warn_filters
        warnings.showwarning = self.showwarning
        warnings._filters_mutated()  # type: ignore[attr-defined]

    def _logging(self) -> None:
        handlers, level, disable = self.log
        logging.root.handlers[:] = handlers
        logging.root.setLevel(level)
        logging.disable(disable)

    def _importers(self) -> None:
        sys.meta_path[:] = self.meta_path
        sys.path_hooks[:] = self.path_hooks
        sys.path_importer_cache.clear()
        sys.argv = list(self.argv)

    def _restore_signals(self) -> None:
        import signal

        if hasattr(signal, "alarm"):
            signal.alarm(0)
        for number, handler in self.signals.items():
            if signal.getsignal(number) is not handler:
                signal.signal(number, handler)

    def _process(self) -> None:
        os.umask(self.umask)
        import atexit
        import gc

        atexit._clear()
        if self.gc_enabled:
            gc.enable()

    def _restore_numpy(self) -> None:
        np = sys.modules.get("numpy")
        if np is None or self.numpy is None:
            return
        np.seterr(**self.numpy[0])
        np.set_printoptions(**self.numpy[1])
        np.random.seed(None)

    def _restore_mpl(self) -> None:
        mpl = sys.modules.get("matplotlib")
        if mpl is None or self.mpl is None:
            return
        pyplot = sys.modules.get("matplotlib.pyplot")
        if pyplot is not None:
            pyplot.close("all")
        for key, value in self.mpl.items():
            try:
                if mpl.rcParams[key] != value:
                    mpl.rcParams[key] = value
            except Exception:  # noqa: BLE001 - array-valued or deprecated keys
                continue

    def _random(self) -> None:
        random.seed()


# ----------------------------------------------------------------------- runtime


@dataclass(frozen=True)
class RequestState:
    op: str = ""
    run_id: str = ""
    language: str | None = None
    project_root: str | None = None
    file_path: str | None = None
    run_dir: str | None = None
    params: dict = field(default_factory=dict)
    seed: int | None = None
    cache: str = "none"  # "use" (read + write) | "bypass" (write only) | "none"
    cpu_s: int | None = None
    figures: bool = False  # render open matplotlib figures to PNG after the program runs

    @staticmethod
    def from_wire(op: str, run_id: str, ctx: dict) -> "RequestState":
        limits = ctx.get("limits") or {}
        return RequestState(
            op=op, run_id=run_id, language=ctx.get("language"), project_root=ctx.get("project_root"),
            file_path=ctx.get("file_path"), run_dir=ctx.get("run_dir"), params=dict(ctx.get("params") or {}),
            seed=ctx.get("seed"), cache=ctx.get("cache", "none"), cpu_s=limits.get("cpu_s"),
            figures=bool(ctx.get("figures", op in FIGURE_OPS)),
        )


@dataclass
class RequestStats:
    exec_ms: float = 0.0
    exec_count: int = 0
    cache: str = "none"  # "hit" | "miss" | "static" | "none"


class WorkerRuntime:
    """Executes user programs inside one worker process."""

    def __init__(self, repo_root: str, base_sys_path: list[str], lane: str, scratch_root: str | None = None):
        self.repo_root = repo_root
        self.kernel_dir = os.path.join(repo_root, "kernel") + os.sep
        self.base_sys_path = list(base_sys_path)
        self.lane = lane
        self.scratch_root = scratch_root or tempfile.mkdtemp(prefix="nuclei-worker-")
        self.cache = run_cache.ProgramCache()
        self.finder = NucleiKernelFinder(repo_root)
        self.baseline: Baseline | None = None
        self.request: RequestState | None = None
        self.stats = RequestStats()
        self.served = 0
        self.dirty: list[str] = []
        self.metrics: dict[str, float] = {}
        self._scratch: str | None = None
        self._in_user = False
        self._mp_main_path: str | None = None

    # -- lifecycle ---------------------------------------------------------

    def install(self) -> None:
        global _runtime
        _runtime = self
        sys.meta_path.insert(0, self.finder)
        install_audit_hook()
        self._wrap_multiprocessing()
        # Imported project siblings must never leave stale bytecode behind: an edit within the same
        # second and size as the cached .pyc would otherwise keep serving the old module.
        sys.dont_write_bytecode = True
        self.baseline = Baseline()
        os.chdir(self.scratch_root)

    def begin(self, request: RequestState) -> None:
        self.request = request
        self.stats = RequestStats()
        self.metrics = {}
        self._scratch = tempfile.mkdtemp(dir=self.scratch_root)
        self.served += 1

    def end(self) -> list[str]:
        """Finish a request; returns reasons this worker should not be reused (empty = clean)."""
        scratch, self._scratch, self.request = self._scratch, None, None
        if scratch:
            shutil.rmtree(scratch, ignore_errors=True)
        return self.dirty_reasons()

    def dirty_reasons(self) -> list[str]:
        base = self.baseline
        reasons = list(self.dirty)
        if base is not None:
            if threading.active_count() > base.threads:
                reasons.append("threads")
            if _count_fds() > base.fds + 64:
                reasons.append("fds")
        return reasons

    # -- user context ------------------------------------------------------

    def _spawn_path_for(self, code: str, filename: str, root: str) -> str:
        """For multiprocessing spawn children: a file holding exactly the code being run."""
        if filename != UNSAVED_FILENAME:
            try:
                with open(filename, encoding="utf-8") as handle:
                    if handle.read() == code:
                        return filename
            except OSError:
                pass
        stem = os.path.splitext(os.path.basename(filename))[0] if filename != UNSAVED_FILENAME else "main"
        path = os.path.join(self._scratch or root, f"{stem or 'main'}.py")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(code)
        return path

    def _wrap_multiprocessing(self) -> None:
        import multiprocessing.spawn as spawn

        original = spawn.get_preparation_data
        runtime = self

        def get_preparation_data(name):  # noqa: ANN001
            data = original(name)
            path = runtime._mp_main_path
            if runtime._in_user and path is not None:
                data["init_main_from_path"] = path
                data.pop("init_main_from_name", None)
            return data

        spawn.get_preparation_data = get_preparation_data

    def _new_main(self, request: RequestState, filename: str, params: dict) -> types.ModuleType:
        main = types.ModuleType("__main__")
        main.__file__ = filename
        main.__spec__ = None
        main.__loader__ = None
        main.__builtins__ = builtins
        main.params = dict(params)  # type: ignore[attr-defined]
        main.record_metric = self._record_metric  # type: ignore[attr-defined]
        return main

    def _record_metric(self, name: str, value: float) -> None:
        self.metrics[str(name)] = float(value)

    @contextmanager
    def user_context(self, main: types.ModuleType, code: str, seed: int | None = None) -> Iterator["_Session"]:
        request = self.request
        assert request is not None and not self._in_user, "user_context is not re-entrant"
        root = request.project_root or self._scratch or self.scratch_root
        filename = request.file_path or UNSAVED_FILENAME
        session = _Session()
        file_dir = os.path.dirname(request.file_path) if request.file_path else None
        saved_path = list(sys.path)
        saved_cpu = self._set_cpu_limit(request)
        self._in_user = True
        self._mp_main_path = self._spawn_path_for(code, filename, root)
        sys.path[:] = ([file_dir] if file_dir and file_dir != root else []) + [root] + self.base_sys_path
        os.chdir(root)
        session.kernel_modules = {k: sys.modules.pop(k) for k in [n for n in sys.modules if _is_kernel_module(n)]}
        self.finder.active = False
        sys.modules["__main__"] = main
        sys.argv = [filename]
        linecache.cache[filename] = (len(code), None, code.splitlines(True), filename)
        self._prepare_process(request, seed)
        global _recorder
        _recorder = DepRecorder(
            os.path.realpath(request.project_root) if request.project_root else None, tuple(self.base_sys_path)
        )
        session.recorder = _recorder
        try:
            yield session
        finally:
            _recorder = None
            self._in_user = False
            self._mp_main_path = None
            session.user_modules = self._stash_user_modules()
            for name in [n for n in sys.modules if _is_kernel_module(n)]:
                del sys.modules[name]
            sys.modules.update(session.kernel_modules)
            self.finder.active = True
            sys.path[:] = saved_path
            os.chdir(self.scratch_root)
            if self.baseline is not None:
                sys.modules["__main__"] = self.baseline.main
            failed = self.baseline.restore() if self.baseline else []
            self._restore_cpu_limit(saved_cpu)
            if failed:
                self.dirty.append("restore:" + ",".join(failed))

    def _prepare_process(self, request: RequestState, seed: int | None) -> None:
        run_dir = request.run_dir or self._scratch
        os.environ["NUCLEI_RUN_DIR"] = run_dir or ""
        if request.project_root:
            os.environ["NUCLEI_PROJECT_ROOT"] = request.project_root
        if seed is not None:
            random.seed(seed)
            np = sys.modules.get("numpy")
            if np is not None:
                np.random.seed(seed)

        def refuse_input(*_args: object, **_kwargs: object) -> str:
            raise EOFError(INPUT_MESSAGE)

        builtins.input = refuse_input
        pyplot = sys.modules.get("matplotlib.pyplot")
        if pyplot is not None:
            pyplot.show = lambda *a, **k: None

    def _stash_user_modules(self) -> dict[str, types.ModuleType]:
        base = self.baseline.modules if self.baseline else frozenset()
        stashed: dict[str, types.ModuleType] = {}
        for name in [n for n in sys.modules if n not in base and not _is_kernel_module(n)]:
            module = sys.modules[name]
            if self._is_user_module(module):
                stashed[name] = sys.modules.pop(name)
        return stashed

    def _is_user_module(self, module: types.ModuleType) -> bool:
        locations = [getattr(module, "__file__", None)] if getattr(module, "__file__", None) else list(
            getattr(module, "__path__", []) or []
        )
        if not locations:
            return False
        return not any(
            str(loc).startswith(prefix) for loc in locations for prefix in self.base_sys_path if prefix
        )

    def _set_cpu_limit(self, request: RequestState) -> tuple | None:
        if request.cpu_s is None:
            return None
        try:
            import resource

            soft, hard = resource.getrlimit(resource.RLIMIT_CPU)
            used = resource.getrusage(resource.RUSAGE_SELF)
            target = int(used.ru_utime + used.ru_stime) + int(request.cpu_s) + 1
            if hard != resource.RLIM_INFINITY and target > hard:
                self.dirty.append("cpu_hard_limit")
                target = hard
            resource.setrlimit(resource.RLIMIT_CPU, (target, hard))
            return (soft, hard)
        except (ImportError, ValueError, OSError):
            return None

    @staticmethod
    def _restore_cpu_limit(saved: tuple | None) -> None:
        if saved is None:
            return
        try:
            import resource

            resource.setrlimit(resource.RLIMIT_CPU, saved)
        except (ImportError, ValueError, OSError):
            pass

    # -- running programs --------------------------------------------------

    def load_program(
        self, code: str, *, language: str | None = None, params: dict | None = None, seed: int | None = None,
        allow_cache: bool = True,
    ) -> LoadedProgram:
        """Execute ``code`` (or serve the cached execution of this exact code version)."""
        request = self.request
        assert request is not None, "load_program needs an active request"
        params = request.params if params is None else params
        key = run_cache.make_key(
            language or request.language, code, params, request.project_root, request.file_path, sys.executable
        )
        reading = allow_cache and request.cache == "use" and seed is None
        if reading:
            hit = self.cache.get(key)
            if hit is not None:
                self.stats.cache = "hit"
                self.metrics = dict(hit.metrics)
                return hit
        program = self._execute(code, key, params, seed)
        self.stats.cache = "miss" if request.cache != "none" else "none"
        if allow_cache and request.cache in ("use", "bypass") and seed is None:
            self.cache.put(program)
        return program

    def _execute(self, code: str, key: str, params: dict, seed: int | None) -> LoadedProgram:
        from kernel.trainability.linetrace import trace_gate_lines

        request = self.request
        assert request is not None
        filename = request.file_path or UNSAVED_FILENAME
        main = self._new_main(request, filename, params)
        program = LoadedProgram(key=key, namespace=main.__dict__, main_module=main)
        try:
            compiled = compile(code, filename, "exec", dont_inherit=True)
        except (SyntaxError, ValueError) as exc:
            tb = "".join(traceback.format_exception_only(type(exc), exc))
            program.error = error_dict("compile_error", short_message(tb), tb)
            return program
        started = time.perf_counter()
        with trace_gate_lines(filename) as lines, self.user_context(main, code, seed) as session:
            program.error, program.cacheable = self._run_compiled(compiled, main)
            if request.figures:  # before the context exit closes every figure
                program.figures, program.figures_dropped = run_figures.render_open_figures()
        program.line_map = lines
        program.user_modules = session.user_modules
        program.exec_ms = (time.perf_counter() - started) * 1000
        program.metrics = dict(self.metrics)
        recorder = session.recorder
        if recorder is not None:
            for module in session.user_modules.values():
                recorder.add(getattr(module, "__file__", None), "file")
            program.deps = recorder.deps()
            program.cacheable = program.cacheable and not recorder.overflow
        self.stats.exec_ms += program.exec_ms
        self.stats.exec_count += 1
        return program

    def _run_compiled(self, compiled: Any, main: types.ModuleType) -> tuple[dict | None, bool]:
        """Run the code; returns ``(error, cacheable)``."""
        try:
            exec(compiled, main.__dict__)  # noqa: S102 - the user's own program, same trust as their terminal
        except SystemExit as exc:
            return _exit_error(exc), False
        except KeyboardInterrupt:
            return error_dict("user_exit", "Your code raised KeyboardInterrupt; the run was ended."), False
        except MemoryError:
            self.dirty.append("memory_error")
            return error_dict(
                "too_much_memory", "Your program ran out of memory and was stopped.", reason="allocation_failed"
            ), False
        except BaseException as exc:  # noqa: BLE001 - everything the program raises is reported, never re-raised
            tb = user_traceback(exc, self.kernel_dir)
            return error_dict("execution_error", short_message(tb), tb), True
        return None, True

    def call_user(self, fn: Callable[..., Any], *args: Any, program: LoadedProgram | None = None) -> Any:
        """Call a function the user's program defined (e.g. ``nuclei_circuits``) inside the user context."""
        request = self.request
        assert request is not None
        main = program.main_module if program is not None and program.main_module is not None else None
        main = main or types.ModuleType("__main__")
        with self.user_context(main, ""):
            if program is not None:
                sys.modules.update(program.user_modules)
            return fn(*args)

    def clear_cache(self) -> None:
        self.cache.clear()


@dataclass
class _Session:
    kernel_modules: dict = field(default_factory=dict)
    user_modules: dict = field(default_factory=dict)
    recorder: DepRecorder | None = None


def _exit_error(exc: SystemExit) -> dict:
    code = exc.code
    shown = "" if code is None else repr(code) if not isinstance(code, int) else str(code)
    return error_dict(
        "user_exit", f"Your code called sys.exit({shown}); the run was ended.",
        exit_code=code if isinstance(code, int) else (0 if code is None else 1),
    )
