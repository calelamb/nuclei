"""Validate a CampaignRequest against ceilings and build sinter tasks."""

from __future__ import annotations

import importlib.util

import sinter
import stim

from .campaign_models import GENERATED_CODES, NOISE_CHANNELS, CampaignRequest, GeneratorSource, PathsSource
from .ceilings import Ceilings
from .errors import ToolInputError
from .journal import sha256_text
from .tools_inspect import parse_circuit, read_circuit_text

KNOWN_DECODERS = tuple(sorted(sinter.BUILT_IN_DECODERS))
# Built-in sinter decoders backed by an optional Python package.
DECODER_MODULES = {
    "pymatching": "pymatching",
    "pymatching-correlated": "pymatching",
    "fusion_blossom": "fusion_blossom",
    "mw_parity_factor": "mwpf",
    "hypergraph_union_find": "mwpf",
}


def _check_decoders_available(decoders: list[str]) -> None:
    for dec in decoders:
        module = DECODER_MODULES.get(dec)
        if module is not None and importlib.util.find_spec(module) is None:
            raise ToolInputError(
                f"decoder {dec!r} needs the Python package {module!r}, which is not installed in this environment"
            )


def check_request(req: CampaignRequest, ceilings: Ceilings) -> None:
    for name in ("max_shots", "max_errors", "max_seconds", "max_tasks"):
        ceilings.require(name, getattr(req, name))
    ceilings.require("max_workers", req.num_workers)
    ceilings.require("max_rounds", req.source.rounds)
    unknown = [d for d in req.decoders if d not in KNOWN_DECODERS]
    if unknown:
        raise ToolInputError(f"unknown decoder(s) {unknown}; available: {list(KNOWN_DECODERS)}")
    if len(set(req.decoders)) != len(req.decoders):
        raise ToolInputError("decoders must not repeat")
    _check_decoders_available(req.decoders)
    if isinstance(req.source, GeneratorSource):
        _check_generator(req.source, ceilings)


def _check_generator(src: GeneratorSource, ceilings: Ceilings) -> None:
    if src.code not in GENERATED_CODES:
        raise ToolInputError(f"unknown code {src.code!r}; available: {list(GENERATED_CODES)}")
    if not src.noise_model.channels:
        raise ToolInputError("noise_model.channels is required for generated circuits (no default noise)")
    bad = [c for c in src.noise_model.channels if c not in NOISE_CHANNELS]
    if bad:
        raise ToolInputError(f"unknown noise channel(s) {bad}; available: {list(NOISE_CHANNELS)}")
    if any(m < 0 for m in src.noise_model.channels.values()):
        raise ToolInputError("noise channel multipliers must be >= 0")
    for d in src.distances:
        if d < 2:
            raise ToolInputError(f"distance must be >= 2, got {d}")
        ceilings.require("max_distance", d)
    for p in src.physical_error_rates:
        if not 0.0 < p <= 1.0:
            raise ToolInputError(f"physical error rate must be in (0, 1], got {p}")
        for c, m in src.noise_model.channels.items():
            if p * m > 1.0:
                raise ToolInputError(f"p x multiplier for {c} is {p * m} > 1")


def _generated_tasks(req: CampaignRequest, src: GeneratorSource) -> list[sinter.Task]:
    tasks = []
    for d in src.distances:
        for p in src.physical_error_rates:
            kwargs = {c: p * m for c, m in (src.noise_model.channels or {}).items()}
            try:
                circuit = stim.Circuit.generated(src.code, distance=d, rounds=src.rounds, **kwargs)
            except ValueError as exc:
                raise ToolInputError(f"stim rejected code={src.code} distance={d} rounds={src.rounds}: {exc}") from exc
            for dec in req.decoders:
                meta = {"code": src.code, "d": d, "p": p, "rounds": src.rounds,
                        "noise_model": src.noise_model.name, "decoder": dec}
                tasks.append(sinter.Task(circuit=circuit, decoder=dec, json_metadata=meta))
    return tasks


def _path_tasks(req: CampaignRequest, src: PathsSource) -> list[sinter.Task]:
    tasks = []
    for raw in src.paths:
        text = read_circuit_text(stim_text=None, path=raw)
        circuit = parse_circuit(text, source_path=raw)
        for dec in req.decoders:
            meta = {"path": raw, "circuit_sha256": sha256_text(str(circuit)), "rounds": src.rounds,
                    "noise_model": src.noise_model.name, "decoder": dec}
            tasks.append(sinter.Task(circuit=circuit, decoder=dec, json_metadata=meta))
    return tasks


def build_tasks(req: CampaignRequest, ceilings: Ceilings) -> list[sinter.Task]:
    check_request(req, ceilings)
    src = req.source
    n = len(req.decoders) * (
        len(src.distances) * len(src.physical_error_rates) if isinstance(src, GeneratorSource) else len(src.paths)
    )
    if n > req.max_tasks:
        raise ToolInputError(f"request expands to {n} tasks, above the requested max_tasks={req.max_tasks}")
    ceilings.require("max_total_shots", req.max_shots * n)
    return _generated_tasks(req, src) if isinstance(src, GeneratorSource) else _path_tasks(req, src)


def task_circuit_texts(tasks: list[sinter.Task]) -> dict[str, str]:
    """sha256 -> circuit text, for content-addressed journal artifacts."""
    out: dict[str, str] = {}
    for t in tasks:
        text = str(t.circuit)
        out[sha256_text(text)] = text
    return out
