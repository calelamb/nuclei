import io
import resource
from dataclasses import dataclass


@dataclass(frozen=True)
class WorkerLimits:
    cpu_seconds: int = 10
    address_space_bytes: int = 1_073_741_824
    file_bytes: int = 1_048_576
    open_files: int = 64
    processes: int = 4
    output_bytes: int = 65_536

    @classmethod
    def testing(cls) -> "WorkerLimits":
        return cls(
            cpu_seconds=2,
            address_space_bytes=536_870_912,
            open_files=32,
        )


class BoundedTextCapture(io.TextIOBase):
    def __init__(self, limit: int):
        super().__init__()
        self._limit = limit
        self._data = bytearray()

    def write(self, text: str) -> int:
        encoded = text.encode("utf-8", errors="replace")
        remaining = max(0, self._limit - len(self._data))
        complete_utf8 = encoded[:remaining].decode("utf-8", errors="ignore")
        self._data.extend(complete_utf8.encode("utf-8"))
        return len(text)

    def getvalue(self) -> str:
        return self._data.decode("utf-8")


def apply_worker_limits(limits: WorkerLimits) -> None:
    for resource_id, limit in (
        (resource.RLIMIT_CPU, limits.cpu_seconds),
        (resource.RLIMIT_AS, limits.address_space_bytes),
        (resource.RLIMIT_FSIZE, limits.file_bytes),
        (resource.RLIMIT_NOFILE, limits.open_files),
        (resource.RLIMIT_NPROC, limits.processes),
        (resource.RLIMIT_CORE, 0),
    ):
        resource.setrlimit(resource_id, (limit, limit))
