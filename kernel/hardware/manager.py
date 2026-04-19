import logging

from kernel.hardware import credential_store
from kernel.hardware.base import BackendInfo, JobHandle
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
    def __init__(self, *, auto_reconnect: bool = True):
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
        if auto_reconnect:
            self._auto_reconnect()

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
        return handle

    def get_job_status(self, job_id: str) -> JobHandle:
        entry = self._jobs.get(job_id)
        if entry is None:
            raise KeyError(f"Job '{job_id}' not found")

        provider_name, handle = entry
        # Update queue position for pending jobs
        if handle.status in ("queued", "running"):
            provider = self._providers[provider_name]
            handle.queue_position = provider.get_queue_position(handle)

        return handle

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
        return ok
