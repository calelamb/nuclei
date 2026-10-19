from dataclasses import dataclass
from qiskit import QuantumCircuit
@dataclass
class Cfg:
    n: int = 3
cfg = Cfg()
qc = QuantumCircuit(cfg.n, cfg.n); qc.h(range(cfg.n)); qc.measure(range(cfg.n), range(cfg.n))
