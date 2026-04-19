from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class BackendInfo:
    name: str
    provider: str  # 'ibm' | 'google' | 'ionq' | 'simulator'
    qubit_count: int
    connectivity: list[tuple[int, int]]
    queue_length: int
    average_error_rate: float
    gate_set: list[str]
    status: str  # 'online' | 'offline' | 'maintenance'

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "provider": self.provider,
            "qubit_count": self.qubit_count,
            "connectivity": [list(pair) for pair in self.connectivity],
            "queue_length": self.queue_length,
            "average_error_rate": self.average_error_rate,
            "gate_set": self.gate_set,
            "status": self.status,
        }


@dataclass
class JobHandle:
    id: str
    provider: str
    backend: str
    status: str  # 'queued' | 'running' | 'complete' | 'failed'
    queue_position: int | None
    shots: int
    submitted_at: str

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "provider": self.provider,
            "backend": self.backend,
            "status": self.status,
            "queue_position": self.queue_position,
            "shots": self.shots,
            "submitted_at": self.submitted_at,
        }


class HardwareProvider(ABC):
    @abstractmethod
    def connect(self, credentials: dict) -> bool:
        """Authenticate with the hardware provider."""
        pass

    @abstractmethod
    def list_backends(self) -> list[BackendInfo]:
        """Return available backends from this provider."""
        pass

    @abstractmethod
    def submit_job(self, circuit_obj, backend: str, shots: int) -> JobHandle:
        """Submit a circuit for execution on the specified backend."""
        pass

    @abstractmethod
    def get_results(self, job: JobHandle) -> dict:
        """Retrieve results for a completed job."""
        pass

    @abstractmethod
    def get_queue_position(self, job: JobHandle) -> int:
        """Return current queue position for a pending job."""
        pass

    def cancel_job(self, job: JobHandle) -> bool:
        """Best-effort cancel of a queued/running job. Default: no-op returning
        True for providers whose jobs complete synchronously (local simulator
        and NVIDIA CUDA-Q). Override for real queue-backed providers."""
        return True
