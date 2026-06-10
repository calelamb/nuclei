"""Worked example for /docs/extending/hardware-providers/ — the smallest
possible HardwareProvider.

Modeled on kernel/hardware/simulator_provider.py: jobs complete
synchronously, and "results" just echo the requested shot count into a fake
counts dict. kernel/tests/test_docs_examples.py runs this file against a
real HardwareManager so the example cannot rot.
"""

import uuid
from datetime import datetime, timezone

from kernel.hardware.base import BackendInfo, HardwareProvider, JobHandle

ECHO_BACKEND = BackendInfo(
    name="echo_1",
    provider="echo",
    qubit_count=8,
    connectivity=[(i, i + 1) for i in range(7)],
    queue_length=0,
    average_error_rate=0.0,
    gate_set=["H", "X", "CNOT", "Measure"],
    status="online",
)


class EchoProvider(HardwareProvider):
    def __init__(self):
        self._results: dict[str, dict] = {}

    def connect(self, credentials: dict) -> bool:
        # Validate credentials and authenticate with the vendor SDK here.
        # Return False (don't raise) when auth fails. Echo accepts anything.
        return True

    def list_backends(self) -> list[BackendInfo]:
        # Return [] when not connected; never raise from here.
        return [ECHO_BACKEND]

    def submit_job(self, circuit_obj, backend: str, shots: int) -> JobHandle:
        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        # Synchronous "hardware": the job is complete before submit returns.
        # A real provider returns status="queued" here and stashes the
        # vendor SDK's job object so get_results / get_queue_position can
        # poll it later. Provider-side failures must be RETURNED as a
        # status="failed" handle with `error` set — never raised.
        self._results[job_id] = {
            "measurements": {"00": shots},  # echo the shot count back
            "status": "complete",
        }
        return JobHandle(
            id=job_id,
            provider="echo",
            backend=backend,
            status="complete",
            queue_position=None,
            shots=shots,
            submitted_at=now,
        )

    def get_results(self, job: JobHandle) -> dict:
        # Unknown ids and provider failures come back as {"error": ...}
        # dicts, not exceptions.
        return self._results.get(job.id, {"error": f"Job {job.id} not found"})

    def get_queue_position(self, job: JobHandle) -> int:
        return 0

    # cancel_job: the inherited default (no-op returning True) is correct
    # for synchronous providers. Queue-backed providers override it.
