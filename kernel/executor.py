import contextlib
import dataclasses
import importlib
import io
import json
import re
import shutil
import subprocess
import sys
import traceback
from dataclasses import dataclass
from typing import Any

from kernel import auth, framework_detect, run_context
from kernel.models import CircuitSnapshot, KernelError, SimulationResult

# Quantum Debugger (dev tools Phase 3): frameworks with a statevector path, and
# the caps that keep a per-step trace payload bounded.
DEBUG_TRACE_FRAMEWORKS = {"qiskit", "cirq"}
MAX_DEBUG_QUBITS = 12
MAX_DEBUG_GATES = 200

# Editor lint/format (dev tools Phase 4): ruff runs fast, but bound it anyway.
RUFF_TIMEOUT_SECONDS = 10

_RUFF_CMD_RESOLVED = False
_RUFF_CMD: list[str] | None = None


def ruff_base_cmd() -> list[str] | None:
    """The command prefix that runs ruff in this environment, or None if ruff
    isn't available. Prefers ruff-as-a-module in the kernel's own interpreter
    (the bundled managed venv installs it there), falling back to a `ruff`
    binary on PATH (dev machines / CI runners). Resolved once and cached so
    every lint doesn't pay a probe subprocess."""
    global _RUFF_CMD_RESOLVED, _RUFF_CMD
    if _RUFF_CMD_RESOLVED:
        return _RUFF_CMD
    _RUFF_CMD_RESOLVED = True
    try:
        probe = subprocess.run(
            [sys.executable, "-m", "ruff", "--version"], capture_output=True, timeout=5,
            env=auth.scrubbed_environment(),
        )
        if probe.returncode == 0:
            _RUFF_CMD = [sys.executable, "-m", "ruff"]
            return _RUFF_CMD
    except (OSError, subprocess.SubprocessError):
        pass
    path = shutil.which("ruff")
    _RUFF_CMD = [path] if path else None
    return _RUFF_CMD


@dataclass(frozen=True)
class AdapterSpec:
    framework: str
    module: str
    class_name: str
    detect_pattern: re.Pattern[str]
    dependencies: tuple[str, ...]
    # Source-mode adapters (Q#) compile source through their own toolchain;
    # the code never reaches Python exec().
    source_mode: bool = False


ADAPTER_SPECS = (
    # Q# first: its source would be a syntax error under every Python spec,
    # and none of the Python patterns can false-positive on Q# keywords.
    AdapterSpec(
        framework="qsharp",
        module="kernel.adapters.qsharp_adapter",
        class_name="QsharpAdapter",
        detect_pattern=framework_detect.QSHARP_PATTERN,
        dependencies=("qdk",),
        source_mode=True,
    ),
    AdapterSpec(
        framework="qiskit",
        module="kernel.adapters.qiskit_adapter",
        class_name="QiskitAdapter",
        detect_pattern=framework_detect.fallback_pattern("qiskit"),
        dependencies=("qiskit", "qiskit_aer"),
    ),
    AdapterSpec(
        framework="cirq",
        module="kernel.adapters.cirq_adapter",
        class_name="CirqAdapter",
        detect_pattern=framework_detect.fallback_pattern("cirq"),
        dependencies=("cirq",),
    ),
    AdapterSpec(
        framework="cuda-q",
        module="kernel.adapters.cudaq_adapter",
        class_name="CudaqAdapter",
        detect_pattern=framework_detect.fallback_pattern("cuda-q"),
        dependencies=("cudaq",),
    ),
    AdapterSpec(
        framework="stim",
        module="kernel.adapters.stim_adapter",
        class_name="StimAdapter",
        detect_pattern=framework_detect.fallback_pattern("stim"),
        dependencies=("stim",),
    ),
)

# Raw `.stim` text (language: "stim") routes through the SAME adapter class
# but source-mode style: stim.Circuit(text), never Python exec. Kept out of
# ADAPTER_SPECS because raw stim text has no reliable lexical signature —
# it is reachable only via the explicit language hint. (PRD 10 D2)
STIM_SOURCE_SPEC = AdapterSpec(
    framework="stim",
    module="kernel.adapters.stim_adapter",
    class_name="StimAdapter",
    detect_pattern=re.compile(r"(?!)"),  # never matches; hint-only routing
    dependencies=("stim",),
    source_mode=True,
)


def _short_error_message(error_text: str) -> str:
    lines = [line.strip() for line in error_text.strip().splitlines() if line.strip()]
    return lines[-1] if lines else "Execution failed."


def _missing_dependency_message(framework: str, dependency: str) -> str:
    display = {
        "qiskit": "Qiskit",
        "qiskit_aer": "Qiskit Aer",
        "cirq": "Cirq",
        "cudaq": "CUDA-Q",
        "qdk": "Microsoft QDK",
        "stim": "Stim",
        "sinter": "Sinter",
        "pymatching": "PyMatching",
    }.get(dependency, dependency)
    return (
        f"{display} is not installed, so {framework} code cannot run in this environment."
    )


@dataclass
class _Located:
    """Outcome of running a program and looking for its circuit (`Executor._locate`)."""

    status: str  # "ok" | "none" (no framework) | "disallowed" (a framework the caller does not support)
    spec: AdapterSpec | None = None
    adapter: Any = None
    circuit: Any = None
    stdout: str = ""
    stderr: str = ""
    error: KernelError | None = None


class Executor:
    def __init__(self, capture_limit_bytes: int | None = None):
        self._namespace: dict = {}
        self._capture_limit_bytes = capture_limit_bytes
        # Accumulated record_metric(name, value) calls from the most recent
        # run (protocol v1.1 / PRD 09 Phase B). Reset on every _run_code.
        self._metrics: dict[str, float] = {}
        # Most recent stim.Circuit seen by parse/execute (protocol v1.2 /
        # PRD 10 Phase A). Lets the qec_snapshot message re-derive the DEM
        # payload at a different edge cap without re-running user code.
        self._last_qec_circuit = None
        # Extra result fields a run computed outside SimulationResult (R-4 `bound_at`).
        self.result_extras: dict[str, Any] = {}

    def _new_capture(self) -> io.TextIOBase:
        if self._capture_limit_bytes is None:
            return io.StringIO()

        from kernel.agent_limits import BoundedTextCapture

        return BoundedTextCapture(self._capture_limit_bytes)

    def _reset_namespace(self) -> None:
        self._namespace = {"__builtins__": __builtins__}
        self._metrics = {}

    def _record_metric(self, name: str, value: float) -> None:
        """The `record_metric` closure injected into user code's namespace.

        Last write wins per name — documented in PRD 09: recording the same
        name twice overwrites rather than accumulating.
        """
        self._metrics[str(name)] = float(value)

    def _spec_named(self, framework: str | None) -> AdapterSpec | None:
        return next((spec for spec in ADAPTER_SPECS if spec.framework == framework), None)

    def _detect_adapter_spec(self, code: str) -> AdapterSpec | None:
        """The spec for the framework ``code`` imports (an override point for tests)."""
        return self._spec_named(framework_detect.resolve_framework(code))

    def _candidate_specs(self, code: str, language: str | None) -> list[AdapterSpec]:
        """Adapter specs for the frameworks ``code`` uses, most likely first.

        The frontend knows the file type, so its hint beats detection: "qsharp" routes straight to
        the Q# spec, "stim" to raw `.stim` text, and "python" excludes source-mode specs so
        Q#-looking text in Python strings or comments can't hijack routing. Detection itself is
        AST-based (`kernel.framework_detect`).
        """
        if language == "qsharp":
            spec = self._spec_named("qsharp")
            return [spec] if spec is not None else []
        if language == "stim":
            return [STIM_SOURCE_SPEC]
        detection = framework_detect.detect(code, language)
        specs = [spec for fw in detection.candidates if (spec := self._spec_named(fw)) is not None]
        # Third-party adapters registered in ADAPTER_SPECS (docs: "Write an adapter") keep routing
        # through their own `detect_pattern`; they sit ahead of the built-ins, as registered.
        builtin = {rule.framework for rule in framework_detect.RULES} | {"qsharp"}
        specs = [
            spec for spec in ADAPTER_SPECS
            if spec.framework not in builtin and not spec.source_mode and spec.detect_pattern.search(code)
        ] + specs
        if language is None:
            primary = self._detect_adapter_spec(code)
            if primary is not None:
                specs = [primary] + [s for s in specs if s.framework != primary.framework]
        return specs

    def _resolve_spec(self, code: str, language: str | None) -> AdapterSpec | None:
        specs = self._candidate_specs(code, language)
        return specs[0] if specs else None

    def resolve_framework(self, code: str, *, language: str | None = None) -> str | None:
        """Select an adapter without importing or executing generated source.

        Selection uses the language hint and the program's parsed imports. It is a routing
        correctness check, not package confinement: dynamic imports can intentionally differ
        from the selected adapter.
        """
        spec = self._resolve_spec(code, language)
        return spec.framework if spec is not None else None

    def _load_adapter(self, spec: AdapterSpec):
        try:
            module = importlib.import_module(spec.module)
            adapter_cls = getattr(module, spec.class_name)
            return adapter_cls(), None
        except ImportError as exc:
            dependency = exc.name or spec.dependencies[0]
            return None, KernelError(
                code="missing_dependency",
                message=_missing_dependency_message(spec.framework, dependency),
                framework=spec.framework,
                dependency=dependency,
            )

    def _capability_error(
        self, spec: AdapterSpec | None, exc: Exception, fallback_code: str = "execution_error"
    ) -> KernelError:
        dependency = getattr(exc, "name", None)
        if isinstance(exc, ImportError) or dependency:
            dependency = dependency or (spec.dependencies[0] if spec else None)
            return KernelError(
                code="missing_dependency",
                message=_missing_dependency_message(
                    spec.framework if spec else "this framework",
                    dependency or "dependency",
                ),
                framework=spec.framework if spec else None,
                dependency=dependency,
            )

        tb = traceback.format_exc()
        return KernelError(
            code=fallback_code,
            message=_short_error_message(tb),
            traceback=tb,
            framework=spec.framework if spec else None,
        )

    def _normalize_runtime_error(
        self, spec: AdapterSpec | None, error: KernelError
    ) -> KernelError:
        if not error.traceback or spec is None:
            return error

        match = re.search(
            r"ModuleNotFoundError: No module named ['\"]([^'\"]+)['\"]",
            error.traceback,
        )
        if not match:
            return error

        dependency = match.group(1).split(".")[0]
        if dependency not in spec.dependencies:
            return error

        return KernelError(
            code="missing_dependency",
            message=_missing_dependency_message(spec.framework, dependency),
            framework=spec.framework,
            dependency=dependency,
        )

    def _kernel_error(self, error: dict) -> KernelError:
        known = {"code", "message", "traceback", "framework", "dependency"}
        extra = {k: v for k, v in error.items() if k not in known}
        return KernelError(
            code=error["code"], message=error["message"], traceback=error.get("traceback"),
            framework=error.get("framework"), dependency=error.get("dependency"), extra=extra or None,
        )

    def _run_code(
        self,
        code: str,
        *,
        params: dict[str, float] | None = None,
        seed: int | None = None,
    ) -> tuple[str, str, KernelError | None]:
        """Execute user code and return (stdout, stderr, error).

        In a run worker (the only place the kernel server runs user code) this loads the program
        through `kernel.run_context`: a real `__main__` module, the project as cwd and `sys.path`,
        the loaded-circuit cache, and output on the worker's own streams (so stdout/stderr come
        back empty here). Elsewhere (the disposable agent worker, tests) it runs the program
        in-process with the same `__name__`/`__file__` and a `SystemExit` guard.

        Protocol v1.1 (PRD 09 Phase B), additive: `params` is ALWAYS injected into the namespace
        as a dict (empty when not supplied), so `params.get("theta", default)` is portable between
        casual runs and experiment runs. `record_metric(name, value)` is always injected too. When
        `seed` is given, Python's `random` and (if installed) `numpy.random` are seeded before
        exec so user-side randomness is captured by reproducible runs as well.
        """
        runtime = run_context.current()
        if runtime is not None:
            program = runtime.load_program(code, params=dict(params or {}), seed=seed)
            self._namespace = program.namespace
            self._metrics = dict(program.metrics)
            return "", "", self._kernel_error(program.error) if program.error else None
        run_context.assert_inprocess_exec_allowed("Executor._run_code")
        return self._run_in_process(code, params=params, seed=seed)

    def _run_in_process(
        self, code: str, *, params: dict[str, float] | None, seed: int | None
    ) -> tuple[str, str, KernelError | None]:
        import random

        stdout_capture = self._new_capture()
        stderr_capture = self._new_capture()

        self._reset_namespace()
        self._namespace.update(
            {"__name__": "__main__", "__file__": run_context.UNSAVED_FILENAME,
             "params": dict(params) if params else {}, "record_metric": self._record_metric}
        )

        if seed is not None:
            random.seed(seed)
            try:
                import numpy as np

                np.random.seed(seed)
            except ImportError:
                pass

        def finished(error: KernelError | None = None):
            return stdout_capture.getvalue(), stderr_capture.getvalue(), error

        try:
            with contextlib.redirect_stdout(stdout_capture), contextlib.redirect_stderr(stderr_capture):
                exec(code, self._namespace)
            return finished()
        except (SyntaxError, IndentationError):
            tb = traceback.format_exc()
            return finished(KernelError(code="compile_error", message=_short_error_message(tb), traceback=tb))
        except (SystemExit, KeyboardInterrupt) as exc:
            error = run_context._exit_error(exc if isinstance(exc, SystemExit) else SystemExit(1))
            return finished(self._kernel_error(error))
        except Exception:
            tb = traceback.format_exc()
            return finished(KernelError(code="execution_error", message=_short_error_message(tb), traceback=tb))

    def run_python(self, code: str) -> tuple[str, str, KernelError | None]:
        return self._run_code(code)

    def _locate(
        self,
        code: str,
        language: str | None,
        specs: list[AdapterSpec],
        *,
        params: dict[str, float] | None = None,
        seed: int | None = None,
        allowed: frozenset[str] | None = None,
    ) -> "_Located":
        """Run `code` and find its circuit.

        Adapters for the frameworks the program imports are tried first; a program that imports
        none (a script whose sibling module builds the circuit) is run anyway when it imports
        something non-stdlib, and its circuit is found by type (audit R-3).
        """
        usable = [s for s in specs if allowed is None or s.framework in allowed]
        if specs and not usable:
            return _Located("disallowed", specs[0])
        if not specs and not framework_detect.detect(code, language).foreign_imports:
            return _Located("none")
        adapters: list[tuple[AdapterSpec, Any]] = []
        load_error: KernelError | None = None
        for spec in usable:
            adapter, error = self._load_adapter(spec)
            if adapter is not None:
                adapters.append((spec, adapter))
            elif load_error is None:
                load_error = error
        if usable and not adapters:
            return _Located("ok", usable[0], error=load_error)

        stdout, stderr, error = self._run_code(code, params=params, seed=seed)
        primary = adapters[0] if adapters else (None, None)
        if error:
            if primary[0] is not None:
                error = self._normalize_runtime_error(primary[0], error)
                error.framework = primary[0].framework
            return _Located("ok", primary[0], primary[1], stdout=stdout, stderr=stderr, error=error)
        return self._find_circuit(adapters, allowed, stdout, stderr)

    def _find_circuit(self, adapters, allowed, stdout: str, stderr: str) -> "_Located":
        tried: set[str] = set()
        for spec, adapter in adapters:
            tried.add(spec.framework)
            try:
                circuit = adapter.find_circuit(self._namespace)
            except Exception as exc:
                return _Located("ok", spec, adapter, stdout=stdout, stderr=stderr,
                                error=self._capability_error(spec, exc, "adapter_error"))
            if circuit is not None:
                return _Located("ok", spec, adapter, circuit, stdout, stderr)
        framework = framework_detect.framework_by_type(self._namespace)
        if framework is not None and framework not in tried and (allowed is None or framework in allowed):
            spec = self._spec_named(framework)
            adapter, load_error = self._load_adapter(spec) if spec is not None else (None, None)
            if adapter is not None:
                try:
                    circuit = adapter.find_circuit(self._namespace)
                except Exception as exc:
                    return _Located("ok", spec, adapter, stdout=stdout, stderr=stderr,
                                    error=self._capability_error(spec, exc, "adapter_error"))
                return _Located("ok", spec, adapter, circuit, stdout, stderr)
            if load_error is not None and not adapters:
                return _Located("ok", spec, stdout=stdout, stderr=stderr, error=load_error)
        if not adapters:
            return _Located("none", stdout=stdout, stderr=stderr)
        return _Located("ok", adapters[0][0], adapters[0][1], None, stdout, stderr)

    def _unsupported_framework(self, loc: "_Located") -> KernelError:
        return KernelError(code="unsupported_framework", message="No supported quantum framework detected in code.")

    def parse(
        self, code: str, *, language: str | None = None
    ) -> tuple[CircuitSnapshot | None, str, str, KernelError | None]:
        specs = self._candidate_specs(code, language)
        if specs and specs[0].source_mode:
            return self._parse_source(specs[0], code)
        loc = self._locate(code, language, specs)
        if loc.status == "none":
            return None, loc.stdout, loc.stderr, self._unsupported_framework(loc)
        if loc.error:
            return None, loc.stdout, loc.stderr, loc.error
        if loc.spec is not None and loc.spec.framework == "stim":
            self._last_qec_circuit = loc.circuit
        if loc.circuit is None:
            return None, loc.stdout, loc.stderr, None
        try:
            snapshot = loc.adapter.extract_snapshot(loc.circuit)
        except Exception as exc:
            return None, loc.stdout, loc.stderr, self._capability_error(loc.spec, exc, "adapter_error")
        return snapshot, loc.stdout, loc.stderr, None

    def _parse_source(self, spec: AdapterSpec, code: str):
        adapter, adapter_error = self._load_adapter(spec)
        if adapter_error:
            return None, "", "", adapter_error
        # Source-mode adapters own the whole pipeline — their source never reaches exec().
        # Their return shape matches ours exactly.
        try:
            outcome = adapter.parse_source(code)
        except Exception as exc:
            return None, "", "", self._capability_error(spec, exc, "adapter_error")
        if spec.framework == "stim":
            self._last_qec_circuit = getattr(adapter, "last_circuit", None)
        return outcome

    def execute(
        self,
        code: str,
        shots: int,
        *,
        language: str | None = None,
        params: dict[str, float] | None = None,
        seed: int | None = None,
        parameter_values: dict | None = None,
        simulation_method: str | None = None,
        memory_limit_mb: int | None = None,
    ) -> tuple[SimulationResult | None, CircuitSnapshot | None, str, str, KernelError | None]:
        """Run the full pipeline: build the circuit, snapshot, simulate.

        `params`/`seed` are optional (protocol v1.1 / PRD 09 Phase B), additive over the v1
        contract — omitting both reproduces the exact v1 behavior. `params` is injected into the
        exec namespace (always a dict, `{}` when omitted); `seed` requests reproducible sampling and
        is forwarded to the adapter's `simulate`/`execute_source`, which reports back via
        `SimulationResult.seed_honored`. Any `record_metric(name, value)` calls the user's code
        made are merged into the returned result's `metrics` (empty dict when none).

        PRD 15 R-B: `parameter_values` binds free circuit parameters first (R-4, `bound_at` goes to
        `result_extras`); above 16 qubits the memory-estimate policy (`kernel.run_memory`, R-11)
        either refuses with `too_many_qubits` before allocating or runs the lean path.
        """
        self.result_extras = {}
        specs = self._candidate_specs(code, language)
        if specs and specs[0].source_mode:
            return self._execute_source(specs[0], code, shots, params, seed)
        loc = self._locate(code, language, specs, params=params, seed=seed)
        if loc.status == "none":
            return None, None, loc.stdout, loc.stderr, self._unsupported_framework(loc)
        if loc.error:
            return None, None, loc.stdout, loc.stderr, loc.error
        spec, adapter, circuit = loc.spec, loc.adapter, loc.circuit
        stdout, stderr = loc.stdout, loc.stderr
        if spec.framework == "stim":
            self._last_qec_circuit = circuit
        if circuit is None:
            return None, None, stdout, stderr, KernelError(
                code="no_circuit", message="No quantum circuit found in code.", framework=spec.framework,
            )
        try:
            snapshot = adapter.extract_snapshot(circuit)
        except Exception as exc:
            return None, None, stdout, stderr, self._capability_error(spec, exc, "adapter_error")

        circuit, bind_error = self._bind_parameters(circuit, parameter_values)
        if bind_error is not None:
            return None, snapshot, stdout, stderr, bind_error
        result, sim_error = self._simulate(spec, adapter, circuit, snapshot, shots, seed, simulation_method, memory_limit_mb)
        if sim_error is not None:
            return None, snapshot, stdout, stderr, sim_error
        # Merge whatever the user's code recorded via record_metric — always present on the wire
        # (empty dict when nothing was recorded).
        return dataclasses.replace(result, metrics=dict(self._metrics)), snapshot, stdout, stderr, None

    def _execute_source(self, spec: AdapterSpec, code: str, shots: int, params, seed):
        adapter, adapter_error = self._load_adapter(spec)
        if adapter_error:
            return None, None, "", "", adapter_error
        try:
            outcome = adapter.execute_source(code, shots, params=params, seed=seed)
        except Exception as exc:
            return None, None, "", "", self._capability_error(spec, exc, "execution_error")
        if spec.framework == "stim":
            self._last_qec_circuit = getattr(adapter, "last_circuit", None)
        return outcome

    def _bind_parameters(self, circuit, parameter_values: dict | None):
        """R-4: bind free parameters (`parameter_values`) via R-A's `kernel.adapters.binding`."""
        if not parameter_values:
            return circuit, None
        try:
            from kernel.adapters.binding import bind_parameters
        except ImportError:
            return circuit, KernelError(
                code="parameter_binding_unavailable",
                message="This kernel build cannot bind circuit parameters (kernel.adapters.binding is missing).",
            )
        try:
            bound, bound_at = bind_parameters(circuit, parameter_values)
        except Exception as exc:
            return circuit, self._capability_error(None, exc, "adapter_error")
        self.result_extras["bound_at"] = bound_at
        return bound, None

    def _simulate(self, spec, adapter, circuit, snapshot, shots, seed, method, memory_limit_mb):
        from kernel import run_memory

        plan = run_memory.plan_simulation(snapshot, spec.framework, method=method, memory_limit_mb=memory_limit_mb)
        if plan.refused:
            return None, run_memory.refusal_error(plan)
        try:
            if plan.mode in ("lean", "mps"):
                return run_memory.simulate_lean(circuit, plan, shots, seed), None
            return adapter.simulate(circuit, shots, seed=seed), None
        except Exception as exc:
            return None, self._capability_error(spec, exc, "simulation_error")

    def debug_trace(
        self,
        code: str,
        *,
        language: str | None = None,
    ) -> tuple[dict | None, str, str, KernelError | None]:
        """Per-gate state trajectory for the Quantum Debugger.

        Same setup as `execute` (resolve spec, run code, find circuit), then
        `adapter.state_trace` — the state after every gate, so the frontend
        scrubber can show the Bloch sphere + probabilities at each step without
        a kernel round-trip per step. Qiskit/Cirq only (statevector-simulable);
        bounded by a qubit and gate cap so the trace payload stays small.
        """
        unsupported = KernelError(
            code="debug_unsupported_framework",
            message="The Quantum Debugger currently supports Qiskit and Cirq circuits.",
        )
        specs = self._candidate_specs(code, language)
        loc = self._locate(code, language, specs, allowed=frozenset(DEBUG_TRACE_FRAMEWORKS))
        if loc.status in ("none", "disallowed"):
            unsupported.framework = loc.spec.framework if loc.spec else None
            return None, loc.stdout, loc.stderr, unsupported
        if loc.error:
            return None, loc.stdout, loc.stderr, loc.error
        spec, adapter, circuit, stdout, stderr = loc.spec, loc.adapter, loc.circuit, loc.stdout, loc.stderr
        if circuit is None:
            return None, stdout, stderr, KernelError(
                code="no_circuit", message="No quantum circuit found in code.", framework=spec.framework,
            )
        try:
            snapshot = adapter.extract_snapshot(circuit)
        except Exception as exc:
            return None, stdout, stderr, self._capability_error(spec, exc, "adapter_error")

        # Bound the trace so the payload (and the per-prefix cost) stays small.
        if snapshot.qubit_count > MAX_DEBUG_QUBITS:
            return None, stdout, stderr, KernelError(
                code="circuit_too_large",
                message=f"The debugger supports up to {MAX_DEBUG_QUBITS} qubits (this circuit has {snapshot.qubit_count}).",
                framework=spec.framework,
            )
        if len(snapshot.gates) > MAX_DEBUG_GATES:
            return None, stdout, stderr, KernelError(
                code="circuit_too_large",
                message=f"The debugger supports up to {MAX_DEBUG_GATES} gates (this circuit has {len(snapshot.gates)}).",
                framework=spec.framework,
            )

        try:
            steps = adapter.state_trace(circuit)
        except Exception as exc:
            return None, stdout, stderr, self._capability_error(spec, exc, "simulation_error")

        payload = {"framework": spec.framework, "qubit_count": snapshot.qubit_count, "steps": steps}
        return payload, stdout, stderr, None

    def lint(
        self,
        code: str,
        *,
        language: str | None = None,
    ) -> tuple[list[dict], KernelError | None]:
        """Python diagnostics via ruff (dev tools Phase 4).

        Runs `ruff check` over the buffer and returns a list of
        `{line, column, end_line, end_column, severity, code, message}`
        (1-based positions). Python-only — Q# has its own compiler diagnostics,
        so `language == "qsharp"` returns no diagnostics. Ruff absent or
        unrunnable degrades to an empty list (never blocks typing), never an
        error.
        """
        if language == "qsharp":
            return [], None
        base = ruff_base_cmd()
        if base is None:
            return [], None
        try:
            proc = subprocess.run(
                [*base, "check", "--output-format", "json", "--stdin-filename", "buffer.py", "-"],
                input=code, capture_output=True, text=True, timeout=RUFF_TIMEOUT_SECONDS,
                env=auth.scrubbed_environment(),
            )
        except (FileNotFoundError, OSError, subprocess.SubprocessError):
            return [], None
        # ruff exits 1 when it finds issues (0 = clean); anything else means it
        # couldn't run — degrade silently rather than surfacing an error.
        if proc.returncode not in (0, 1):
            return [], None
        try:
            raw = json.loads(proc.stdout or "[]")
        except json.JSONDecodeError:
            return [], None

        diagnostics = []
        for d in raw:
            loc = d.get("location") or {}
            end = d.get("end_location") or {}
            row = int(loc.get("row", 1))
            col = int(loc.get("column", 1))
            rule = d.get("code") or ""
            diagnostics.append({
                "line": row,
                "column": col,
                "end_line": int(end.get("row", row)),
                "end_column": int(end.get("column", col)),
                # ruff has no severity field; syntax errors (E9xx) are the only
                # ones worth flagging as errors, everything else is a warning.
                "severity": "error" if rule.startswith("E9") else "warning",
                "code": rule,
                "message": d.get("message", ""),
            })
        return diagnostics, None

    def format_code(
        self,
        code: str,
        *,
        language: str | None = None,
    ) -> tuple[str | None, KernelError | None]:
        """Format Python via `ruff format` (dev tools Phase 4). Returns the
        formatted text, or a KernelError (e.g. a syntax error ruff can't parse,
        or ruff unavailable). Python-only."""
        if language == "qsharp":
            return None, KernelError(
                code="format_unsupported",
                message="Formatting currently supports Python.",
                framework="qsharp",
            )
        base = ruff_base_cmd()
        if base is None:
            return None, KernelError(code="format_failed", message="The formatter (ruff) is not available.")
        try:
            proc = subprocess.run(
                [*base, "format", "--stdin-filename", "buffer.py", "-"],
                input=code, capture_output=True, text=True, timeout=RUFF_TIMEOUT_SECONDS,
                env=auth.scrubbed_environment(),
            )
        except (FileNotFoundError, OSError, subprocess.SubprocessError) as exc:
            return None, KernelError(code="format_failed", message=f"Could not run the formatter: {exc}")
        if proc.returncode != 0:
            return None, KernelError(
                code="format_failed",
                message=(proc.stderr.strip() or "ruff format failed").splitlines()[-1],
            )
        return proc.stdout, None

    def qec_snapshot_payload(
        self,
        *,
        code: str | None = None,
        language: str | None = None,
        max_edges: int | None = None,
        circuit_text: str | None = None,
    ) -> tuple[dict | None, KernelError | None]:
        """Build the `qec_snapshot` payload (protocol v1.2 / PRD 10 Phase A).

        `circuit_text` (PRD 15 R-B) rebuilds the payload from stim text the server remembered from
        the connection's last parse/execute — no program is run. Otherwise two forms:
        - With `code`: stateless — build the circuit fresh (raw .stim text
          parses cheaply; Python stim code re-runs through exec, which is
          documented as having side effects, exactly like `parse`).
        - Without `code`: reuse the most recent stim circuit this
          connection parsed/executed — the "render anyway" path, where the
          frontend re-requests the DEM at a higher edge cap without
          re-running anything.
        """
        from kernel.qec.dem import MAX_DEM_EDGES

        cap = MAX_DEM_EDGES if max_edges is None else max(1, int(max_edges))

        circuit = self._last_qec_circuit
        if circuit_text is not None:
            try:
                import stim

                circuit = stim.Circuit(circuit_text)
            except ImportError:
                return None, KernelError(
                    code="missing_dependency", message=_missing_dependency_message("stim", "stim"),
                    framework="stim", dependency="stim",
                )
            except Exception as exc:
                return None, self._capability_error(None, exc, "adapter_error")
        elif code is not None:
            spec = self._resolve_spec(code, language)
            if spec is None or spec.framework != "stim":
                return None, KernelError(
                    code="unsupported_framework",
                    message=(
                        "qec_snapshot requires a Stim circuit — send raw .stim "
                        'text with language "stim", or Python code that builds '
                        "a stim.Circuit."
                    ),
                )
            adapter, adapter_error = self._load_adapter(spec)
            if adapter_error:
                return None, adapter_error
            if spec.source_mode:
                try:
                    circuit = adapter.build_from_source(code)
                except ValueError as exc:
                    return None, KernelError(
                        code="compile_error",
                        message=str(exc).strip().splitlines()[0],
                        framework="stim",
                    )
            else:
                stdout, stderr, error = self._run_code(code)
                if error:
                    error = self._normalize_runtime_error(spec, error)
                    error.framework = spec.framework
                    return None, error
                try:
                    circuit = adapter.find_circuit(self._namespace)
                except Exception as exc:
                    return None, self._capability_error(spec, exc, "adapter_error")
            self._last_qec_circuit = circuit

        if circuit is None:
            return None, KernelError(
                code="no_circuit",
                message=(
                    "No Stim circuit available for qec_snapshot — parse or "
                    "execute one first, or include `code` in the request."
                ),
                framework="stim",
            )

        try:
            from kernel.qec.dem import build_qec_payload

            return build_qec_payload(circuit, max_edges=cap), None
        except ImportError:
            return None, KernelError(
                code="missing_dependency",
                message=_missing_dependency_message("stim", "stim"),
                framework="stim",
                dependency="stim",
            )
        except Exception as exc:
            return None, self._capability_error(None, exc, "adapter_error")

    def transpile(
        self,
        code: str,
        *,
        basis_gates: list[str] | None = None,
        coupling_map: list[list[int]] | None = None,
        optimization_level: int = 1,
        language: str | None = None,
    ) -> tuple[dict | None, str, str, KernelError | None]:
        """Build a Qiskit circuit from `code` and transpile it against a target.

        Return shape mirrors parse()/execute(): (payload, stdout, stderr,
        error). The payload is a plain metrics dict rather than a typed
        dataclass — there is no CircuitSnapshot/SimulationResult equivalent
        for a transpile preview, just depth/gate-count/mapping facts.

        Qiskit-only: any other detected (or absent) framework returns a
        `transpile_unsupported_framework` KernelError instead of running,
        since qiskit.transpile has no meaning for cirq/Q# circuit objects.
        qiskit is imported lazily inside this method, matching the rest of
        the module's no-import-time-dependency pattern.
        """
        _adapter, circuit, stdout, stderr, error = self._prepare_transpile_circuit(code, language)
        if error:
            return None, stdout, stderr, error

        try:
            from qiskit import transpile as qiskit_transpile
        except ImportError as exc:
            dependency = exc.name or "qiskit"
            return None, stdout, stderr, KernelError(
                code="missing_dependency",
                message=_missing_dependency_message("qiskit", dependency),
                framework="qiskit",
                dependency=dependency,
            )

        try:
            transpiled = qiskit_transpile(
                circuit,
                basis_gates=basis_gates or None,
                coupling_map=coupling_map or None,
                optimization_level=optimization_level,
            )
        except Exception:
            tb = traceback.format_exc()
            return None, stdout, stderr, KernelError(
                code="adapter_error",
                message=_short_error_message(tb),
                traceback=tb,
                framework="qiskit",
            )

        gate_counts: dict[str, int] = {}
        two_qubit_count = 0
        for instruction in transpiled.data:
            name = instruction.operation.name
            gate_counts[name] = gate_counts.get(name, 0) + 1
            if len(instruction.qubits) == 2:
                two_qubit_count += 1

        metrics = {
            "depth": transpiled.depth(),
            "gate_counts": gate_counts,
            "two_qubit_count": two_qubit_count,
            "num_qubits": transpiled.num_qubits,
            "basis_gates": list(basis_gates) if basis_gates else None,
            "coupling_mapped": bool(coupling_map),
        }

        return metrics, stdout, stderr, None

    def _prepare_transpile_circuit(self, code: str, language: str | None):
        """Shared setup for transpile()/transpile_explore(): resolve the (Qiskit)
        spec, run the code, and find the circuit.

        Returns ``(adapter, circuit, stdout, stderr, error)``. On any failure
        ``error`` is a KernelError and ``circuit`` is None.
        """
        specs = self._candidate_specs(code, language)
        loc = self._locate(code, language, specs, allowed=frozenset({"qiskit"}))
        if loc.status in ("none", "disallowed"):
            return None, None, loc.stdout, loc.stderr, KernelError(
                code="transpile_unsupported_framework",
                message="Transpilation preview currently supports Qiskit circuits.",
                framework=loc.spec.framework if loc.spec else None,
            )
        if loc.error:
            return None, None, loc.stdout, loc.stderr, loc.error
        if loc.circuit is None:
            return None, None, loc.stdout, loc.stderr, KernelError(
                code="no_circuit", message="No quantum circuit found in code.", framework=loc.spec.framework,
            )
        return loc.adapter, loc.circuit, loc.stdout, loc.stderr, None

    def transpile_explore(
        self,
        code: str,
        *,
        basis_gates: list[str] | None = None,
        coupling_map: list[list[int]] | None = None,
        optimization_level: int = 1,
        language: str | None = None,
    ) -> tuple[dict | None, str, str, KernelError | None]:
        """Transpile for a target and return the full 'explorer' payload:
        before/after CircuitSnapshots, before/after metrics, and the passes
        that changed the circuit (with the gates each added/removed).

        Unlike ``transpile()`` (metrics-only, used by the Dirac agent), this
        runs a preset PassManager with a per-pass callback so the frontend can
        show *what the compiler did, pass by pass*. Qiskit-only.
        """
        adapter, circuit, stdout, stderr, error = self._prepare_transpile_circuit(code, language)
        if error:
            return None, stdout, stderr, error

        try:
            from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
            from qiskit.converters import dag_to_circuit
        except ImportError as exc:
            dependency = exc.name or "qiskit"
            return None, stdout, stderr, KernelError(
                code="missing_dependency",
                message=_missing_dependency_message("qiskit", dependency),
                framework="qiskit",
                dependency=dependency,
            )

        before_snapshot = adapter.extract_snapshot(circuit)

        # Capture (pass name, op counts, depth) after each pass so we can diff
        # consecutive passes and attribute added gates (routing SWAPs, basis
        # translation) to the pass responsible.
        records: list[tuple[str, dict, int]] = []

        def _callback(**kwargs) -> None:
            pass_obj = kwargs.get("pass_")
            dag = kwargs.get("dag")
            name = type(pass_obj).__name__ if pass_obj is not None else "?"
            try:
                as_circuit = dag_to_circuit(dag)
                records.append((name, dict(as_circuit.count_ops()), as_circuit.depth()))
            except Exception:
                pass

        try:
            pass_manager = generate_preset_pass_manager(
                optimization_level=optimization_level,
                basis_gates=basis_gates or None,
                coupling_map=coupling_map or None,
            )
            transpiled = pass_manager.run(circuit, callback=_callback)
        except Exception:
            tb = traceback.format_exc()
            return None, stdout, stderr, KernelError(
                code="adapter_error",
                message=_short_error_message(tb),
                traceback=tb,
                framework="qiskit",
            )

        after_snapshot = adapter.extract_snapshot(transpiled)

        # Only report passes that actually changed the circuit's gate makeup.
        passes: list[dict] = []
        prev_ops: dict | None = None
        for name, ops, depth in records:
            if prev_ops is not None:
                keys = set(ops) | set(prev_ops)
                added = {k: ops.get(k, 0) - prev_ops.get(k, 0) for k in keys}
                added = {k: v for k, v in added.items() if v != 0}
                if added:
                    passes.append({"name": name, "depth": depth, "added_gates": added})
            prev_ops = ops

        def _two_qubit(circ) -> int:
            return sum(
                1
                for inst in circ.data
                if len(inst.qubits) == 2 and inst.operation.name not in ("measure", "barrier")
            )

        def _op_count(circ) -> int:
            return sum(
                1 for inst in circ.data if inst.operation.name not in ("measure", "barrier")
            )

        payload = {
            "before": before_snapshot.to_dict(),
            "after": after_snapshot.to_dict(),
            "metrics": {
                "depth": {"before": circuit.depth(), "after": transpiled.depth()},
                "two_qubit": {"before": _two_qubit(circuit), "after": _two_qubit(transpiled)},
                "gate_count": {"before": _op_count(circuit), "after": _op_count(transpiled)},
            },
            "passes": passes,
            "target": {
                "basis_gates": list(basis_gates) if basis_gates else None,
                "coupling_size": len(coupling_map) if coupling_map else 0,
            },
        }
        return payload, stdout, stderr, None
