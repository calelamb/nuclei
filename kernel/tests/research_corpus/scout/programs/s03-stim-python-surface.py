import stim
circuit = stim.Circuit.generated("surface_code:rotated_memory_z", distance=3, rounds=3,
    after_clifford_depolarization=0.001)
