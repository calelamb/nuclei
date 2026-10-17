"""inspect_circuit: minimal structural facts about a stim circuit."""

from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import Any

import stim

from .errors import ToolInputError
from .journal import sha256_text

MAX_CIRCUIT_BYTES = 20_000_000


def _read_regular_file(path: str) -> str:
    """Read a UTF-8 circuit file; refuses symlinks and non-regular files.

    Errors name the path but never include file content.
    """
    file = Path(path).expanduser()
    try:
        info = os.lstat(file)
    except FileNotFoundError as exc:
        raise ToolInputError(f"circuit file not found: {path}") from exc
    except OSError as exc:
        raise ToolInputError(f"cannot access circuit file {path}: {exc.strerror or 'OS error'}") from exc
    if stat.S_ISLNK(info.st_mode):
        raise ToolInputError(f"refusing to follow a symlink: {path}")
    if not stat.S_ISREG(info.st_mode):
        raise ToolInputError(f"circuit path is not a regular file: {path}")
    if info.st_size > MAX_CIRCUIT_BYTES:
        raise ToolInputError(f"circuit file exceeds {MAX_CIRCUIT_BYTES} bytes: {path}")
    return _read_bytes_nofollow(file, path, info)


def _read_bytes_nofollow(file: Path, path: str, expected: os.stat_result) -> str:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(file, flags)
    except OSError as exc:
        raise ToolInputError(f"cannot read circuit file {path}: {exc.strerror or 'OS error'}") from exc
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or (opened.st_ino, opened.st_dev) != (expected.st_ino, expected.st_dev):
            raise ToolInputError(f"circuit path changed while opening: {path}")
        with os.fdopen(fd, "rb", closefd=False) as handle:
            data = handle.read(MAX_CIRCUIT_BYTES + 1)
    finally:
        os.close(fd)
    if len(data) > MAX_CIRCUIT_BYTES:
        raise ToolInputError(f"circuit file exceeds {MAX_CIRCUIT_BYTES} bytes: {path}")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ToolInputError(f"circuit file is not UTF-8 text: {path}") from exc


def read_circuit_text(*, stim_text: str | None, path: str | None) -> str:
    if (stim_text is None) == (path is None):
        raise ToolInputError("provide exactly one of stim_text or path")
    text = stim_text if stim_text is not None else _read_regular_file(path)  # type: ignore[arg-type]
    if not text.strip():
        raise ToolInputError("circuit is empty")
    return text


def parse_circuit(text: str) -> stim.Circuit:
    # Stim's message quotes the offending input; never relay it (the text may be
    # a non-circuit file the caller pointed us at).
    try:
        return stim.Circuit(text)
    except ValueError as exc:
        raise ToolInputError("not a valid stim circuit (Stim could not parse the text)") from exc


def explain_nondeterministic_detectors(circuit: stim.Circuit) -> dict[str, Any] | None:
    """TODO(explain): hook for kernel/qec/explain.py (separate branch).

    When that module lands, call it here to explain WHY detectors are
    non-deterministic. Deliberately not implemented in this branch.
    """
    return None


MAX_DISTANCE_DETECTORS = 20_000


def _graphlike_distance(circuit: stim.Circuit) -> tuple[int | None, str | None]:
    # shortest_graphlike_error is synchronous and unbounded: skip huge circuits.
    if circuit.num_detectors > MAX_DISTANCE_DETECTORS:
        return None, (
            f"skipped: {circuit.num_detectors} detectors exceeds the {MAX_DISTANCE_DETECTORS} "
            "limit for the synchronous distance search"
        )
    try:
        return len(circuit.shortest_graphlike_error()), None
    except ValueError as exc:
        first = str(exc).strip().splitlines()[0] if str(exc).strip() else "unknown stim error"
        return None, first


def inspect_circuit(text: str) -> dict[str, Any]:
    circuit = parse_circuit(text)
    distance, reason = _graphlike_distance(circuit)
    result: dict[str, Any] = {
        "circuit_sha256": sha256_text(str(circuit)),  # same canonical hash as run_campaign manifests
        "num_qubits": circuit.num_qubits,
        "num_measurements": circuit.num_measurements,
        "num_detectors": circuit.num_detectors,
        "num_observables": circuit.num_observables,
        "graphlike_distance": distance,
        "distance_method": "stim.Circuit.shortest_graphlike_error (length of shortest undetectable graphlike logical error)",
    }
    if distance is None:
        result["graphlike_distance_unavailable_reason"] = reason
        result["nondeterministic_detector_explanation"] = explain_nondeterministic_detectors(circuit)
    return result
