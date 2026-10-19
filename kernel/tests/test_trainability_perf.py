"""Performance targets for the Lab Compiler (numpy backend).

Spec targets: n=12, 72 params, B=256 value_and_grad in < 2 s; n=16, B=64 in
< 10 s.  Thresholds here are 3x the targets so CI noise cannot flake them;
set NUCLEI_SKIP_PERF=1 to skip on very constrained machines.  The measured
times are printed (run with ``-s``) and asserted against the loose bound.
"""

import os
import time

import numpy as np
import pytest

from kernel.trainability.compiler import compile_circuit
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.pauli import parse_observable

pytestmark = pytest.mark.skipif(
    os.environ.get("NUCLEI_SKIP_PERF") == "1", reason="NUCLEI_SKIP_PERF=1"
)

TOLERANCE = 3.0


def hardware_efficient(n: int, layers: int) -> ParamCircuit:
    """RY layer + CZ brick per layer; ``n * layers`` independent parameters."""
    gates, params = [], []
    for layer in range(layers):
        for q in range(n):
            name = f"t{layer}_{q}"
            params.append(name)
            gates.append(IrGate("RY", (q,), (ParamRef(name),)))
        gates += [IrGate("CZ", (q, q + 1)) for q in range(0, n - 1, 2)]
        gates += [IrGate("CZ", (q, q + 1)) for q in range(1, n - 1, 2)]
    return ParamCircuit(n, gates, params, "native", [])


def best_time(prog, values, obs, reps=2) -> float:
    prog.value_and_grad(values[:2], obs)  # warm up caches / allocator
    times = []
    for _ in range(reps):
        t0 = time.perf_counter()
        prog.value_and_grad(values, obs)
        times.append(time.perf_counter() - t0)
    return min(times)


@pytest.mark.parametrize(
    "n,layers,batch,target_s",
    [(12, 6, 256, 2.0), (16, 4, 64, 10.0)],
)
def test_batched_value_and_grad_meets_target(n, layers, batch, target_s):
    circuit = hardware_efficient(n, layers)
    prog = compile_circuit(circuit, backend="numpy")
    obs = parse_observable("preset:local_z", n)
    values = np.random.default_rng(0).uniform(0, 2 * np.pi, size=(batch, len(circuit.parameters)))
    elapsed = best_time(prog, values, obs)
    print(f"\nperf n={n} params={len(circuit.parameters)} B={batch}: {elapsed:.3f}s (target < {target_s}s)")
    assert elapsed < TOLERANCE * target_s


def test_qaoa_style_layers_use_few_ops():
    """Diagonal fusion keeps a deep QAOA circuit's op count independent of edges."""
    n, p = 12, 4
    edges = [(i, (i + 1) % n) for i in range(n)] + [(i, (i + 5) % n) for i in range(n)]
    gates, params = [IrGate("H", (q,)) for q in range(n)], []
    for layer in range(p):
        gamma, beta = f"g{layer}", f"b{layer}"
        params += [gamma, beta]
        gates += [IrGate("RZZ", e, (ParamRef(gamma),)) for e in edges]
        gates += [IrGate("RX", (q,), (ParamRef(beta),)) for q in range(n)]
    prog = compile_circuit(ParamCircuit(n, gates, params, "native", []), backend="numpy")
    assert prog.stats["op_counts"]["diag"] == p
    obs = parse_observable("preset:zz_chain", n)
    values = np.random.default_rng(1).uniform(0, 3, size=(64, len(params)))
    t0 = time.perf_counter()
    prog.value_and_grad(values, obs)
    assert time.perf_counter() - t0 < 6.0
