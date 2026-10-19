import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from kernel.hardware.base import HardwareProvider, BackendInfo, JobHandle
from kernel.executor import Executor


SIMULATED_BACKENDS = [
    BackendInfo(
        name="sim_qasm",
        provider="simulator",
        qubit_count=32,
        connectivity=[(i, i + 1) for i in range(31)],
        queue_length=0,
        average_error_rate=0.0005,
        gate_set=["H", "X", "Y", "Z", "CNOT", "CZ", "RX", "RY", "RZ", "T", "S", "Toffoli", "SWAP", "Measure"],
        status="online",
    ),
    BackendInfo(
        name="sim_statevector",
        provider="simulator",
        qubit_count=24,
        connectivity=[(i, j) for i in range(24) for j in range(i + 1, 24)],
        queue_length=0,
        average_error_rate=0.0,
        gate_set=["H", "X", "Y", "Z", "CNOT", "CZ", "RX", "RY", "RZ", "T", "S", "Toffoli", "SWAP"],
        status="online",
    ),
    BackendInfo(
        name="sim_noise",
        provider="simulator",
        qubit_count=20,
        connectivity=[(i, i + 1) for i in range(19)],
        queue_length=0,
        average_error_rate=0.001,
        gate_set=["H", "X", "Y", "Z", "CNOT", "CZ", "RX", "RY", "RZ", "T", "S", "Measure"],
        status="online",
    ),
]


@dataclass(frozen=True)
class PrecomputedRun:
    """A simulator run the server already performed in a run worker (``result`` / ``error`` wire dicts)."""

    result: dict | None = None
    error: dict | None = None


class SimulatorProvider(HardwareProvider):
    def __init__(self):
        self._executor = Executor()
        self._results: dict[str, dict] = {}

    def connect(self, credentials: dict) -> bool:
        return True

    def list_backends(self) -> list[BackendInfo]:
        return SIMULATED_BACKENDS

    def submit_job(self, circuit_obj, backend: str, shots: int) -> JobHandle:
        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        if isinstance(circuit_obj, PrecomputedRun):
            return self._finish(job_id, now, backend, shots, circuit_obj.result, circuit_obj.error)

        # Source passed directly (tests, embedders): run it here. The kernel server never gets
        # here with user code; it hands over a PrecomputedRun produced in a run worker.
        code = circuit_obj if isinstance(circuit_obj, str) else ""
        result, snapshot, stdout, stderr, error = self._executor.execute(code, shots)
        # stderr from the simulated backend is currently unused — the outer
        # JobHandle carries status/error separately — but the return tuple
        # exposes it for future surfacing.
        _ = stderr

        return self._finish(
            job_id, now, backend, shots, result.to_dict() if result else {}, error.to_dict() if error else None
        )

    def _finish(self, job_id: str, now: str, backend: str, shots: int, result: dict | None, error: dict | None) -> JobHandle:
        if error:
            handle = JobHandle(
                id=job_id,
                provider="simulator",
                backend=backend,
                status="failed",
                queue_position=None,
                shots=shots,
                submitted_at=now,
            )
            self._results[job_id] = {"error": error}
        else:
            handle = JobHandle(
                id=job_id,
                provider="simulator",
                backend=backend,
                status="complete",
                queue_position=None,
                shots=shots,
                submitted_at=now,
            )
            self._results[job_id] = result or {}

        return handle

    def get_results(self, job: JobHandle) -> dict:
        return self._results.get(job.id, {})

    def get_queue_position(self, job: JobHandle) -> int:
        return 0
