"""
Azure Quantum aggregator provider.

Unlocks Quantinuum, IonQ-via-Azure, Rigetti, Pasqal, IQM in one integration.
Credentials: Azure subscription ID + resource group + workspace name + AAD
credentials (service principal or browser auth).
"""

import uuid
from datetime import datetime, timezone

from kernel.hardware.base import HardwareProvider, BackendInfo, JobHandle


class AzureProvider(HardwareProvider):
    def __init__(self):
        self._workspace = None
        self._jobs: dict[str, object] = {}

    def connect(self, credentials: dict) -> bool:
        try:
            from azure.quantum import Workspace
        except ImportError:
            print(
                "Azure Quantum provider requires azure-quantum. "
                "Install with: pip install azure-quantum"
            )
            return False

        subscription_id = credentials.get("subscription_id", "")
        resource_group = credentials.get("resource_group", "")
        workspace_name = credentials.get("workspace_name", "")
        location = credentials.get("location", "eastus")
        if not (subscription_id and resource_group and workspace_name):
            print("Azure Quantum connection requires subscription_id, resource_group, and workspace_name.")
            return False

        try:
            self._workspace = Workspace(
                subscription_id=subscription_id,
                resource_group=resource_group,
                name=workspace_name,
                location=location,
            )
            # Touch targets() to validate the connection.
            _ = list(self._workspace.get_targets())
            print(f"Connected to Azure Quantum ({workspace_name})")
            return True
        except Exception as e:
            print(f"Azure Quantum connection failed: {e}")
            self._workspace = None
            return False

    def list_backends(self) -> list[BackendInfo]:
        if self._workspace is None:
            return []

        out: list[BackendInfo] = []
        try:
            for tgt in self._workspace.get_targets():
                try:
                    name = tgt.name
                    status_raw = getattr(tgt, "current_availability", "").lower()
                    status = "online" if "available" in status_raw else "maintenance"
                    queue = int(getattr(tgt, "average_queue_time", 0) or 0)
                    # qubit counts aren't always exposed uniformly; infer when
                    # possible from the provider prefix.
                    qubit_count = 0
                    if "quantinuum" in name:
                        qubit_count = 56
                    elif "ionq" in name:
                        qubit_count = 29
                    elif "rigetti" in name:
                        qubit_count = 80
                    elif "pasqal" in name:
                        qubit_count = 100
                    elif "iqm" in name:
                        qubit_count = 20

                    out.append(BackendInfo(
                        name=name,
                        provider="azure",
                        qubit_count=qubit_count,
                        connectivity=[],
                        queue_length=queue,
                        average_error_rate=0.0,
                        gate_set=[],
                        status=status,
                    ))
                except Exception as e:
                    print(f"Skipping Azure target {getattr(tgt, 'name', '?')}: {e}")
                    continue
        except Exception as e:
            print(f"Failed to list Azure targets: {e}")

        return out

    def submit_job(self, circuit_obj, backend: str, shots: int) -> JobHandle:
        if self._workspace is None:
            raise RuntimeError("Azure provider not connected. Call connect() first.")

        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        # Target resolution and submit are separated so we can tell the user
        # "target not found" (actionable) vs "submit exploded" (SDK error).
        # Azure's workspace.get_targets(name=...) is infamously
        # shape-shifting — it can return a single Target, a list of Targets
        # (with 0, 1, or many matches), or None depending on SDK version and
        # name matching behavior.
        def _fail(message: str) -> JobHandle:
            return JobHandle(
                id=job_id,
                provider="azure",
                backend=backend,
                status="failed",
                queue_position=None,
                shots=shots,
                submitted_at=now,
                error=message,
            )

        try:
            result = self._workspace.get_targets(name=backend)
        except Exception as e:
            return _fail(f"Azure target lookup failed for '{backend}': {e}")

        target = None
        if result is None:
            return _fail(f"Azure target '{backend}' not found. Check the target name.")
        if isinstance(result, (list, tuple)):
            if not result:
                return _fail(f"Azure target '{backend}' not found (empty list).")
            target = result[0]
        else:
            target = result
        if target is None:
            return _fail(f"Azure target '{backend}' returned no usable target.")

        try:
            azure_job = target.submit(circuit_obj, shots=shots)
            self._jobs[job_id] = azure_job
            return JobHandle(
                id=job_id,
                provider="azure",
                backend=backend,
                status="queued",
                queue_position=None,
                shots=shots,
                submitted_at=now,
            )
        except Exception as e:
            return _fail(f"Azure submit failed: {e}")

    def get_results(self, job: JobHandle) -> dict:
        azure_job = self._jobs.get(job.id)
        if azure_job is None:
            return {"error": f"Job {job.id} not found"}
        try:
            status = azure_job.details.status.lower() if azure_job.details else "unknown"
            if status == "succeeded":
                results = azure_job.get_results()
                # Counts shape varies by provider; coerce to a flat dict.
                counts = {}
                if isinstance(results, dict):
                    counts = {str(k): int(v) for k, v in results.items() if isinstance(v, (int, float))}
                return {"measurements": counts, "status": "complete"}
            if status in ("failed", "cancelled"):
                return {"error": f"Job ended: {status}", "status": "failed"}
            return {"status": "running", "message": f"Job status: {status}"}
        except Exception as e:
            return {"error": f"Failed to get results: {e}"}

    def get_queue_position(self, job: JobHandle) -> int:
        azure_job = self._jobs.get(job.id)
        if azure_job is None:
            return -1
        try:
            # Azure doesn't expose a queue position directly; report -1 to
            # signal "unknown" rather than misleading zero.
            return -1
        except Exception:
            return -1

    def cancel_job(self, job: JobHandle) -> bool:
        azure_job = self._jobs.get(job.id)
        if azure_job is None:
            return True
        try:
            azure_job.cancel()
            return True
        except Exception:
            return False
