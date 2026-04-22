import logging

from kernel.hardware import credential_store
from kernel.hardware.base import BackendInfo, JobHandle
from kernel.hardware.job_store import JobRecord, JobStore
from kernel.hardware.simulator_provider import SimulatorProvider
from kernel.hardware.ibm_provider import IBMProvider
from kernel.hardware.google_provider import GoogleProvider
from kernel.hardware.ionq_provider import IonQProvider
from kernel.hardware.nvidia_provider import NvidiaProvider
from kernel.hardware.braket_provider import BraketProvider
from kernel.hardware.azure_provider import AzureProvider
from kernel.hardware.quantinuum_provider import QuantinuumProvider

_LOG = logging.getLogger(__name__)


class HardwareManager:
    def __init__(
        self,
        *,
        auto_reconnect: bool = True,
        job_store: JobStore | None = None,
    ):
        self._providers = {
            "simulator": SimulatorProvider(),
            "ibm": IBMProvider(),
            "google": GoogleProvider(),
            "ionq": IonQProvider(),
            "nvidia": NvidiaProvider(),
            "braket": BraketProvider(),
            "azure": AzureProvider(),
            "quantinuum": QuantinuumProvider(),
        }
        self._connected: set[str] = set()
        self._jobs: dict[str, tuple[str, JobHandle]] = {}  # job_id -> (provider_name, handle)
        self._job_store = job_store if job_store is not None else JobStore()
        self._job_store.load()
        if auto_reconnect:
            self._auto_reconnect()
        self._rehydrate_jobs()

    def _rehydrate_jobs(self) -> None:
        """Load persisted job metadata into the in-memory registry.

        Jobs that were non-terminal at shutdown come back as `stale` — the
        kernel no longer holds the SDK handle so we can't resume live
        polling. The UI shows the historical entry; the user can re-submit.

        Terminal jobs (complete/failed/cancelled) keep their stored status
        so history isn't lost."""
        for record in self._job_store.all():
            provider_name = record.provider
            # Any non-terminal status becomes 'stale' on reload because the
            # SDK handle is gone. Terminal statuses are preserved verbatim.
            if record.status in ("complete", "failed", "cancelled"):
                status = record.status
                error = record.error
            else:
                status = "stale"
                error = (
                    record.error
                    or (
                        "This job was submitted before the kernel restarted. "
                        "The kernel no longer tracks it — resubmit to run again."
                    )
                )
            handle = JobHandle(
                id=record.job_id,
                provider=provider_name,
                backend=record.backend,
                status=status,
                queue_position=record.queue_position,
                shots=record.shots,
                submitted_at=record.submitted_at,
                error=error,
            )
            self._jobs[record.job_id] = (provider_name, handle)

    def _auto_reconnect(self) -> None:
        """On kernel start, rehydrate provider connections from the keyring.

        Silently skips any provider whose stored credentials no longer auth
        (e.g. rotated token) — the user will see it as 'disconnected' in the
        UI and can re-enter. We deliberately don't surface these failures
        loudly; startup noise isn't what the user wants."""
        for provider_name in credential_store.list_providers():
            creds = credential_store.load(provider_name)
            if creds is None:
                continue
            provider = self._providers.get(provider_name)
            if provider is None:
                # Provider was removed in a newer version — clear the stale entry.
                credential_store.clear(provider_name)
                continue
            try:
                ok = provider.connect(creds)
            except Exception as exc:
                _LOG.warning("Auto-reconnect to %s failed: %s", provider_name, exc)
                continue
            if ok:
                self._connected.add(provider_name)
            else:
                _LOG.info(
                    "Stored credentials for %s no longer authenticate; "
                    "keeping them on disk so the user can see the failure "
                    "and decide whether to rotate.",
                    provider_name,
                )

    def connect_provider(
        self,
        provider_name: str,
        credentials: dict,
        *,
        persist: bool = True,
    ) -> bool:
        """Connect to a provider; on success, persist credentials to the
        OS keyring so the next kernel start auto-reconnects. Pass
        persist=False to skip persistence (used by auto-reconnect itself
        to avoid a redundant re-write)."""
        provider = self._providers.get(provider_name)
        if provider is None:
            return False

        success = provider.connect(credentials)
        if success:
            self._connected.add(provider_name)
            if persist and credentials:
                credential_store.save(provider_name, credentials)
        return success

    def disconnect_provider(self, provider_name: str) -> None:
        """Drop the in-memory connection AND wipe stored credentials.
        Used by the 'disconnect' UI flow."""
        self._connected.discard(provider_name)
        credential_store.clear(provider_name)

    def list_backends(self, provider_name: str = None) -> list[BackendInfo]:
        if provider_name:
            provider = self._providers.get(provider_name)
            if provider is None or provider_name not in self._connected:
                return []
            return provider.list_backends()

        # List from all connected providers
        backends = []
        for name in self._connected:
            backends.extend(self._providers[name].list_backends())
        return backends

    def submit_job(self, provider_name: str, circuit_obj, backend: str, shots: int) -> JobHandle:
        if provider_name not in self._connected:
            raise RuntimeError(f"Provider '{provider_name}' is not connected")

        provider = self._providers[provider_name]
        handle = provider.submit_job(circuit_obj, backend, shots)
        self._jobs[handle.id] = (provider_name, handle)
        # Persist immediately so a kernel crash between submit and first
        # poll doesn't orphan the job — the provider still has it, the
        # file-backed store lets us find it again.
        self._job_store.upsert(JobRecord(
            job_id=handle.id,
            provider=provider_name,
            backend=backend,
            status=handle.status,
            shots=shots,
            submitted_at=handle.submitted_at,
            last_updated_at=handle.submitted_at,
            queue_position=handle.queue_position,
            error=handle.error,
        ))
        return handle

    def get_job_status(self, job_id: str) -> JobHandle:
        entry = self._jobs.get(job_id)
        if entry is None:
            raise KeyError(f"Job '{job_id}' not found")

        provider_name, handle = entry
        # Stale jobs (rehydrated from persistence without an SDK handle)
        # can't actually be polled — short-circuit so we don't pass a None
        # SDK object to provider.get_queue_position.
        if handle.status == "stale":
            return handle
        # Update queue position for pending jobs
        if handle.status in ("queued", "running"):
            provider = self._providers[provider_name]
            handle.queue_position = provider.get_queue_position(handle)
            # Write-through the updated position so polling from a new
            # session picks up where this one left off.
            self._job_store.update_status(
                job_id, queue_position=handle.queue_position,
            )

        return handle

    def list_jobs(self) -> list[JobHandle]:
        """Return every tracked job (rehydrated + in-memory). Used by the
        frontend to repopulate JobTracker after a page reload."""
        return [handle for (_provider, handle) in self._jobs.values()]

    def get_results(self, job_id: str) -> dict:
        entry = self._jobs.get(job_id)
        if entry is None:
            raise KeyError(f"Job '{job_id}' not found")

        provider_name, handle = entry
        provider = self._providers[provider_name]
        return provider.get_results(handle)

    def cancel_job(self, job_id: str) -> bool:
        """Cancel a queued/running job if the provider supports it. Local
        simulator / NVIDIA jobs complete synchronously so cancel is a no-op
        that returns True. Unknown job ids are treated as already-gone."""
        entry = self._jobs.get(job_id)
        if entry is None:
            return True
        provider_name, handle = entry
        provider = self._providers[provider_name]
        try:
            ok = provider.cancel_job(handle)
        except Exception:
            ok = False
        if ok:
            handle.status = "failed"
            self._job_store.update_status(job_id, status="failed")
        return ok
