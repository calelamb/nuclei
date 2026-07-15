from abc import ABC, abstractmethod
from kernel.models.errors import KernelError
from kernel.models.snapshot import CircuitSnapshot, SimulationResult


class FrameworkAdapter(ABC):
    @abstractmethod
    def detect(self, code: str) -> bool:
        """Return True if this adapter handles the given code."""
        pass

    @abstractmethod
    def find_circuit(self, namespace: dict):
        """Find and return the circuit object from the execution namespace."""
        pass

    @abstractmethod
    def extract_snapshot(self, circuit_obj) -> CircuitSnapshot:
        """Extract gate sequence without simulation."""
        pass

    @abstractmethod
    def simulate(self, circuit_obj, shots: int, seed: int | None = None) -> SimulationResult:
        """Run full simulation and return results.

        `seed` is optional (protocol v1.1 / PRD 09 Phase B) — when given, an
        implementation SHOULD seed its backend for reproducible sampling and
        set `SimulationResult.seed_honored = True` on the object it returns.
        When a backend has no seeding API, set `seed_honored = False` instead
        of silently ignoring the request. The default of None preserves
        every existing caller's behavior unchanged.
        """
        pass

    def state_trace(self, circuit_obj) -> list[dict]:
        """Per-gate quantum-state trajectory for the Quantum Debugger.

        Returns one step per gate (plus an initial |0…0⟩ step at index -1), each
        a dict `{gate_index, label, probabilities, bloch_coords}` — the state
        AFTER applying that gate. Only frameworks with a statevector path
        (Qiskit, Cirq) implement this; the default raises so the executor can
        surface an honest "not supported" error rather than a broken trace.
        """
        raise NotImplementedError(
            f"{type(self).__name__} does not support per-step state tracing"
        )

    def parse_source(
        self, code: str
    ) -> tuple[CircuitSnapshot | None, str, str, KernelError | None]:
        """Compile source directly and return (snapshot, stdout, stderr, error).

        Source-mode adapters (e.g. Q#) own the whole pipeline: their source
        never reaches Python exec(), so the executor delegates wholesale to
        this method. Python-framework adapters never implement it.
        """
        raise NotImplementedError(
            f"{type(self).__name__} does not support source-mode parsing"
        )

    def execute_source(
        self,
        code: str,
        shots: int,
        *,
        params: dict[str, float] | None = None,
        seed: int | None = None,
    ) -> tuple[
        SimulationResult | None, CircuitSnapshot | None, str, str, KernelError | None
    ]:
        """Compile + simulate source directly and return
        (result, snapshot, stdout, stderr, error).

        Same contract as Executor.execute — source-mode adapters return the
        full tuple so the executor can pass it through unchanged.

        `params`/`seed` are optional (protocol v1.1 / PRD 09 Phase B):
        `params` binds to the entry operation's declared arguments by name
        when supplied; `seed` requests reproducible sampling. Both default
        to None so existing callers are unaffected.
        """
        raise NotImplementedError(
            f"{type(self).__name__} does not support source-mode execution"
        )
