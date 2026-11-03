# QML benchmark results (Nuclei Trainability Lab APIs, seed 7)

| dataset | n | model | test acc | train acc | wall s | extra |
|---|---|---|---|---|---|---|
| moons | 48 | vqc_adam_L2 | 0.357 | 0.735 | 0.048 | loss=0.8241 |
| moons | 48 | vqc_spsa_L2 | 0.500 | 0.588 | 0.05 | loss=0.8766 |
| moons | 48 | vqc_qng_L2 | 0.357 | 0.735 | 0.119 | loss=0.8239 |
| moons | 48 | vqc_adam_L2_noisy | 0.429 | 0.676 | 0.061 | loss=0.8755 |
| moons | 48 | quantum_kernel | 0.714 | 0.912 | 0.001 | alignment=0.3086 |
| moons | 48 | classical_best[rbf] | 0.929 | 0.971 | 0.007 | verdict=classical_ahead; geometric_difference=2.7986 |
| moons | 120 | vqc_adam_L2 | 0.639 | 0.571 | 0.085 | loss=0.9163 |
| moons | 120 | vqc_spsa_L2 | 0.528 | 0.488 | 0.061 | loss=1.0676 |
| moons | 120 | vqc_qng_L2 | 0.611 | 0.607 | 0.152 | loss=0.9124 |
| moons | 120 | vqc_adam_L2_noisy | 0.611 | 0.619 | 0.078 | loss=0.8945 |
| moons | 120 | quantum_kernel | 0.806 | 0.845 | 0.003 | alignment=0.2830 |
| moons | 120 | classical_best[rbf] | 0.972 | 0.952 | 0.009 | verdict=classical_ahead; geometric_difference=4.6588 |
| moons | 200 | vqc_adam_L2 | 0.450 | 0.607 | 0.099 | loss=0.9552 |
| moons | 200 | vqc_spsa_L2 | 0.533 | 0.443 | 0.076 | loss=1.1795 |
| moons | 200 | vqc_qng_L2 | 0.433 | 0.564 | 0.191 | loss=0.9385 |
| moons | 200 | vqc_adam_L2_noisy | 0.417 | 0.586 | 0.099 | loss=0.9391 |
| moons | 200 | quantum_kernel | 0.767 | 0.871 | 0.006 | alignment=0.2738 |
| moons | 200 | classical_best[rbf] | 1.000 | 0.993 | 0.02 | verdict=classical_ahead; geometric_difference=6.0855 |
| circles | 48 | vqc_adam_L2 | 1.000 | 1.000 | 0.072 | loss=0.1026 |
| circles | 48 | vqc_spsa_L2 | 1.000 | 0.912 | 0.048 | loss=0.3152 |
| circles | 48 | vqc_qng_L2 | 1.000 | 1.000 | 0.117 | loss=0.1042 |
| circles | 48 | vqc_adam_L2_noisy | 1.000 | 1.000 | 0.062 | loss=0.1518 |
| circles | 48 | quantum_kernel | 1.000 | 1.000 | 0.001 | alignment=0.3865 |
| circles | 48 | classical_best[rbf] | 1.000 | 1.000 | 0.002 | verdict=tie; geometric_difference=1.3681 |
| circles | 120 | vqc_adam_L2 | 1.000 | 1.000 | 0.087 | loss=0.1419 |
| circles | 120 | vqc_spsa_L2 | 0.917 | 0.940 | 0.064 | loss=0.2936 |
| circles | 120 | vqc_qng_L2 | 1.000 | 1.000 | 0.155 | loss=0.1384 |
| circles | 120 | vqc_adam_L2_noisy | 0.972 | 1.000 | 0.085 | loss=0.2048 |
| circles | 120 | quantum_kernel | 1.000 | 1.000 | 0.004 | alignment=0.3938 |
| circles | 120 | classical_best[rbf] | 1.000 | 1.000 | 0.013 | verdict=tie; geometric_difference=1.4710 |
| circles | 200 | vqc_adam_L2 | 0.950 | 0.993 | 0.102 | loss=0.1595 |
| circles | 200 | vqc_spsa_L2 | 0.917 | 0.929 | 0.084 | loss=0.3146 |
| circles | 200 | vqc_qng_L2 | 0.950 | 0.993 | 0.194 | loss=0.1594 |
| circles | 200 | vqc_adam_L2_noisy | 0.967 | 0.993 | 0.098 | loss=0.2185 |
| circles | 200 | quantum_kernel | 0.983 | 1.000 | 0.006 | alignment=0.3961 |
| circles | 200 | classical_best[rbf] | 0.983 | 1.000 | 0.02 | verdict=tie; geometric_difference=1.5264 |
| blobs | 48 | vqc_adam_L2 | 0.714 | 0.706 | 0.072 | loss=0.8311 |
| blobs | 48 | vqc_spsa_L2 | 0.714 | 0.676 | 0.049 | loss=0.9967 |
| blobs | 48 | vqc_qng_L2 | 0.714 | 0.706 | 0.118 | loss=0.8308 |
| blobs | 48 | vqc_adam_L2_noisy | 0.643 | 0.647 | 0.062 | loss=0.8666 |
| blobs | 48 | quantum_kernel | 1.000 | 1.000 | 0.001 | alignment=0.8705 |
| blobs | 48 | classical_best[rbf] | 0.929 | 0.971 | 0.002 | verdict=tie; geometric_difference=1.5192 |
| blobs | 120 | vqc_adam_L2 | 0.556 | 0.571 | 0.085 | loss=0.9527 |
| blobs | 120 | vqc_spsa_L2 | 0.444 | 0.512 | 0.062 | loss=1.0975 |
| blobs | 120 | vqc_qng_L2 | 0.528 | 0.583 | 0.151 | loss=0.9493 |
| blobs | 120 | vqc_adam_L2_noisy | 0.583 | 0.595 | 0.079 | loss=0.9418 |
| blobs | 120 | quantum_kernel | 0.972 | 1.000 | 0.002 | alignment=0.8557 |
| blobs | 120 | classical_best[rbf] | 0.944 | 1.000 | 0.008 | verdict=quantum_ahead; geometric_difference=2.0405 |
| blobs | 200 | vqc_adam_L2 | 0.583 | 0.621 | 0.099 | loss=0.9238 |
| blobs | 200 | vqc_spsa_L2 | 0.600 | 0.621 | 0.077 | loss=0.9597 |
| blobs | 200 | vqc_qng_L2 | 0.583 | 0.614 | 0.191 | loss=0.9239 |
| blobs | 200 | vqc_adam_L2_noisy | 0.567 | 0.607 | 0.098 | loss=0.9292 |
| blobs | 200 | quantum_kernel | 1.000 | 1.000 | 0.006 | alignment=0.8718 |
| blobs | 200 | classical_best[rbf] | 1.000 | 0.993 | 0.02 | verdict=tie; geometric_difference=1.6883 |
| xor | 48 | vqc_adam_L2 | 1.000 | 0.971 | 0.072 | loss=0.2154 |
| xor | 48 | vqc_spsa_L2 | 0.786 | 0.824 | 0.048 | loss=0.7281 |
| xor | 48 | vqc_qng_L2 | 1.000 | 0.971 | 0.115 | loss=0.2151 |
| xor | 48 | vqc_adam_L2_noisy | 1.000 | 0.941 | 0.062 | loss=0.2686 |
| xor | 48 | quantum_kernel | 0.929 | 0.971 | 0.001 | alignment=0.2878 |
| xor | 48 | classical_best[rbf] | 1.000 | 0.882 | 0.002 | verdict=tie; geometric_difference=1.3590 |
| xor | 120 | vqc_adam_L2 | 0.972 | 0.988 | 0.085 | loss=0.1633 |
| xor | 120 | vqc_spsa_L2 | 0.972 | 0.786 | 0.061 | loss=0.6724 |
| xor | 120 | vqc_qng_L2 | 0.972 | 0.988 | 0.152 | loss=0.1623 |
| xor | 120 | vqc_adam_L2_noisy | 0.972 | 0.988 | 0.079 | loss=0.2223 |
| xor | 120 | quantum_kernel | 0.972 | 0.976 | 0.002 | alignment=0.3898 |
| xor | 120 | classical_best[rbf] | 1.000 | 0.976 | 0.008 | verdict=classical_ahead; geometric_difference=1.4342 |
| xor | 200 | vqc_adam_L2 | 0.983 | 0.986 | 0.099 | loss=0.1292 |
| xor | 200 | vqc_spsa_L2 | 0.933 | 0.900 | 0.077 | loss=0.5055 |
| xor | 200 | vqc_qng_L2 | 0.983 | 0.993 | 0.193 | loss=0.1338 |
| xor | 200 | vqc_adam_L2_noisy | 0.983 | 0.986 | 0.098 | loss=0.1843 |
| xor | 200 | quantum_kernel | 0.983 | 0.986 | 0.006 | alignment=0.4183 |
| xor | 200 | classical_best[rbf] | 0.983 | 0.993 | 0.02 | verdict=tie; geometric_difference=1.4797 |
| moons | 120 | vqc_adam_L1 | 0.500 | 0.548 | 0.055 | loss=0.9938 |
| moons | 120 | vqc_adam_L3 | 0.583 | 0.583 | 0.086 | loss=0.8770 |
| moons | 120 | vqc_adam_L4 | 0.639 | 0.631 | 0.102 | loss=0.9456 |
| moons | 120 | kernel_alignment_search | 0.778 | 0.833 | 0.052 | alignment_before=0.2909; alignment_after=0.3277 |
| circles | 120 | vqc_adam_L1 | 0.917 | 0.917 | 0.055 | loss=0.4318 |
| circles | 120 | vqc_adam_L3 | 1.000 | 1.000 | 0.086 | loss=0.1303 |
| circles | 120 | vqc_adam_L4 | 0.861 | 0.940 | 0.102 | loss=0.2546 |
| circles | 120 | kernel_alignment_search | 1.000 | 1.000 | 0.053 | alignment_before=0.3907; alignment_after=0.3948 |
| blobs | 120 | vqc_adam_L1 | 0.528 | 0.560 | 0.055 | loss=0.9602 |
| blobs | 120 | vqc_adam_L3 | 0.611 | 0.607 | 0.086 | loss=0.9319 |
| blobs | 120 | vqc_adam_L4 | 0.500 | 0.655 | 0.101 | loss=0.9191 |
| blobs | 120 | kernel_alignment_search | 1.000 | 1.000 | 0.052 | alignment_before=0.8532; alignment_after=0.8870 |
| xor | 120 | vqc_adam_L1 | 0.444 | 0.560 | 0.054 | loss=0.9423 |
| xor | 120 | vqc_adam_L3 | 0.944 | 0.988 | 0.085 | loss=0.1299 |
| xor | 120 | vqc_adam_L4 | 0.944 | 0.964 | 0.102 | loss=0.3043 |
| xor | 120 | kernel_alignment_search | 1.000 | 0.988 | 0.052 | alignment_before=0.3873; alignment_after=0.4538 |
