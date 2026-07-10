import io
import resource
from dataclasses import dataclass


@dataclass(frozen=True)
class WorkerLimits:
    cpu_seconds: int = 10
    # RLIMIT_AS caps *virtual* address space, and the qiskit stack (numpy/scipy
    # plus rustworkx's Rust allocator used by the Sabre routing transpiler)
    # reserves several GiB of virtual space even for tiny circuits and even
    # with OPENBLAS/OMP threads pinned to 1. A 1 GiB cap let basis-only
    # transpiles through but made coupling-map routing fail with MemoryError on
    # Linux (invisible on macOS, which cannot set a finite RLIMIT_AS at all).
    # 4 GiB fits the stack's fixed reservations while still stopping a runaway
    # allocation; RLIMIT_CPU + the wall timeout bound runaway compute.
    address_space_bytes: int = 4_294_967_296
    file_bytes: int = 1_048_576
    open_files: int = 64
    processes: int = 4
    output_bytes: int = 65_536

    @classmethod
    def testing(cls) -> "WorkerLimits":
        return cls(
            cpu_seconds=2,
            address_space_bytes=2_147_483_648,
            open_files=32,
        )


class BoundedTextCapture(io.TextIOBase):
    def __init__(self, limit: int):
        super().__init__()
        self._limit = limit
        self._data = bytearray()
        self._truncated = False

    def write(self, text: str) -> int:
        if self._truncated:
            return len(text)

        encoded = text.encode("utf-8", errors="replace")
        remaining = max(0, self._limit - len(self._data))
        if len(encoded) > remaining:
            self._truncated = True
        complete_utf8 = encoded[:remaining].decode("utf-8", errors="ignore")
        self._data.extend(complete_utf8.encode("utf-8"))
        return len(text)

    def getvalue(self) -> str:
        return self._data.decode("utf-8")


def apply_worker_limits(limits: WorkerLimits) -> None:
    """Apply best-effort resource limits to the current (worker) process.

    Limits are applied independently: a platform that rejects one must not
    prevent the others from taking effect.

    Two rlimits are intentionally NOT enforced, because both are blunt caps
    that break qiskit's numpy/Rust stack while providing little real safety:

    - ``RLIMIT_AS`` caps *virtual* address space, which numpy/BLAS over-reserve
      (several GiB even for a two-qubit circuit); a finite value surfaces as a
      MemoryError or a Rust allocation-abort ``PanicException``.
    - ``RLIMIT_NPROC`` caps processes/threads *for the whole real user ID
      system-wide*, so on a multi-process host it is already exceeded — any new
      thread ``clone()`` then fails, and qiskit's rustworkx routing (rayon)
      panics when it cannot spawn a worker thread.

    macOS already ran without RLIMIT_AS (Darwin rejects a finite value with
    EINVAL); dropping both on Linux too keeps the platforms consistent. Runaway
    memory/CPU is instead bounded by ``RLIMIT_CPU``, the supervisor's wall
    timeout, and the worker's short single-request lifetime; a fork bomb is
    reaped by the process-group kill the server applies on timeout.
    """
    limit_plan = [
        (resource.RLIMIT_CPU, limits.cpu_seconds),
        (resource.RLIMIT_FSIZE, limits.file_bytes),
        (resource.RLIMIT_NOFILE, limits.open_files),
        (resource.RLIMIT_CORE, 0),
    ]

    for resource_id, limit in limit_plan:
        try:
            resource.setrlimit(resource_id, (limit, limit))
        except (ValueError, OSError):
            # A limit the host will not honor (e.g. RLIMIT_NPROC on some macOS
            # configurations) must not stop the remaining limits from applying.
            continue
