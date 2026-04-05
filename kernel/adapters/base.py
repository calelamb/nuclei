from abc import ABC, abstractmethod
from kernel.models.snapshot import CircuitSnapshot, SimulationResult


class FrameworkAdapter(ABC):
    @abstractmethod
    def detect(self, code: str) -> bool:
        """Return True if this adapter handles the given code."""
        pass

    @abstractmethod
    def find_circuit(self, namespace: dict):
        """Find and return the circuit object from the execution namespace."""
        pass

    @abstractmethod
    def extract_snapshot(self, circuit_obj) -> CircuitSnapshot:
        """Extract gate sequence without simulation."""
        pass

    @abstractmethod
    def simulate(self, circuit_obj, shots: int) -> SimulationResult:
        """Run full simulation and return results."""
        pass
