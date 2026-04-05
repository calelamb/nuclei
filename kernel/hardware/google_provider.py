from kernel.hardware.base import HardwareProvider, BackendInfo, JobHandle


class GoogleProvider(HardwareProvider):
    def connect(self, credentials: dict) -> bool:
        print("Google Quantum AI provider requires google-cloud setup")
        return False

    def list_backends(self) -> list[BackendInfo]:
        return []

    def submit_job(self, circuit_obj, backend: str, shots: int) -> JobHandle:
        raise NotImplementedError("Google provider not yet configured")

    def get_results(self, job: JobHandle) -> dict:
        raise NotImplementedError("Google provider not yet configured")

    def get_queue_position(self, job: JobHandle) -> int:
        raise NotImplementedError("Google provider not yet configured")
