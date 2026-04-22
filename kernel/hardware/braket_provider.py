"""
AWS Braket aggregator provider.

Exposes every Braket-accessible device (IonQ, Rigetti, QuEra, IQM, OQC,
Pasqal, D-Wave, Braket's own simulators) under a single provider card in the
UI. Backends report their sub-provider in the `name` so the LaunchModal can
label them clearly.

Credentials: AWS access key + secret via `boto3`. The student's AWS account
must have the `AmazonBraketFullAccess` policy attached.
"""

import uuid
from datetime import datetime, timezone

from kernel.hardware.base import HardwareProvider, BackendInfo, JobHandle


class BraketProvider(HardwareProvider):
    def __init__(self):
        self._aws_session = None
        self._device_arns: dict[str, str] = {}  # friendly_name -> arn
        self._jobs: dict[str, object] = {}

    def connect(self, credentials: dict) -> bool:
        try:
            import boto3
            from braket.aws import AwsDevice  # noqa: F401
        except ImportError:
            print(
                "AWS Braket provider requires amazon-braket-sdk + boto3. "
                "Install with: pip install amazon-braket-sdk boto3"
            )
            return False

        access_key = credentials.get("access_key_id", "")
        secret_key = credentials.get("secret_access_key", "")
        region = credentials.get("region", "us-east-1")
        session_token = credentials.get("session_token")
        try:
            kwargs = {
                "aws_access_key_id": access_key,
                "aws_secret_access_key": secret_key,
                "region_name": region,
            }
            if session_token:
                kwargs["aws_session_token"] = session_token
            self._aws_session = boto3.Session(**kwargs)
            # Touch the Braket client to validate credentials early.
            client = self._aws_session.client("braket")
            client.search_devices(filters=[])
            print(f"Connected to AWS Braket (region: {region})")
            return True
        except Exception as e:
            print(f"AWS Braket connection failed: {e}")
            self._aws_session = None
            return False

    def list_backends(self) -> list[BackendInfo]:
        if self._aws_session is None:
            return []

        try:
            from braket.aws import AwsDevice
            from braket.aws.aws_session import AwsSession
        except ImportError:
            return []

        out: list[BackendInfo] = []
        try:
            aws_session = AwsSession(boto_session=self._aws_session)
            devices = AwsDevice.get_devices(aws_session=aws_session)
            for dev in devices:
                try:
                    arn = dev.arn
                    friendly = dev.name
                    self._device_arns[friendly] = arn
                    # Extract qubit count / connectivity best-effort; Braket
                    # device properties vary by vendor.
                    try:
                        n_qubits = int(dev.properties.paradigm.qubitCount)
                    except Exception:
                        n_qubits = 0
                    try:
                        connectivity_graph = dev.properties.paradigm.connectivity.connectivityGraph
                        connectivity = [
                            (int(a), int(b))
                            for a, neighbors in connectivity_graph.items()
                            for b in neighbors
                        ]
                    except Exception:
                        connectivity = []

                    status_name = getattr(dev, "status", "UNKNOWN").lower()
                    if status_name == "online":
                        status = "online"
                    elif status_name == "retired":
                        status = "offline"
                    else:
                        status = "maintenance"

                    out.append(BackendInfo(
                        name=f"{friendly}",
                        provider="braket",
                        qubit_count=n_qubits,
                        connectivity=connectivity,
                        queue_length=0,  # Braket doesn't expose live queue length via SDK.
                        average_error_rate=0.0,
                        gate_set=[],
                        status=status,
                    ))
                except Exception as e:
                    print(f"Skipping Braket device: {e}")
                    continue
        except Exception as e:
            print(f"Failed to list Braket devices: {e}")

        return out

    def submit_job(self, circuit_obj, backend: str, shots: int) -> JobHandle:
        if self._aws_session is None:
            raise RuntimeError("Braket provider not connected. Call connect() first.")

        try:
            from braket.aws import AwsDevice
            from braket.aws.aws_session import AwsSession
        except ImportError as e:
            raise RuntimeError(f"Missing required package: {e}")

        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        # ARN lookup is checked separately so the frontend gets a precise,
        # actionable error (hint to refresh the backend list) rather than
        # a silent 'failed' with no explanation. Also log the known names so
        # kernel logs show what was expected vs provided.
        arn = self._device_arns.get(backend)
        if arn is None:
            known = sorted(self._device_arns.keys())
            print(
                f"[braket] Unknown device '{backend}'. Known devices: "
                f"{', '.join(known) if known else '(none — run list_backends first)'}"
            )
            return JobHandle(
                id=job_id,
                provider="braket",
                backend=backend,
                status="failed",
                queue_position=None,
                shots=shots,
                submitted_at=now,
                error=(
                    f"Braket device '{backend}' not found. Try refreshing the "
                    "backend list — the device may have been delisted or the "
                    "name may have changed."
                ),
            )

        try:
            aws_session = AwsSession(boto_session=self._aws_session)
            device = AwsDevice(arn, aws_session=aws_session)
            task = device.run(circuit_obj, shots=shots)
            self._jobs[job_id] = task
            return JobHandle(
                id=job_id,
                provider="braket",
                backend=backend,
                status="queued",
                queue_position=None,
                shots=shots,
                submitted_at=now,
            )
        except Exception as e:
            return JobHandle(
                id=job_id,
                provider="braket",
                backend=backend,
                status="failed",
                queue_position=None,
                shots=shots,
                submitted_at=now,
                error=f"Braket submit failed: {e}",
            )

    def get_results(self, job: JobHandle) -> dict:
        task = self._jobs.get(job.id)
        if task is None:
            return {"error": f"Job {job.id} not found"}
        try:
            state = task.state().lower()
            if state == "completed":
                result = task.result()
                counts = {}
                try:
                    counts = dict(result.measurement_counts)
                except Exception:
                    pass
                return {"measurements": counts, "status": "complete"}
            if state in ("failed", "cancelled"):
                return {"error": f"Task state: {state}", "status": "failed"}
            return {"status": "running", "message": f"Task state: {state}"}
        except Exception as e:
            return {"error": f"Failed to get results: {e}"}

    def get_queue_position(self, job: JobHandle) -> int:
        task = self._jobs.get(job.id)
        if task is None:
            return -1
        try:
            info = task.queue_position()
            return int(info) if info is not None else 0
        except Exception:
            return -1

    def cancel_job(self, job: JobHandle) -> bool:
        task = self._jobs.get(job.id)
        if task is None:
            return True
        try:
            task.cancel()
            return True
        except Exception:
            return False
