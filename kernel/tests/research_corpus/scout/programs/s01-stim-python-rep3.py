import stim
circuit = stim.Circuit.generated("repetition_code:memory", distance=3, rounds=3, before_round_data_depolarization=0.01)
