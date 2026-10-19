"""Lab Compiler: compiled == reference, pass behaviour, cache, chunking."""

import numpy as np
import pytest

from kernel.tests._trainability_helpers import (
    ONE_Q_FIXED,
    random_circuit,
    random_observable,
)
from kernel.trainability import backends as be
from kernel.trainability import compiler as comp
from kernel.trainability.compiler import clear_compile_cache, compile_circuit
from kernel.trainability.gates import GATE_SPECS
from kernel.trainability.ir import IrError, IrGate, ParamCircuit, ParamRef
from kernel.trainability.pauli import parse_observable
from kernel.trainability.reference import reference_expectation, reference_state

BACKENDS = be.available_backends()


def circ(n, gates, params=()):
    return ParamCircuit(n, list(gates), list(params), "native", [])


@pytest.mark.parametrize("backend", BACKENDS)
@pytest.mark.parametrize("seed", range(12))
def test_states_match_reference_randomized(backend, seed):
    rng = np.random.default_rng(seed)
    n = int(rng.integers(1, 9))
    c = random_circuit(rng, n, int(rng.integers(1, 40)), int(rng.integers(0, 7)),
                       diag_heavy=seed % 4 == 0)
    prog = compile_circuit(c, backend=backend)
    values = rng.uniform(-3.5, 3.5, size=(4, len(c.parameters)))
    states = prog.states(values)
    assert states.shape == (4, 1 << n) and states.dtype == np.complex128
    for b in range(4):
        assert np.abs(states[b] - reference_state(c, values[b])).max() < 1e-10


@pytest.mark.parametrize("backend", BACKENDS)
@pytest.mark.parametrize("seed", range(6))
def test_expectations_match_reference(backend, seed):
    rng = np.random.default_rng(100 + seed)
    n = int(rng.integers(1, 8))
    c = random_circuit(rng, n, 25, 4)
    obs = random_observable(rng, n)
    values = rng.uniform(-3, 3, size=(3, 4))
    got = compile_circuit(c, backend=backend).expectations(values, obs)
    want = [reference_expectation(c, v, obs) for v in values]
    assert np.allclose(got, want, atol=1e-10)


@pytest.mark.parametrize("name", sorted(GATE_SPECS))
def test_each_gate_alone_matches_reference(name):
    spec = GATE_SPECS[name]
    n = max(spec.arity, 2) + 1
    rng = np.random.default_rng(7)
    prep = [IrGate("H", (q,)) for q in range(n)] + [IrGate("RY", (q,), (0.3 + q,)) for q in range(n)]
    qubits = tuple(int(q) for q in rng.permutation(n)[: spec.arity])
    angles = tuple(ParamRef(f"a{k}", 1.5, 0.2) for k in range(spec.n_angles))
    c = circ(n, prep + [IrGate(name, qubits, angles)], [f"a{k}" for k in range(spec.n_angles)])
    v = rng.uniform(-3, 3, size=(2, spec.n_angles))
    got = compile_circuit(c, backend="numpy").states(v)
    for b in range(2):
        assert np.abs(got[b] - reference_state(c, v[b])).max() < 1e-12


def test_global_phase_of_u_gate_is_kept_in_states():
    c = circ(1, [IrGate("U", (0,), (ParamRef("a"), 0.8, ParamRef("b")))], ["a", "b"])
    v = np.array([[0.4, 1.3]])
    assert np.abs(compile_circuit(c).states(v)[0] - reference_state(c, v[0])).max() < 1e-12


def test_zero_parameter_circuit():
    c = circ(2, [IrGate("H", (0,)), IrGate("CX", (0, 1))])
    prog = compile_circuit(c)
    obs = parse_observable("Z0*Z1", 2)
    val, grad = prog.value_and_grad(np.zeros((3, 0)), obs)
    assert np.allclose(val, 1.0) and grad.shape == (3, 0)


def test_batch_equals_per_sample_and_initial_state():
    rng = np.random.default_rng(3)
    c = random_circuit(rng, 4, 20, 3)
    prog = compile_circuit(c)
    v = rng.uniform(-2, 2, size=(5, 3))
    init = rng.normal(size=16) + 1j * rng.normal(size=16)
    init /= np.linalg.norm(init)
    batched = prog.states(v, initial=init)
    for b in range(5):
        assert np.abs(batched[b] - reference_state(c, v[b], init)).max() < 1e-10
    per_sample_init = rng.normal(size=(5, 16)) + 0j
    out = prog.states(v, initial=per_sample_init)
    for b in range(5):
        assert np.abs(out[b] - reference_state(c, v[b], per_sample_init[b])).max() < 1e-10


def test_input_validation():
    prog = compile_circuit(circ(2, [IrGate("RX", (0,), (ParamRef("a"),))], ["a"]))
    with pytest.raises(IrError):
        prog.states(np.zeros((2, 3)))
    with pytest.raises(IrError):
        prog.states(np.zeros(1))
    with pytest.raises(IrError):
        prog.expectations(np.zeros((1, 1)), parse_observable("Z4", 5))
    with pytest.raises(IrError):
        prog.states(np.zeros((1, 1)), initial=np.zeros(3))
    with pytest.raises(IrError) as e:
        compile_circuit(circ(21, [IrGate("H", (0,))]))
    assert e.value.code == "too_many_qubits"


# ----------------------------------------------------------------- passes


def test_merge_same_axis_rotations_and_shared_refs():
    a = ParamRef("a")
    c = circ(2, [
        IrGate("RX", (0,), (a,)), IrGate("RX", (0,), (ParamRef("a", 2.0, 0.1),)),
        IrGate("RX", (0,), (0.25,)), IrGate("RY", (1,), (a,)), IrGate("RX", (1,), (a,)),
        IrGate("RX", (0,), (a,)),  # still adjacent on wire 0 -> merged too
    ], ["a"])
    prog = compile_circuit(c)
    assert prog.stats["merged_rotations"] == 3
    assert prog.stats["op_counts"]["rot"] == 3
    v = np.array([[0.7]])
    assert np.abs(prog.states(v)[0] - reference_state(c, v[0])).max() < 1e-12


def test_rotations_not_merged_across_a_blocking_gate():
    a = ParamRef("a")
    c = circ(2, [IrGate("RX", (0,), (a,)), IrGate("CX", (0, 1)), IrGate("RX", (0,), (a,))], ["a"])
    assert compile_circuit(c).stats["merged_rotations"] == 0


def test_fixed_1q_runs_fuse_into_one_matrix():
    c = circ(1, [IrGate(g, (0,)) for g in ("H", "T", "SX", "H", "S", "Y")] + [IrGate("RX", (0,), (0.3,))])
    prog = compile_circuit(c)
    assert prog.stats["fused_fixed_1q"] == 6
    assert prog.stats["ops"] == 1
    assert np.abs(prog.states(np.zeros((1, 0)))[0] - reference_state(c, np.zeros(0))).max() < 1e-12


def test_hh_fuses_to_identity_and_disappears():
    prog = compile_circuit(circ(1, [IrGate("H", (0,)), IrGate("H", (0,))]))
    assert prog.stats["ops"] == 0
    assert np.allclose(prog.states(np.zeros((1, 0)))[0], [1, 0])


def test_qaoa_cost_layer_is_one_diag_op_with_shared_parameter():
    n, edges = 5, [(0, 1), (1, 2), (2, 3), (3, 4), (4, 0), (0, 2)]
    g = ParamRef("gamma")
    gates = [IrGate("H", (q,)) for q in range(n)]
    gates += [IrGate("RZZ", e, (g,)) for e in edges]
    gates += [IrGate("RX", (q,), (ParamRef("beta"),)) for q in range(n)]
    c = circ(n, gates, ["beta", "gamma"])
    prog = compile_circuit(c)
    assert prog.stats["op_counts"]["diag"] == 1
    assert prog.stats["diag_gates_fused"] == len(edges)
    op = next(o for o in prog.ops if o.kind == "diag")
    assert op.hp.shape[0] == 1  # one distinct parameter -> one eigenvalue vector
    v = np.array([[0.4, -0.9]])
    assert np.abs(prog.states(v)[0] - reference_state(c, v[0])).max() < 1e-12


def test_diagonal_gate_slides_past_disjoint_gates_but_not_overlapping_ones():
    c = circ(3, [
        IrGate("RZ", (0,), (ParamRef("a"),)),
        IrGate("RX", (2,), (ParamRef("b"),)),   # disjoint: RZ stays pending
        IrGate("CZ", (0, 1)),                   # joins the pending diag op
        IrGate("RX", (0,), (ParamRef("a"),)),   # overlaps: flushes
        IrGate("RZ", (0,), (ParamRef("b"),)),
    ], ["a", "b"])
    prog = compile_circuit(c)
    assert prog.stats["op_counts"].get("diag") == 2
    rng = np.random.default_rng(0)
    v = rng.uniform(-3, 3, size=(2, 2))
    for b in range(2):
        assert np.abs(prog.states(v)[b] - reference_state(c, v[b])).max() < 1e-12


def test_monomial_runs_fuse_to_one_gather():
    n = 3
    gates = [IrGate("H", (q,)) for q in range(n)] + [IrGate("T", (q,)) for q in range(n)]
    gates += [IrGate("CCX", (0, 1, 2)), IrGate("CX", (0, 1)), IrGate("SWAP", (1, 2)),
              IrGate("CZ", (0, 2)), IrGate("ISWAP", (0, 2)), IrGate("X", (1,)), IrGate("CSWAP", (0, 1, 2)),
              IrGate("Y", (2,)), IrGate("CY", (1, 0))]
    c = circ(n, gates)
    prog = compile_circuit(c)
    assert prog.stats["op_counts"] == {"dense": 3, "mono": 1}  # 3 fused H.T matrices + one gather
    assert prog.stats["mono_fused"] >= 7
    assert np.abs(prog.states(np.zeros((1, 0)))[0] - reference_state(c, np.zeros(0))).max() < 1e-12


def test_clifford_segments_marked():
    c = circ(2, [
        IrGate("H", (0,)), IrGate("CX", (0, 1)), IrGate("T", (1,)),
        IrGate("RZ", (0,), (np.pi / 2,)), IrGate("S", (1,)), IrGate("RX", (0,), (ParamRef("a"),)),
        IrGate("CZ", (0, 1)),
    ], ["a"])
    prog = compile_circuit(c)
    assert prog.clifford_segments == ((0, 2), (3, 5), (6, 7))
    assert prog.stats["clifford_segments"] == 3 and prog.stats["clifford_gates"] == 5


def test_stats_report_backend_and_dtype():
    prog = compile_circuit(circ(1, [IrGate("RX", (0,), (ParamRef("a"),))], ["a"]), backend="numpy")
    assert prog.backend == "numpy" and prog.stats["backend"] == "numpy"
    assert prog.stats["dtype"] == "complex128" and prog.n_qubits == 1 and prog.n_params == 1


# ---------------------------------------------------------- cache + chunks


def test_compile_cache_keyed_by_ir_hash():
    clear_compile_cache()
    mk = lambda ang: circ(2, [IrGate("RX", (0,), (ang,)), IrGate("CX", (0, 1))])
    p1, p2 = compile_circuit(mk(0.5)), compile_circuit(mk(0.5))
    assert p1 is p2
    assert compile_circuit(mk(0.6)) is not p1
    other = mk(0.5)
    other.notes.append("provenance only")
    assert compile_circuit(other) is p1


def test_memory_guard_splits_batches_into_chunks(monkeypatch):
    rng = np.random.default_rng(5)
    c = random_circuit(rng, 5, 25, 4)
    obs = random_observable(rng, 5)
    prog = compile_circuit(c)
    v = rng.uniform(-3, 3, size=(9, 4))
    base_s, base_e = prog.states(v), prog.expectations(v, obs)
    base_v, base_g = prog.value_and_grad(v, obs)
    per_sample = 16 << 5
    monkeypatch.setattr(comp, "MEMORY_GUARD_BYTES", 2 * per_sample)  # 2 samples per chunk
    monkeypatch.setattr(be, "CACHE_CHUNK_BYTES", 10**12)
    assert prog.chunk_size(9) == 2
    assert np.allclose(prog.states(v), base_s, atol=1e-13)
    assert np.allclose(prog.expectations(v, obs), base_e, atol=1e-13)
    val, grad = prog.value_and_grad(v, obs)
    assert np.allclose(val, base_v, atol=1e-13) and np.allclose(grad, base_g, atol=1e-12)
    monkeypatch.setattr(comp, "MEMORY_GUARD_BYTES", 1)  # degenerate: still 1 per chunk
    assert prog.chunk_size(9) == 1


def test_chunk_size_default_respects_cache_target():
    prog = compile_circuit(circ(10, [IrGate("H", (0,))]))
    assert 1 <= prog.chunk_size(4096) <= 4096
    assert prog.chunk_size(1) == 1


def test_backend_selection_and_missing_backend():
    assert BACKENDS[0] == "numpy"
    assert be.get_backend("numpy").name == "numpy"
    assert be.get_backend("auto").name in BACKENDS
    with pytest.raises(ValueError):
        be.get_backend("tpu")
    if "cupy" not in BACKENDS:
        with pytest.raises(ValueError):
            be.get_backend("cupy")
    if "jax" not in BACKENDS:
        with pytest.raises(ValueError):
            be.get_backend("jax")


def test_large_fixed_gate_set_all_fixed_1q_equivalence():
    rng = np.random.default_rng(11)
    for name in ONE_Q_FIXED:
        c = circ(2, [IrGate("H", (0,)), IrGate(name, (0,)), IrGate("CX", (0, 1)), IrGate(name, (1,))])
        got = compile_circuit(c).states(np.zeros((1, 0)))[0]
        assert np.abs(got - reference_state(c, np.zeros(0))).max() < 1e-12


@pytest.mark.parametrize("seed", range(4))
def test_value_and_grad_costate_pauli_is_identical_to_value_and_grad(seed):
    rng = np.random.default_rng(300 + seed)
    n = int(rng.integers(2, 7))
    c = random_circuit(rng, n, 30, 5)
    obs = random_observable(rng, n)
    values = rng.uniform(-3, 3, size=(3, 5))
    prog = compile_circuit(c)
    plan = prog._plan(obs)

    def costate(psi):
        lam = plan.apply(prog._bk, psi)
        return (psi.real * lam.real + psi.imag * lam.imag).sum(axis=1), lam

    v0, g0 = prog.value_and_grad(values, obs)
    v1, g1 = prog.value_and_grad_costate(values, costate)
    assert np.array_equal(v0, v1) and np.array_equal(g0, g1)


def test_value_and_grad_costate_custom_objective_matches_finite_differences():
    rng = np.random.default_rng(11)
    n = 3
    c = random_circuit(rng, n, 24, 4)
    prog = compile_circuit(c)
    values = rng.uniform(-3, 3, size=(2, 4))
    # objective: probability of basis state |0..0>; costate lam = <0|psi> |0>
    def costate(psi):
        amp = psi[:, 0]
        lam = np.zeros_like(psi)
        lam[:, 0] = amp
        return np.abs(amp) ** 2, lam

    val, grad = prog.value_and_grad_costate(values, costate)
    assert grad.shape == (2, 4)
    eps = 1e-6
    for j in range(4):
        up, dn = values.copy(), values.copy()
        up[:, j] += eps
        dn[:, j] -= eps
        fd = (np.abs(prog.states(up)[:, 0]) ** 2 - np.abs(prog.states(dn)[:, 0]) ** 2) / (2 * eps)
        assert np.allclose(grad[:, j], fd, atol=1e-7)
