"""Stand-ins for the future circuit-loading Lab ops (design note section 1, rows 14-17).

S1's ``symmetry_detect``, S2+S3's ``symmetry_propose``, D3's ``deploy_inspect`` and L3+L4's
``qec_learned_sources`` (circuit kind) will each decorate a function in their own module with
``@worker_op(..., cached=True)`` and load circuits through ``load_circuit``; these fakes do exactly
that today so the every-path and single-exec tests exercise the extension point.
"""

from __future__ import annotations

from kernel.run_ops import PREVIEW, worker_op
from kernel.trainability._usercode import load_circuit


def _load_and_summarize(msg: dict) -> dict:
    loaded = load_circuit(msg["code"], msg.get("params"), msg.get("language"))
    return {"ok": True, "n_qubits": loaded.circuit.n_qubits, "gates": len(loaded.circuit.gates)}


@worker_op("fake_symmetry_detect", lane=PREVIEW, cached=True, wall_s=30.0)
def symmetry_detect(msg: dict) -> dict:
    return _load_and_summarize(msg)


@worker_op("fake_symmetry_propose", lane=PREVIEW, cached=True, wall_s=30.0)
def symmetry_propose(msg: dict) -> dict:
    return _load_and_summarize(msg)


@worker_op("fake_deploy_inspect", lane=PREVIEW, cached=True, wall_s=30.0)
def deploy_inspect(msg: dict) -> dict:
    return _load_and_summarize(msg)


@worker_op("fake_qec_learned_sources", lane=PREVIEW, cached=True, wall_s=60.0)
def qec_learned_sources(msg: dict) -> dict:
    return _load_and_summarize(msg)
