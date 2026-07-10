import io
import resource
import sys
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

    Limits are applied independently: a platform that rejects one limit must not
    prevent the others from taking effect. In particular, modern macOS (Darwin)
    returns EINVAL for *any* finite ``RLIMIT_AS`` value, so an address-space cap is
    silently skipped there and containment relies on ``RLIMIT_CPU``/``RLIMIT_FSIZE``
    plus the import denylist. On Linux the full set applies.
    """
    # Darwin rejects a finite RLIMIT_AS with EINVAL; requesting it aborts the
    # worker before any code runs, so drop it on macOS rather than fail closed.
    address_space_supported = not sys.platform.startswith("darwin")

    limit_plan = [
        (resource.RLIMIT_CPU, limits.cpu_seconds),
        (resource.RLIMIT_FSIZE, limits.file_bytes),
        (resource.RLIMIT_NOFILE, limits.open_files),
        (resource.RLIMIT_NPROC, limits.processes),
        (resource.RLIMIT_CORE, 0),
    ]
    if address_space_supported:
        limit_plan.insert(1, (resource.RLIMIT_AS, limits.address_space_bytes))

    for resource_id, limit in limit_plan:
        try:
            resource.setrlimit(resource_id, (limit, limit))
        except (ValueError, OSError):
            # A limit the host will not honor (e.g. RLIMIT_NPROC on some macOS
            # configurations) must not stop the remaining limits from applying.
            continue
