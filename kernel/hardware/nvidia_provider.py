import uuid
from datetime import datetime, timezone

from kernel.hardware.base import HardwareProvider, BackendInfo, JobHandle


class NvidiaProvider(HardwareProvider):
    """
    NVIDIA CUDA-Q backend. No real NVIDIA QPU is publicly callable yet, so
    this provider exposes CUDA-Q's GPU-accelerated simulators as submission
    targets. Gives students a first-class provider card that differs from
    the pure-CPU simulator: real GPU silicon, higher qubit counts, faster
    statevector evolution.
    """

    def __init__(self):
        self._targets: dict[str, str] = {}  # backend_name -> cudaq target
        self._jobs: dict[str, dict] = {}

    def connect(self, credentials: dict) -> bool:
        # No credentials required for the bundled CUDA-Q simulators, but we
        # still need the package available in the kernel env.
        try:
            import cudaq  # noqa: F401
        except ImportError:
            print(
                "NVIDIA provider requires cudaq. "
                "Install with: pip install cudaq"
            )
            return False

        # Populate the simulation targets we expose. These match the most
        # common CUDA-Q targets; if a given target isn't available on the
        # host machine, list_backends() will filter them.
        self._targets = {
            "nvidia": "nvidia",               # single GPU, default FP32
            "nvidia-fp64": "nvidia-fp64",      # double precision
            "nvidia-mgpu": "nvidia-mgpu",      # multi-GPU pooled statevector
            "qpp-cpu": "qpp-cpu",              # CPU fallback for machines without GPU
        }
        print("NVIDIA CUDA-Q provider ready")
        return True

    def list_backends(self) -> list[BackendInfo]:
        if not self._targets:
            return []

        try:
            import cudaq
        except ImportError:
            return []

        out: list[BackendInfo] = []
        available = set()
        try:
            # cudaq.get_target_names() exists on modern cudaq; fall back to
            # a best-effort probe if the method name differs.
            fn = getattr(cudaq, "get_target_names", None)
            if callable(fn):
                available = set(fn())
        except Exception:
            available = set()

        for name, target in self._targets.items():
            if available and target not in available:
                continue
            # Qubit cap depends on GPU memory. Report conservative defaults
            # that hold on a single 24 GB GPU; users with bigger hardware
            # effectively have a higher cap, but the UI doesn't promise that.
            qubit_cap = 34 if "mgpu" in name else 32 if "nvidia" in name else 24
            out.append(BackendInfo(
                name=name,
                provider="nvidia",
                qubit_count=qubit_cap,
                connectivity=[],           # all-to-all for a simulator
                queue_length=0,
                average_error_rate=0.0,
                gate_set=["All"],
                status="online",
            ))
        return out

    def submit_job(self, circuit_obj, backend: str, shots: int) -> JobHandle:
        if not self._targets:
            raise RuntimeError("NVIDIA provider not connected. Call connect() first.")

        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        try:
            import cudaq
            target = self._targets.get(backend)
            if target is None:
                raise RuntimeError(f"Unknown NVIDIA backend: {backend}")
            cudaq.set_target(target)
            # `circuit_obj` here should be a CUDA-Q kernel. We accept a
            # callable kernel or a (kernel, *args) tuple. The adapter that
            # produces circuit_obj is responsible for the shape.
            if isinstance(circuit_obj, tuple):
                kernel, *args = circuit_obj
                counts = cudaq.sample(kernel, *args, shots_count=shots)
            else:
                counts = cudaq.sample(circuit_obj, shots_count=shots)

            # Convert cudaq.SampleResult into a plain dict of counts.
            measurements: dict[str, int] = {}
            try:
                for bitstring, count in counts.items():
                    measurements[str(bitstring)] = int(count)
            except Exception:
                measurements = {}

            self._jobs[job_id] = {"measurements": measurements}
            return JobHandle(
                id=job_id,
                provider="nvidia",
                backend=backend,
                status="complete",
                queue_position=0,
                shots=shots,
                submitted_at=now,
            )
        except Exception as e:
            self._jobs[job_id] = {"error": str(e)}
            return JobHandle(
                id=job_id,
                provider="nvidia",
                backend=backend,
                status="failed",
                queue_position=None,
                shots=shots,
                submitted_at=now,
            )

    def get_results(self, job: JobHandle) -> dict:
        entry = self._jobs.get(job.id)
        if entry is None:
            return {"error": f"Job {job.id} not found"}
        if "error" in entry:
            return {"error": entry["error"], "status": "failed"}
        return {"measurements": entry.get("measurements", {}), "status": "complete"}

    def get_queue_position(self, job: JobHandle) -> int:
        # Local simulator — no queue.
        return 0
