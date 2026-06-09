from abc import ABC, abstractmethod
from kernel.models.errors import KernelError
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

    def parse_source(
        self, code: str
    ) -> tuple[CircuitSnapshot | None, str, str, KernelError | None]:
        """Compile source directly and return (snapshot, stdout, stderr, error).

        Source-mode adapters (e.g. Q#) own the whole pipeline: their source
        never reaches Python exec(), so the executor delegates wholesale to
        this method. Python-framework adapters never implement it.
        """
        raise NotImplementedError(
            f"{type(self).__name__} does not support source-mode parsing"
        )

    def execute_source(
        self, code: str, shots: int
    ) -> tuple[
        SimulationResult | None, CircuitSnapshot | None, str, str, KernelError | None
    ]:
        """Compile + simulate source directly and return
        (result, snapshot, stdout, stderr, error).

        Same contract as Executor.execute — source-mode adapters return the
        full tuple so the executor can pass it through unchanged.
        """
        raise NotImplementedError(
            f"{type(self).__name__} does not support source-mode execution"
        )
