"""Dense statevector simulation for the browser Qiskit subset.

Qiskit conventions: qubit 0 is the least significant bit of a basis index, and
count keys print clbit 0 rightmost. State vectors are held as tensors of shape
(2,) * n where axis `n - 1 - q` belongs to qubit `q` (C-order reshape of the
little-endian vector).
"""

import numpy as np

from qiskit.exceptions import QiskitError

MAX_QUBITS = 22  # 2**22 complex amplitudes ~ 64 MB; beyond this the tab would die


def check_size(num_qubits):
    if num_qubits > MAX_QUBITS:
        raise QiskitError(
            f"The browser version simulates up to {MAX_QUBITS} qubits "
            f"(this circuit has {num_qubits}). Open it in the Nuclei desktop app for more."
        )


def zero_state(n):
    check_size(n)
    state = np.zeros(2**n, dtype=complex)
    state[0] = 1.0
    return state


def apply_matrix(state, matrix, qargs, n):
    """Apply a 2^k x 2^k matrix (qargs[0] = least significant bit) to a flat state."""
    k = len(qargs)
    tensor = state.reshape((2,) * n)
    m = np.asarray(matrix, dtype=complex).reshape((2,) * (2 * k))
    state_axes = [n - 1 - q for q in reversed(qargs)]
    out = np.tensordot(m, tensor, axes=(list(range(k, 2 * k)), state_axes))
    out = np.moveaxis(out, list(range(k)), state_axes)
    return np.ascontiguousarray(out).reshape(-1)


def flatten(circuit, qmap=None, cmap=None):
    """Expand composite gates; yield (op, qubit_indices, clbit_indices, condition)."""
    qmap = qmap if qmap is not None else list(range(circuit.num_qubits))
    cmap = cmap if cmap is not None else list(range(circuit.num_clbits))
    for inst in circuit.data:
        qs = [qmap[circuit.find_bit(q).index] for q in inst.qubits]
        cs = [cmap[circuit.find_bit(c).index] for c in inst.clbits]
        op = inst.operation
        condition = _condition_indices(circuit, op, cmap)
        definition = getattr(op, "definition", None)
        if definition is not None and op._matrix() is None:
            yield from flatten(definition, qs, cs)
        else:
            yield op, qs, cs, condition


def _condition_indices(circuit, op, cmap):
    bits = circuit.condition_bits(op)
    if not bits:
        return None
    return [cmap[circuit.find_bit(b).index] for b in bits], int(op.condition[1])


def _reject_non_unitary(op):
    if op.name in ("measure", "reset"):
        raise QiskitError(
            f"Cannot apply instruction with classical bits: {op.name}. "
            "Remove measurements first (circuit.remove_final_measurements())."
        )


def statevector(circuit, initial=None):
    """Final statevector of the unitary part of `circuit` (measurement is an error)."""
    n = circuit.num_qubits
    state = zero_state(n) if initial is None else np.array(initial, dtype=complex)
    for op, qs, _cs, cond in flatten(circuit):
        if op.name == "barrier":
            continue
        _reject_non_unitary(op)
        if cond is not None:
            raise QiskitError("Classically conditioned gates have no statevector.")
        state = apply_matrix(state, _unitary_of(op), qs, n)
    return state


def _unitary_of(op):
    m = op._matrix()
    if m is None:
        raise QiskitError(f"Cannot simulate instruction '{op.name}' in the browser subset.")
    return m


def _needs_trajectories(ops):
    measured = set()
    for op, qs, _cs, cond in ops:
        if cond is not None or op.name == "reset":
            return True
        if op.name == "measure":
            measured.update(qs)
        elif op.name != "barrier" and measured.intersection(qs):
            return True
    return False


def run_counts(circuit, shots, seed=None):
    """Return {clbit_value_int: count} for `shots` runs of `circuit`."""
    rng = np.random.default_rng(seed)
    ops = list(flatten(circuit))
    n = circuit.num_qubits
    check_size(n)
    if _needs_trajectories(ops):
        return _trajectory_counts(ops, n, shots, rng)
    return _sampled_counts(ops, n, shots, rng)


def _sampled_counts(ops, n, shots, rng):
    state = zero_state(n)
    measure_map = {}
    for op, qs, cs, _cond in ops:
        if op.name == "barrier":
            continue
        if op.name == "measure":
            measure_map[cs[0]] = qs[0]
            continue
        state = apply_matrix(state, _unitary_of(op), qs, n)
    if not measure_map:
        return {}
    probs = np.abs(state) ** 2
    probs = probs / probs.sum()
    samples = rng.choice(len(probs), size=shots, p=probs)
    values = np.zeros(shots, dtype=np.int64)
    for clbit, qubit in measure_map.items():
        values |= ((samples >> qubit) & 1).astype(np.int64) << clbit
    uniq, counts = np.unique(values, return_counts=True)
    return {int(v): int(c) for v, c in zip(uniq, counts)}


def _measure_qubit(state, qubit, n, rng):
    tensor = state.reshape((2,) * n)
    axis = n - 1 - qubit
    p1 = float(np.sum(np.abs(np.take(tensor, 1, axis=axis)) ** 2))
    outcome = 1 if rng.random() < p1 else 0
    collapsed = np.zeros_like(tensor)
    sl = [slice(None)] * n
    sl[axis] = outcome
    collapsed[tuple(sl)] = tensor[tuple(sl)]
    norm = np.linalg.norm(collapsed)
    return (collapsed / norm).reshape(-1), outcome


def _condition_met(cond, clvalues):
    if cond is None:
        return True
    bits, value = cond
    got = 0
    for i, b in enumerate(bits):
        got |= clvalues.get(b, 0) << i
    return got == value


def _run_trajectory(ops, n, rng):
    """One shot with collapse: returns (final_state, {clbit_index: bit})."""
    x_matrix = np.array([[0, 1], [1, 0]], dtype=complex)
    state = zero_state(n)
    cl = {}
    for op, qs, cs, cond in ops:
        if op.name == "barrier" or not _condition_met(cond, cl):
            continue
        if op.name == "measure":
            state, cl[cs[0]] = _measure_qubit(state, qs[0], n, rng)
        elif op.name == "reset":
            state, bit = _measure_qubit(state, qs[0], n, rng)
            if bit:
                state = apply_matrix(state, x_matrix, qs, n)
        else:
            state = apply_matrix(state, _unitary_of(op), qs, n)
    return state, cl


def _trajectory_counts(ops, n, shots, rng):
    results = {}
    for _ in range(shots):
        _state, cl = _run_trajectory(ops, n, rng)
        value = sum(bit << idx for idx, bit in cl.items())
        results[value] = results.get(value, 0) + 1
    return results


def is_unitary_with_final_measurements(circuit):
    """True when removing trailing measurements leaves a pure unitary circuit."""
    return not _needs_trajectories(list(flatten(circuit)))


def _drop_final_measurements(ops):
    """Remove each qubit's trailing measurements, like remove_final_measurements().

    A measurement stays when anything later acts on its qubit or reads the
    classical bit it wrote (c_if), so only genuinely final readout is dropped.
    """
    busy_qubits, needed_clbits = set(), set()
    kept = []
    for op, qs, cs, cond in reversed(ops):
        if op.name == "barrier":
            kept.append((op, qs, cs, cond))
            continue
        final = op.name == "measure" and qs[0] not in busy_qubits and cs[0] not in needed_clbits
        if final:
            continue
        busy_qubits.update(qs)
        if cond is not None:
            needed_clbits.update(cond[0])
        kept.append((op, qs, cs, cond))
    kept.reverse()
    return kept


def trajectory_state(circuit, seed=None):
    """State before the final readout of a single collapsed run.

    Mid-circuit measurements and resets collapse the state (as on the desktop
    simulator); trailing measurements are not applied, so a circuit such as
    h, measure, h, measure shows the post-second-h state, not a basis state.
    """
    n = circuit.num_qubits
    check_size(n)
    ops = _drop_final_measurements(list(flatten(circuit)))
    state, _cl = _run_trajectory(ops, n, np.random.default_rng(seed))
    return state


def format_key(value, circuit):
    """Format a clbit integer as Qiskit does: registers highest-first, space separated."""
    total = circuit.num_clbits
    if total == 0:
        return ""
    segments = []
    covered = 0
    for creg in reversed(circuit.cregs):
        idxs = [circuit.find_bit(b).index for b in creg]
        if not idxs:
            continue
        bits = "".join(str((value >> i) & 1) for i in reversed(idxs))
        segments.append(bits)
        covered += len(idxs)
    if covered < total:  # loose clbits that belong to no register
        registered = {circuit.find_bit(b).index for r in circuit.cregs for b in r}
        loose = [i for i in range(total) if i not in registered]
        segments.append("".join(str((value >> i) & 1) for i in reversed(loose)))
    return " ".join(segments)
