import uuid
from datetime import datetime, timezone

from kernel.hardware.base import HardwareProvider, BackendInfo, JobHandle


class IBMProvider(HardwareProvider):
    def __init__(self):
        self._service = None
        self._jobs: dict[str, object] = {}  # job_id -> IBM runtime job object

    def connect(self, credentials: dict) -> bool:
        try:
            from qiskit_ibm_runtime import QiskitRuntimeService
        except ImportError:
            print(
                "IBM Quantum provider requires qiskit-ibm-runtime. "
                "Install with: pip install qiskit-ibm-runtime"
            )
            return False

        token = credentials.get("token", "")
        instance = credentials.get("instance", "ibm-q/open/main")

        try:
            self._service = QiskitRuntimeService(
                channel="ibm_quantum",
                token=token,
                instance=instance,
            )
            print(f"Connected to IBM Quantum (instance: {instance})")
            return True
        except Exception as e:
            print(f"IBM Quantum connection failed: {e}")
            self._service = None
            return False

    def list_backends(self) -> list[BackendInfo]:
        if self._service is None:
            return []

        backends = []
        try:
            for be in self._service.backends():
                try:
                    config = be.configuration()
                    props = be.properties()

                    # Extract connectivity from coupling map
                    coupling_map = config.coupling_map or []
                    connectivity = [tuple(pair) for pair in coupling_map]

                    # Calculate average error rate from gate errors
                    avg_error = 0.0
                    if props and props.gates:
                        errors = [
                            g.parameters[0].value
                            for g in props.gates
                            if g.parameters and g.parameters[0].value is not None
                        ]
                        avg_error = sum(errors) / len(errors) if errors else 0.0

                    # Determine status
                    status_info = be.status()
                    if status_info.operational and status_info.status_msg == "active":
                        status = "online"
                    elif not status_info.operational:
                        status = "maintenance"
                    else:
                        status = "offline"

                    backends.append(BackendInfo(
                        name=config.backend_name,
                        provider="ibm",
                        qubit_count=config.n_qubits,
                        connectivity=connectivity,
                        queue_length=status_info.pending_jobs,
                        average_error_rate=round(avg_error, 6),
                        gate_set=config.basis_gates or [],
                        status=status,
                    ))
                except Exception as e:
                    print(f"Skipping backend {be.name}: {e}")
                    continue

        except Exception as e:
            print(f"Failed to list IBM backends: {e}")

        return backends

    def submit_job(self, circuit_obj, backend: str, shots: int) -> JobHandle:
        if self._service is None:
            raise RuntimeError("IBM provider not connected. Call connect() first.")

        try:
            from qiskit.compiler import transpile
            from qiskit_ibm_runtime import SamplerV2 as Sampler
        except ImportError as e:
            raise RuntimeError(f"Missing required package: {e}")

        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        try:
            be = self._service.backend(backend)
            transpiled = transpile(circuit_obj, backend=be)
            sampler = Sampler(be)
            ibm_job = sampler.run([transpiled], shots=shots)
            self._jobs[job_id] = ibm_job

            return JobHandle(
                id=job_id,
                provider="ibm",
                backend=backend,
                status="queued",
                queue_position=None,
                shots=shots,
                submitted_at=now,
            )
        except Exception as e:
            # Surface the underlying SDK error so the frontend can show it
            # verbatim. Common failures (circuit too large, backend offline,
            # no credits) all produce useful messages that beat a generic
            # "submit failed".
            return JobHandle(
                id=job_id,
                provider="ibm",
                backend=backend,
                status="failed",
                queue_position=None,
                shots=shots,
                submitted_at=now,
                error=f"IBM submit failed: {e}",
            )

    def get_results(self, job: JobHandle) -> dict:
        ibm_job = self._jobs.get(job.id)
        if ibm_job is None:
            return {"error": f"Job {job.id} not found"}

        # Status lookup is its own try/except: if the job was deleted from
        # IBM's side (or their API is briefly unavailable) we must NOT
        # propagate the exception — the polling loop would break. Return
        # status='unknown' so the frontend stays on the last known state
        # and retries on the next poll.
        try:
            status = ibm_job.status()
        except Exception as e:
            return {
                "status": "unknown",
                "error": f"IBM status check failed: {e}",
            }

        try:
            if status.name == "DONE":
                result = ibm_job.result()
                # Extract measurement counts from SamplerV2 result
                pub_result = result[0]
                counts = {}
                if hasattr(pub_result, "data"):
                    for creg_name in pub_result.data:
                        creg_data = getattr(pub_result.data, creg_name)
                        if hasattr(creg_data, "get_counts"):
                            counts.update(creg_data.get_counts())

                return {
                    "measurements": counts,
                    "status": "complete",
                }
            elif status.name in ("ERROR", "CANCELLED"):
                return {
                    "error": f"Job ended with status: {status.name}",
                    "status": "failed",
                }
            else:
                return {
                    "status": "running",
                    "message": f"Job status: {status.name}",
                }
        except Exception as e:
            return {"error": f"Failed to get results: {e}"}

    def get_queue_position(self, job: JobHandle) -> int:
        ibm_job = self._jobs.get(job.id)
        if ibm_job is None:
            return -1

        try:
            queue_info = ibm_job.queue_info()
            if queue_info and queue_info.position is not None:
                return queue_info.position
            return 0
        except Exception:
            return -1

    def cancel_job(self, job: JobHandle) -> bool:
        ibm_job = self._jobs.get(job.id)
        if ibm_job is None:
            return True
        try:
            ibm_job.cancel()
            return True
        except Exception:
            return False
