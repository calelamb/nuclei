"""
Azure Quantum aggregator provider.

Unlocks Quantinuum, IonQ-via-Azure, Rigetti, Pasqal, IQM in one integration.
Credentials: Azure subscription ID + resource group + workspace name + AAD
credentials (service principal or browser auth).
"""

import re
import uuid
from datetime import datetime, timezone

from kernel.hardware.base import HardwareProvider, BackendInfo, JobHandle

# A string key shaped like a stringified array/tuple ("[0, 1]", "(1, 0)")
# gets element-wise parsing; anything else passes through verbatim.
_ARRAY_KEY_RE = re.compile(r"^\s*[\[\(].*[\]\)]\s*$")

# Float values are treated as probabilities only when they sum to ~1.0;
# real-hardware providers round-trip through JSON so allow a little slack.
_PROBABILITY_SUM_TOLERANCE = 1e-2


def _normalize_array_element(element: object) -> str | None:
    """One element of an array-style key.

    Nested tuples/lists recurse; everything else must read as a
    non-negative integer after stripping. Returns None when the element
    can't be parsed — the caller treats that as an unrecognized result.
    """
    if isinstance(element, (tuple, list)):
        parts = [_normalize_array_element(part) for part in element]
        if any(part is None for part in parts):
            return None
        return "".join(parts)  # type: ignore[arg-type]
    if isinstance(element, bool):
        return None
    text = str(element).strip()
    # isdigit() rejects "", "-1", "a", "0.5" in one check.
    return text if text.isdigit() else None


def _normalize_key(key: object) -> str | None:
    """Coerce an Azure result key to a plain bitstring-style string.

    Tuples/lists join element-wise ((1, 0) → "10", nested tuples recurse);
    strings shaped like arrays ("[0, 1]") split on commas and join the
    elements ("01"). Array elements must be non-negative integers — any
    parse failure returns None so the caller can reject the whole result
    set instead of guessing. Plain strings and ints pass through as str(k)
    VERBATIM: IonQ-style integer state keys ({"0": …, "3": …}) are
    legitimate and must not be bitstring-validated or mangled.
    """
    if isinstance(key, (tuple, list)):
        return _normalize_array_element(key)
    if isinstance(key, str) and _ARRAY_KEY_RE.match(key):
        inner = key.strip()[1:-1]
        parts = [_normalize_array_element(part) for part in inner.split(",")]
        if any(part is None for part in parts):
            return None
        return "".join(parts)  # type: ignore[arg-type]
    return str(key)


def _coerce_counts(results: object, shots: int) -> dict[str, int] | None:
    """Coerce Azure's shape-shifting results into integer counts.

    Providers behind Azure Quantum disagree about result shape: Quantinuum
    returns integer counts, IonQ returns float probabilities (which the old
    int() coercion truncated to 0), and some report states as stringified
    arrays. Float distributions (all in [0, 1], summing to ~1.0) scale by
    the shot count; other floats round to the nearest integer. Keys that
    normalize to the same state have their counts summed. Returns None for
    anything unrecognizable — non-dicts, empty dicts, non-numeric or
    negative values, malformed array-style keys — and the caller surfaces
    that instead of silently reporting an empty success.
    """
    if not isinstance(results, dict):
        return None
    # An empty histogram from a "Succeeded" job is a provider anomaly, not
    # a valid result — surface it as unrecognized rather than empty success.
    if not results:
        return None
    values = list(results.values())
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values):
        return None
    # Negative counts/probabilities are provider nonsense, not data.
    if any(v < 0 for v in values):
        return None

    keys = [_normalize_key(k) for k in results.keys()]
    if any(k is None for k in keys):
        # One malformed array-style key poisons trust in the whole histogram.
        return None

    if all(isinstance(v, int) for v in values):
        counts = [int(v) for v in values]
    else:
        floats = [float(v) for v in values]
        looks_like_probabilities = all(v <= 1.0 for v in floats) and (
            abs(sum(floats) - 1.0) <= _PROBABILITY_SUM_TOLERANCE
        )
        if looks_like_probabilities:
            # Deliberate: this includes the single-entry {"0": 1.0} case.
            # Probability-returning targets (e.g. IonQ) legitimately emit it
            # for deterministic circuits, and scaling by shots is correct for
            # them; a literal count of 1.0 only makes sense when shots == 1,
            # which is rare.
            counts = [round(v * shots) for v in floats]
        else:
            # Floats that aren't probabilities are counts serialized as floats.
            counts = [round(v) for v in floats]

    merged: dict[str, int] = {}
    for key, count in zip(keys, counts):
        assert key is not None  # narrowed above; keeps the type honest
        if key in merged:
            # Two raw keys normalized to the same state (e.g. "[0, 1]" and
            # "01" in one dict) denote the same measurement outcome — sum
            # their counts rather than silently letting the last one win.
            print(f"Azure result keys collided after normalization; summing counts for '{key}'")
        merged[key] = merged.get(key, 0) + count
    return merged


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
                # Counts shape varies by provider; coerce to a flat dict of
                # integer counts (float probabilities scale by shot count).
                counts = _coerce_counts(results, job.shots)
                if counts is None:
                    preview = repr(results)
                    if len(preview) > 200:
                        preview = preview[:200] + "…"
                    print(f"Azure job {job.id} returned an unrecognized result shape: {preview}")
                    return {
                        "error": f"Unrecognized result format from Azure: {type(results).__name__}",
                        "status": "complete",
                        "raw": preview,
                    }
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
