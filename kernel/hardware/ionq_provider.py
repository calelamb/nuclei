import uuid
from datetime import datetime, timezone

from kernel.hardware.base import HardwareProvider, BackendInfo, JobHandle


class IonQProvider(HardwareProvider):
    """
    IonQ hardware provider backed by `qiskit-ionq`. Supports simulator +
    trapped-ion QPUs. Requires an IonQ API key; set via credentials
    dict `{"token": "..."}` from the UI.
    """

    def __init__(self):
        self._provider = None
        self._jobs: dict[str, object] = {}  # job_id -> qiskit_ionq job

    def connect(self, credentials: dict) -> bool:
        try:
            from qiskit_ionq import IonQProvider as _IonQProvider
        except ImportError:
            print(
                "IonQ provider requires qiskit-ionq. "
                "Install with: pip install qiskit-ionq"
            )
            return False

        token = credentials.get("token", "")
        if not token:
            print("IonQ connection requires an API token.")
            return False

        try:
            self._provider = _IonQProvider(token)
            # Touch backends() to validate the token.
            _ = self._provider.backends()
            print("Connected to IonQ")
            return True
        except Exception as e:
            print(f"IonQ connection failed: {e}")
            self._provider = None
            return False

    def list_backends(self) -> list[BackendInfo]:
        if self._provider is None:
            return []

        out: list[BackendInfo] = []
        try:
            for be in self._provider.backends():
                try:
                    name = be.name()
                    cfg = be.configuration()
                    status = be.status()
                    n_qubits = int(getattr(cfg, "n_qubits", 0) or 0)
                    # IonQ devices are fully connected when simulated; for QPU
                    # the coupling_map may be missing — approximate as all-to-all.
                    coupling = getattr(cfg, "coupling_map", None) or []
                    if not coupling and n_qubits:
                        coupling = [(i, j) for i in range(n_qubits) for j in range(n_qubits) if i != j]
                    queue_len = int(getattr(status, "pending_jobs", 0) or 0)
                    operational = bool(getattr(status, "operational", True))

                    out.append(BackendInfo(
                        name=name,
                        provider="ionq",
                        qubit_count=n_qubits,
                        connectivity=[tuple(p) for p in coupling],
                        queue_length=queue_len,
                        average_error_rate=0.0,
                        gate_set=list(getattr(cfg, "basis_gates", []) or []),
                        status="online" if operational else "maintenance",
                    ))
                except Exception as e:
                    print(f"Skipping IonQ backend: {e}")
                    continue
        except Exception as e:
            print(f"Failed to list IonQ backends: {e}")

        return out

    def submit_job(self, circuit_obj, backend: str, shots: int) -> JobHandle:
        if self._provider is None:
            raise RuntimeError("IonQ provider not connected. Call connect() first.")

        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        try:
            be = self._provider.get_backend(backend)
            ionq_job = be.run(circuit_obj, shots=shots)
            self._jobs[job_id] = ionq_job
            return JobHandle(
                id=job_id,
                provider="ionq",
                backend=backend,
                status="queued",
                queue_position=None,
                shots=shots,
                submitted_at=now,
            )
        except Exception as e:
            return JobHandle(
                id=job_id,
                provider="ionq",
                backend=backend,
                status="failed",
                queue_position=None,
                shots=shots,
                submitted_at=now,
                error=f"IonQ submit failed: {e}",
            )

    def get_results(self, job: JobHandle) -> dict:
        ionq_job = self._jobs.get(job.id)
        if ionq_job is None:
            return {"error": f"Job {job.id} not found"}

        try:
            status = ionq_job.status().name
            if status == "DONE":
                result = ionq_job.result()
                # qiskit-ionq returns Result with get_counts.
                try:
                    counts = result.get_counts()
                except Exception:
                    counts = {}
                return {"measurements": counts, "status": "complete"}
            if status in ("ERROR", "CANCELLED"):
                return {"error": f"Job ended with status: {status}", "status": "failed"}
            return {"status": "running", "message": f"Job status: {status}"}
        except Exception as e:
            return {"error": f"Failed to get results: {e}"}

    def get_queue_position(self, job: JobHandle) -> int:
        ionq_job = self._jobs.get(job.id)
        if ionq_job is None:
            return -1
        try:
            info = ionq_job.queue_position()
            if isinstance(info, int):
                return info
            return -1
        except Exception:
            return -1

    def cancel_job(self, job: JobHandle) -> bool:
        ionq_job = self._jobs.get(job.id)
        if ionq_job is None:
            return True
        try:
            ionq_job.cancel()
            return True
        except Exception:
            return False
