"""Structure guards for ``trainability_frontier``: trivial-prefix stripping, blocks, light cone, consistency.

Why this module exists (adversarial review PH-H2): the original guards looked at one circuit
(``build(4, L)``) and trusted its gate list at face value. Two exploits followed:

* a program returning a rich ansatz only at ``n == 4`` and a product circuit elsewhere;
* a product circuit dressed with a CZ chain that is a no-op on ``|0...0>``, which made the
  interaction graph connected and the (3n) algebra look big enough.

The rules below close both, and every one is a *necessary* structural property of an honest
``build(n, L)`` family, not a taste:

1. **Trivial-prefix stripping.** Gates that act as a global phase or a basis permutation on a
   computational basis state (diagonal gates on qubits still in a known ``|0>/|1>``, ``CX`` with a
   known control, ...) cannot create entanglement or non-trivial dynamics. They are removed before
   any graph is built, so dressing a product circuit with them buys nothing.
2. **Blocks at every size.** The interaction graph of the stripped circuit must be connected at
   *every* scored ``n`` and *every* probe ``n`` (not only the smallest).
3. **Structural consistency.** The stripped circuits at all sizes must share the entangler pattern
   class, entangler gate, rotation axes, and per-qubit gate densities within a ratio of
   ``DENSITY_RATIO``; an ``n``-dependent switch cannot hide in the sizes we never look at.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from kernel.discovery.features import extract_features
from kernel.trainability.gates import GATE_SPECS
from kernel.trainability.ir import ParamCircuit
from kernel.trainability.pauli import PauliSum

#: Diagonal gates that are the identity unless every touched qubit is ``|1>``.
_PHASE_ON_ALL_ONES = frozenset({"CZ", "CP", "CCZ"})
#: Maximum max/min ratio of a per-qubit density across sizes. Open chains give ``(n-1)/n`` bonds per
#: qubit (0.75 at n=4, ~1 at n=64): a ratio of 1.34, well below this bound; a rich-at-small-n switch
#: gives a ratio of infinity.
DENSITY_RATIO = 1.6
#: A per-term backward light cone this narrow can be simulated exactly by brute force.
LIGHT_CONE_SIMULABLE = 12
_COARSE_PATTERN = {"ladder": "nearest_neighbor", "brick": "nearest_neighbor"}


@dataclass(frozen=True)
class Stripped:
    """A circuit with its trivial gates removed and each kept gate's effective qubit support."""

    circuit: ParamCircuit
    supports: tuple[tuple[int, ...], ...]
    removed: int


def strip_trivial_prefix(circuit: ParamCircuit) -> Stripped:
    """Drop gates that act trivially on ``|0...0>``; see the module docstring (rule 1).

    Each qubit is tracked as a known basis bit (0/1) or ``None`` (possibly superposed or entangled).
    A diagonal gate sheds its known qubits from its support (it is diagonal, so a known basis bit
    only contributes a phase); with no support left it is a global phase and is dropped, and a
    controlled-phase gate with a known ``0`` is the identity. ``X``/``Y``/``CX``/``CY``/``CCX``/
    ``SWAP``/``ISWAP`` on known bits are basis permutations. Everything else is kept and makes its
    qubits unknown.
    """
    bits: list[int | None] = [0] * circuit.n_qubits
    kept, supports = [], []
    for gate in circuit.gates:
        if _is_trivial(gate.name, gate.qubits, bits):
            continue
        qs = gate.qubits
        if GATE_SPECS[gate.name].diagonal:
            rest = tuple(q for q in qs if bits[q] is None)
            kept.append(gate)
            supports.append(rest)
            continue
        for q in qs:
            bits[q] = None
        kept.append(gate)
        supports.append(tuple(qs))
    stripped = replace(circuit, gates=kept)
    return Stripped(stripped, tuple(supports), len(circuit.gates) - len(kept))


def _is_trivial(name: str, qs: tuple[int, ...], bits: list[int | None]) -> bool:
    """True when the gate is a phase / basis permutation on known bits (``bits`` is updated in place)."""
    if GATE_SPECS[name].diagonal:
        if name in _PHASE_ON_ALL_ONES and any(bits[q] == 0 for q in qs):
            return True
        return all(bits[q] is not None for q in qs)
    if name in ("X", "Y"):
        return _flip(bits, qs[0])
    if name in ("CX", "CY"):
        if bits[qs[0]] == 0:
            return True
        if bits[qs[0]] == 1:  # an X/Y on the target: a permutation, never entangling
            _flip(bits, qs[1])
            return True
        return False
    if name == "CCX":
        if any(bits[q] == 0 for q in qs[:2]):
            return True
        if bits[qs[0]] == 1 and bits[qs[1]] == 1:
            _flip(bits, qs[2])
            return True
        return False
    if name in ("SWAP", "ISWAP") and all(bits[q] is not None for q in qs):
        bits[qs[0]], bits[qs[1]] = bits[qs[1]], bits[qs[0]]
        return True
    return False


def _flip(bits: list[int | None], q: int) -> bool:
    """Flip a known bit (a basis permutation); an unknown qubit is left to the generic path."""
    if bits[q] is None:
        return False
    bits[q] = 1 - bits[q]  # type: ignore[operator]
    return True


def interaction_blocks(stripped: Stripped) -> list[list[int]]:
    """Connected components of the qubit graph whose edges are the multi-qubit effective supports.

    More than one block means the circuit is a tensor product of independent sub-circuits: its
    algebra is a direct sum and it is classically simulable block by block.
    """
    n = stripped.circuit.n_qubits
    parent = list(range(n))

    def find(q: int) -> int:
        while parent[q] != q:
            parent[q] = parent[parent[q]]
            q = parent[q]
        return q

    for support in stripped.supports:
        for other in support[1:]:
            parent[find(other)] = find(support[0])
    groups: dict[int, list[int]] = {}
    for q in range(n):
        groups.setdefault(find(q), []).append(q)
    return sorted(groups.values())


def light_cone_width(stripped: Stripped, observable: PauliSum) -> dict[str, Any]:
    """Backward light-cone width (in qubits) of each observable term, through the stripped circuit.

    Heisenberg-picture reachability: a gate whose support meets the cone adds all its qubits to it,
    except that a diagonal gate cannot spread a Z-only string. The brute-force classical cost of one
    term is ``2^width`` amplitudes, so ``max`` over terms bounds the cost of simulating the
    observable one term at a time. Structural (it ignores Clifford cancellations), hence an
    over-estimate of the true cone: it can only make a candidate look harder, which is why the
    scored cost never relies on it alone (see ``_frontier_cost``).
    """
    gates = stripped.circuit.gates
    widths = []
    for term in observable.terms:
        cone = {q for q, _ in term.ops}
        z_only = all(letter == "Z" for _, letter in term.ops)
        for gate, support in zip(reversed(gates), reversed(stripped.supports)):
            if not support or cone.isdisjoint(support):
                continue
            if z_only and GATE_SPECS[gate.name].diagonal:
                continue
            cone.update(support)
            z_only = False
        widths.append(len(cone))
    return {
        "width": max(widths, default=0), "mean_width": sum(widths) / len(widths) if widths else 0.0,
        "n_terms": len(widths), "brute_force_simulable": max(widths, default=0) <= LIGHT_CONE_SIMULABLE,
    }


def signature(stripped: Stripped, n_layers: int) -> dict[str, Any]:
    """Size-independent structural fingerprint of one stripped circuit."""
    feats = extract_features(stripped.circuit, n_layers=n_layers)
    n = stripped.circuit.n_qubits
    pattern = feats["entangler_pattern"]
    return {
        "n_qubits": n,
        "pattern": _COARSE_PATTERN.get(pattern, pattern),
        "entangler": feats["entangler"],
        "rotation_axes": feats["rotation_axes"],
        "two_qubit_gates_per_qubit": feats["two_qubit_gates"] / n,
        "parametric_gates_per_qubit": feats["parametric_gates"] / n,
        "params_per_qubit": feats["params_per_qubit"],
    }


def consistency_problem(signatures: list[dict[str, Any]]) -> str | None:
    """A description of the first structural inconsistency across sizes, or ``None`` (rule 3)."""
    base = signatures[0]
    for other in signatures[1:]:
        for key in ("pattern", "entangler", "rotation_axes"):
            if other[key] != base[key]:
                return (f"the {key.replace('_', ' ')} changes with n: {base[key]!r} at n={base['n_qubits']} "
                        f"but {other[key]!r} at n={other['n_qubits']}")
    for key in ("two_qubit_gates_per_qubit", "parametric_gates_per_qubit", "params_per_qubit"):
        values = [s[key] for s in signatures]
        low, high = min(values), max(values)
        if high > 0 and (low == 0 or high / low > DENSITY_RATIO):
            sized = ", ".join(f"n={s['n_qubits']}: {s[key]:.2f}" for s in signatures)
            return f"{key.replace('_', ' ')} is not consistent across sizes ({sized}; max/min ratio above {DENSITY_RATIO})"
    return None
