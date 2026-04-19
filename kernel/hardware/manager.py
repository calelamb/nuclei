from kernel.hardware.base import BackendInfo, JobHandle
from kernel.hardware.simulator_provider import SimulatorProvider
from kernel.hardware.ibm_provider import IBMProvider
from kernel.hardware.google_provider import GoogleProvider
from kernel.hardware.ionq_provider import IonQProvider
from kernel.hardware.nvidia_provider import NvidiaProvider


class HardwareManager:
    def __init__(self):
        self._providers = {
            "simulator": SimulatorProvider(),
            "ibm": IBMProvider(),
            "google": GoogleProvider(),
            "ionq": IonQProvider(),
            "nvidia": NvidiaProvider(),
        }
        self._connected: set[str] = set()
        self._jobs: dict[str, tuple[str, JobHandle]] = {}  # job_id -> (provider_name, handle)

    def connect_provider(self, provider_name: str, credentials: dict) -> bool:
        provider = self._providers.get(provider_name)
        if provider is None:
            return False

        success = provider.connect(credentials)
        if success:
            self._connected.add(provider_name)
        return success

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
