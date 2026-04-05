from kernel.hardware.base import HardwareProvider, BackendInfo, JobHandle


class IonQProvider(HardwareProvider):
    def connect(self, credentials: dict) -> bool:
        print("IonQ provider requires Amazon Braket or IonQ API setup")
        return False

    def list_backends(self) -> list[BackendInfo]:
        return []

    def submit_job(self, circuit_obj, backend: str, shots: int) -> JobHandle:
        raise NotImplementedError("IonQ provider not yet configured")

    def get_results(self, job: JobHandle) -> dict:
        raise NotImplementedError("IonQ provider not yet configured")

    def get_queue_position(self, job: JobHandle) -> int:
        raise NotImplementedError("IonQ provider not yet configured")
