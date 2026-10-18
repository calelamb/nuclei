"""Noise insertion: each formula is checked by counting inserted instructions."""

from __future__ import annotations

from collections import Counter

import pytest

stim = pytest.importorskip("stim")

from kernel.discovery.noise import apply_noise, biased_z, si1000, uniform  # noqa: E402

P = 0.01

# one 1q gate, one CX layer, then a measure+reset layer, with an idle qubit (2).
SMALL = stim.Circuit(
    """
    R 0 1 2
    TICK
    H 0
    TICK
    CX 0 1
    TICK
    MR 1
    TICK
    M 0
    DETECTOR rec[-1]
    OBSERVABLE_INCLUDE(0) rec[-1]
    """
)


def applications(noisy: stim.Circuit) -> Counter:
    """Multiset of atomic noise applications: (name, rounded args, qubit or pair).

    Stim fuses adjacent identical instructions, so tests count per-target
    applications rather than instruction objects.
    """
    out: Counter = Counter()
    for inst in noisy:
        data = stim.gate_data(inst.name)
        if not data.is_noisy_gate or data.produces_measurements:
            continue
        args = tuple(round(a, 12) for a in inst.gate_args_copy())
        targets = [t.value for t in inst.targets_copy()]
        if data.is_two_qubit_gate:
            for a, b in zip(targets[0::2], targets[1::2]):
                out[(inst.name, args, (a, b))] += 1
        else:
            for t in targets:
                out[(inst.name, args, t)] += 1
    return out


def expected(entries: dict) -> Counter:
    out: Counter = Counter()
    for (name, args, target), count in entries.items():
        out[(name, tuple(round(a, 12) for a in args), target)] += count
    return out


def test_noise_does_not_change_measurement_count_or_detectors():
    for model in (uniform, si1000):
        noisy = model(SMALL, P)
        assert noisy.num_measurements == SMALL.num_measurements
        assert noisy.num_detectors == SMALL.num_detectors
        assert noisy.num_observables == SMALL.num_observables


# Layers of SMALL (active qubits 0,1,2):
#   L1 R 0 1 2 | L2 H 0 | L3 CX 0 1 | L4 MR 1 | L5 M 0 (+ annotations)


def test_uniform_counts():
    got = applications(uniform(SMALL, P))
    want = expected({
        ("X_ERROR", (P,), 0): 2, ("X_ERROR", (P,), 1): 3, ("X_ERROR", (P,), 2): 1,
        ("DEPOLARIZE1", (P,), 0): 2, ("DEPOLARIZE1", (P,), 1): 2, ("DEPOLARIZE1", (P,), 2): 4,
        ("DEPOLARIZE2", (P,), (0, 1)): 1,
    })
    assert got == want


def test_uniform_x_basis_measurement_gets_z_flip():
    circuit = stim.Circuit("RX 0\nTICK\nMX 0\nDETECTOR rec[-1]\nOBSERVABLE_INCLUDE(0) rec[-1]")
    got = applications(uniform(circuit, P))
    assert got == expected({("Z_ERROR", (P,), 0): 2})


def test_y_basis_uses_anticommuting_flip():
    circuit = stim.Circuit("RY 0\nTICK\nMY 0\nDETECTOR rec[-1]\nOBSERVABLE_INCLUDE(0) rec[-1]")
    assert applications(uniform(circuit, P)) == expected({("X_ERROR", (P,), 0): 2})


def test_si1000_rates_and_resonator():
    got = applications(si1000(SMALL, P))
    want = expected({
        # reset flip 2p: R 0 1 2 and the reset half of MR 1; measurement flip 5p: MR 1, M 0
        ("X_ERROR", (2 * P,), 0): 1, ("X_ERROR", (2 * P,), 1): 2, ("X_ERROR", (2 * P,), 2): 1,
        ("X_ERROR", (5 * P,), 0): 1, ("X_ERROR", (5 * P,), 1): 1,
        # 1q gate p/10 (H on 0) + idle p/10 in non-measure layers (L2: 1,2; L3: 2)
        ("DEPOLARIZE1", (P / 10,), 0): 1, ("DEPOLARIZE1", (P / 10,), 1): 1, ("DEPOLARIZE1", (P / 10,), 2): 2,
        # resonator idle 2p on qubits not measured/reset (L4: 0,2; L5: 1,2)
        ("DEPOLARIZE1", (2 * P,), 0): 1, ("DEPOLARIZE1", (2 * P,), 1): 1, ("DEPOLARIZE1", (2 * P,), 2): 2,
        ("DEPOLARIZE2", (P,), (0, 1)): 1,
    })
    assert got == want


def test_biased_z_channels():
    eta = 10.0
    px = P / (2 * (1 + eta))
    pz = P * eta / (1 + eta)
    assert 2 * px + pz == pytest.approx(P)
    got = applications(biased_z(SMALL, P, eta))
    channel = (px, px, pz)
    want = expected({
        ("X_ERROR", (P,), 0): 2, ("X_ERROR", (P,), 1): 3, ("X_ERROR", (P,), 2): 1,
        # uniform's DEPOLARIZE1 counts, plus both qubits of the CX
        ("PAULI_CHANNEL_1", channel, 0): 3, ("PAULI_CHANNEL_1", channel, 1): 3, ("PAULI_CHANNEL_1", channel, 2): 4,
        ("DEPOLARIZE2", (P / 10,), (0, 1)): 1,
    })
    assert got == want


def test_apply_noise_flattens_repeat():
    circuit = stim.Circuit("R 0 1\nREPEAT 4 {\n  TICK\n  CX 0 1\n}\nM 0\nOBSERVABLE_INCLUDE(0) rec[-1]")
    noisy = apply_noise(circuit, "uniform", P)
    assert sum(c for (n, _, _), c in applications(noisy).items() if n == "DEPOLARIZE2") == 4
    assert "REPEAT" not in str(noisy)


def test_inputs_are_not_mutated_and_output_is_new():
    before = str(SMALL)
    out = uniform(SMALL, P)
    assert str(SMALL) == before and out is not SMALL


def test_bad_arguments():
    with pytest.raises(ValueError):
        apply_noise(SMALL, "nope", P)
    with pytest.raises(ValueError):
        apply_noise(SMALL, "uniform", 0.9)


def test_classically_controlled_gate_gets_single_qubit_noise_only():
    circuit = stim.Circuit("R 0 1\nTICK\nM 0\nTICK\nCX rec[-1] 1\nM 1\nOBSERVABLE_INCLUDE(0) rec[-1]")
    got = applications(uniform(circuit, P))
    assert not [k for k in got if k[0] == "DEPOLARIZE2"]
    assert got[("DEPOLARIZE1", (P,), 1)] >= 1


def test_generated_surface_code_noise_is_sampleable():
    clean = stim.Circuit.generated("surface_code:rotated_memory_z", distance=3, rounds=3)
    clean_flat = clean.flattened()
    for model in (uniform, si1000):
        noisy = model(clean_flat, 1e-3)
        dem = noisy.detector_error_model(decompose_errors=True)
        assert dem.num_detectors == clean.num_detectors
