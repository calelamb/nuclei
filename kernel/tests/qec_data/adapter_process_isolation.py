"""Fail-closed process-tree isolation primitives for adapter compliance tests."""

from __future__ import annotations

import importlib
import multiprocessing
import os
import pickle
import signal
import time
from collections.abc import Callable
from pathlib import Path

from kernel.qec_data.adapters.base import SourceFingerprintEntry, fingerprint_source


PROCESS_CLEANUP_SECONDS = 0.25


def process_tree_isolation_strategy(platform_name: str) -> str | None:
    """Return the descendant-containment strategy available on a platform."""

    return "posix_process_group" if platform_name == "posix" else None


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


def process_context(
    adapter_factory: object, platform_name: str
) -> multiprocessing.context.BaseContext | None:
    if process_tree_isolation_strategy(platform_name) is None:
        return None
    methods = multiprocessing.get_all_start_methods()
    if "fork" in methods:
        return multiprocessing.get_context("fork")
    if "spawn" in methods and factory_is_spawn_importable(adapter_factory):
        return multiprocessing.get_context("spawn")
    return None


def establish_process_group(
    send: Callable[[tuple[str, object]], None],
) -> str | None:
    """Create a new POSIX session before any untrusted adapter code runs."""

    try:
        os.setsid()
        group_id = os.getpgrp()
        if group_id != os.getpid():
            raise OSError("isolated process group id did not match worker pid")
    except BaseException as error:
        return f"{type(error).__name__}: {error}"
    send(("isolation_ready", group_id))
    return None


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


def stop_process_tree(
    process: multiprocessing.Process, group_id: int | None
) -> str | None:
    """Terminate and reap the verified worker group, including descendants."""

    if group_id is not None and group_id != process.pid:
        _stop_process(process)
        return "worker process group identity mismatched"
    terminate_error = _signal_process_group(group_id, signal.SIGTERM)
    process.join(PROCESS_CLEANUP_SECONDS / 2)
    kill_error = _signal_process_group(group_id, signal.SIGKILL)
    process.join(PROCESS_CLEANUP_SECONDS / 2)
    _stop_process(process)
    errors = tuple(
        error for error in (terminate_error, kill_error) if error is not None
    )
    return "; ".join(errors) if errors else None


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
