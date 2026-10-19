"""Seed program: bit-flip repetition-code memory (noiseless).

The evaluator applies all noise; this program only describes the ideal circuit.
Edit the CX schedule between the EVOLVE-BLOCK markers.
"""
import stim


def build(distance: int, rounds: int) -> stim.Circuit:
    n = distance
    data = list(range(0, 2 * n - 1, 2))
    anc = list(range(1, 2 * n - 1, 2))
    circuit = stim.Circuit()
    circuit.append("R", data + anc)
    circuit.append("TICK")
    for r in range(rounds):
        # EVOLVE-BLOCK-START
        for i in range(n - 1):
            circuit.append("CX", [data[i], anc[i]])
        circuit.append("TICK")
        for i in range(n - 1):
            circuit.append("CX", [data[i + 1], anc[i]])
        circuit.append("TICK")
        # EVOLVE-BLOCK-END
        circuit.append("MR", anc)
        for i in range(n - 1):
            if r == 0:
                circuit.append("DETECTOR", [stim.target_rec(-(n - 1) + i)], [i, r])
            else:
                circuit.append(
                    "DETECTOR",
                    [stim.target_rec(-(n - 1) + i), stim.target_rec(-2 * (n - 1) + i)],
                    [i, r],
                )
        circuit.append("TICK")
    circuit.append("M", data)
    for i in range(n - 1):
        circuit.append(
            "DETECTOR",
            [
                stim.target_rec(-n + i),
                stim.target_rec(-n + i + 1),
                stim.target_rec(-n - (n - 1) + i),
            ],
            [i, rounds],
        )
    circuit.append("OBSERVABLE_INCLUDE", [stim.target_rec(-n)], 0)
    return circuit
