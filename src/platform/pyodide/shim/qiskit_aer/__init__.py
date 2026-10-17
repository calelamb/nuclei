"""AerSimulator (browser subset): ideal statevector sampling only, no noise models."""

import time

from _nuclei_unsupported import unsupported, make_getattr
from qiskit.exceptions import QiskitError
from qiskit import _simulate as sim
from qiskit.circuit.quantumcircuit import QuantumCircuit


class Result:
    def __init__(self, circuits, counts_list, shots, backend_name, elapsed):
        self._circuits = circuits
        self._counts = counts_list
        self.success = True
        self.backend_name = backend_name
        self.time_taken = elapsed
        self.shots = shots

    def get_counts(self, experiment=None):
        if experiment is None:
            idx = 0 if len(self._counts) == 1 else None
            if idx is None:
                return list(self._counts)
        elif isinstance(experiment, int):
            idx = experiment
        else:
            idx = next(i for i, c in enumerate(self._circuits) if c is experiment)
        return self._counts[idx]

    def get_statevector(self, *_a, **_k):
        unsupported("Result.get_statevector() (use qiskit.quantum_info.Statevector instead)")


class Job:
    def __init__(self, result):
        self._result = result

    def result(self):
        return self._result

    def job_id(self):
        return "browser-job-0"

    def status(self):
        return "DONE"

    def in_final_state(self):
        return True


class AerSimulator:
    name = "aer_simulator"

    def __init__(self, method=None, noise_model=None, seed_simulator=None, **options):
        if noise_model is not None:
            unsupported("AerSimulator(noise_model=...)")
        if method not in (None, "automatic", "statevector"):
            unsupported(f"AerSimulator(method={method!r})")
        self._seed = seed_simulator
        self._options = options

    def run(self, circuits, shots=1024, seed_simulator=None, **_options):
        batch = list(circuits) if isinstance(circuits, (list, tuple)) else [circuits]
        for c in batch:
            if not isinstance(c, QuantumCircuit):
                raise QiskitError("AerSimulator.run expects QuantumCircuit objects")
        seed = seed_simulator if seed_simulator is not None else self._seed
        start = time.time()
        counts = []
        for circuit in batch:
            raw = sim.run_counts(circuit, int(shots), seed)
            counts.append({sim.format_key(v, circuit): n for v, n in raw.items()})
        return Job(Result(batch, counts, int(shots), self.name, time.time() - start))

    def status(self):
        return "ready"


__getattr__ = make_getattr("qiskit_aer")
