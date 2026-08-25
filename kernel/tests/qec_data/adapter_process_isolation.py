"""Fail-closed process-tree isolation primitives for adapter compliance tests."""

from __future__ import annotations

import importlib
import multiprocessing
import os
import pickle
import signal
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from kernel.qec_data.adapters.base import SourceFingerprintEntry, fingerprint_source


PROCESS_CLEANUP_SECONDS = 0.25


class IsolationBackend(Protocol):
    """Capability boundary for an adapter descendant-containment backend."""

    name: str
    os_enforced: bool

    def context(
        self, adapter_factory: object
    ) -> multiprocessing.context.BaseContext | None: ...

    def prepare_worker(self) -> tuple[object | None, str | None]: ...

    def cleanup_worker(
        self, process: multiprocessing.Process, token: object | None
    ) -> str | None: ...


def detect_secure_isolation_backend(platform_name: str) -> IsolationBackend | None:
    """Detect a genuinely OS-enforced descendant container, if implemented."""

    del platform_name
    return None


def resolve_isolation_backend(
    adapter_factory: object,
    injected: IsolationBackend | None,
    platform_name: str,
) -> tuple[
    IsolationBackend | None, multiprocessing.context.BaseContext | None, str | None
]:
    detected = injected is None
    backend = (
        injected
        if injected is not None
        else detect_secure_isolation_backend(platform_name)
    )
    if backend is None:
        return None, None, "no OS-enforced descendant-containment backend is available"
    if detected:
        try:
            os_enforced = backend.os_enforced
        except BaseException:
            return None, None, "detected backend is not OS-enforced"
        if type(os_enforced) is not bool or os_enforced is not True:
            return None, None, "detected backend is not OS-enforced"
    try:
        context = backend.context(adapter_factory)
    except BaseException as error:
        return None, None, f"backend context failed: {type(error).__name__}: {error}"
    if context is None:
        return None, None, f"backend {backend.name} cannot isolate this factory"
    return backend, context, None


def factory_is_spawn_importable(adapter_factory: object) -> bool:
    """Return whether spawn can reconstruct a factory without executable payloads."""

    module_name = getattr(adapter_factory, "__module__", None)
    qualified_name = getattr(adapter_factory, "__qualname__", None)
    if not module_name or not qualified_name or "<locals>" in qualified_name:
        return False
    try:
        pickle.dumps(adapter_factory)
        resolved: object = importlib.import_module(module_name)
        for part in qualified_name.split("."):
            resolved = getattr(resolved, part)
        return resolved is adapter_factory
    except BaseException:
        return False


def _portable_context(
    adapter_factory: object,
) -> multiprocessing.context.BaseContext | None:
    methods = multiprocessing.get_all_start_methods()
    if "fork" in methods:
        return multiprocessing.get_context("fork")
    if "spawn" in methods and factory_is_spawn_importable(adapter_factory):
        return multiprocessing.get_context("spawn")
    return None


def _establish_process_group() -> tuple[int | None, str | None]:
    """Create a best-effort group suitable only for trusted test adapters."""

    try:
        os.setsid()
        group_id = os.getpgrp()
        if group_id != os.getpid():
            raise OSError("isolated process group id did not match worker pid")
    except BaseException as error:
        return None, f"{type(error).__name__}: {error}"
    return group_id, None


def _stop_process(process: multiprocessing.Process) -> None:
    if process.is_alive():
        process.terminate()
        process.join(PROCESS_CLEANUP_SECONDS)
    if process.is_alive() and hasattr(process, "kill"):
        process.kill()
        process.join(PROCESS_CLEANUP_SECONDS)


def _signal_process_group(group_id: int | None, signal_number: int) -> str | None:
    if group_id is None or os.name != "posix":
        return None
    try:
        if group_id <= 0 or group_id == os.getpgrp():
            return "refused to signal the parent or an invalid process group"
        os.killpg(group_id, signal_number)
    except ProcessLookupError:
        return None
    except OSError as error:
        return f"{type(error).__name__}: {error}"
    return None


def _stop_process_group(
    process: multiprocessing.Process, group_id: int | None
) -> str | None:
    """Terminate one trusted process group without claiming tree containment."""

    if group_id is not None and group_id != process.pid:
        _stop_process(process)
        return "worker process group identity mismatched"
    terminate_error = _signal_process_group(group_id, signal.SIGTERM)
    if group_id is not None and terminate_error is None:
        time.sleep(PROCESS_CLEANUP_SECONDS / 2)
    kill_error = _signal_process_group(group_id, signal.SIGKILL)
    process.join(PROCESS_CLEANUP_SECONDS / 2)
    _stop_process(process)
    errors = tuple(
        error for error in (terminate_error, kill_error) if error is not None
    )
    return "; ".join(errors) if errors else None


@dataclass(frozen=True, slots=True)
class TrustedPosixProcessGroupBackend:
    """Best-effort POSIX group backend for non-adversarial contract tests only."""

    name: str = "trusted_posix_process_group"
    os_enforced: bool = False

    def context(
        self, adapter_factory: object
    ) -> multiprocessing.context.BaseContext | None:
        if os.name != "posix":
            return None
        return _portable_context(adapter_factory)

    def prepare_worker(self) -> tuple[object | None, str | None]:
        return _establish_process_group()

    def cleanup_worker(
        self, process: multiprocessing.Process, token: object | None
    ) -> str | None:
        if type(token) is not int:
            _stop_process(process)
            return "trusted process-group token was invalid"
        return _stop_process_group(process, token)


def trusted_process_group_backend() -> IsolationBackend:
    """Build the explicit best-effort backend used by trusted adapter tests."""

    return TrustedPosixProcessGroupBackend()


def receive_worker_report(
    connection: object,
    process: multiprocessing.Process,
    deadline: float,
    report_type: type[object],
) -> tuple[object | None, str, object | None]:
    """Receive stage/isolation messages until a typed report or deadline."""

    stage = "startup"
    isolation_token: object | None = None
    while time.monotonic() < deadline:
        remaining = max(0.0, deadline - time.monotonic())
        try:
            if connection.poll(min(0.02, remaining)):
                kind, value = connection.recv()
                if kind == "stage" and type(value) is str:
                    stage = value
                elif kind == "isolation_ready":
                    isolation_token = value
                elif kind == "report" and type(value) is report_type:
                    return value, stage, isolation_token
        except (EOFError, OSError):
            break
        if not process.is_alive():
            break
    return None, stage, isolation_token


def _snapshot_child(connection: object, source: Path) -> None:
    try:
        connection.send(("snapshot", fingerprint_source(source)))
    except BaseException as error:
        connection.send(("error", (type(error).__name__, str(error))))
    finally:
        connection.close()


def bounded_source_snapshot(
    context: multiprocessing.context.BaseContext, source: Path, deadline: float
) -> tuple[tuple[SourceFingerprintEntry, ...] | None, tuple[str, str] | None]:
    parent, child = context.Pipe(duplex=False)
    process = context.Process(target=_snapshot_child, args=(child, source))
    started = False
    try:
        process.start()
        started = True
        child.close()
        remaining = max(0.0, deadline - time.monotonic())
        message = parent.recv() if parent.poll(remaining) else ("timeout", None)
    except BaseException as error:
        message = ("error", (type(error).__name__, str(error)))
    if started:
        _stop_process(process)
        if process.exitcode is not None:
            process.close()
    else:
        child.close()
    parent.close()
    kind, value = message
    if kind == "snapshot" and type(value) is tuple:
        return value, None
    if kind == "error" and type(value) is tuple:
        return None, value
    return None, ("TimeoutError", "source snapshot timed out")
