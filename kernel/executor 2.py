import io
import sys
import traceback
import contextlib

from kernel.adapters.qiskit_adapter import QiskitAdapter
from kernel.adapters.cirq_adapter import CirqAdapter
from kernel.adapters.cudaq_adapter import CudaqAdapter
from kernel.models.snapshot import CircuitSnapshot, SimulationResult

ADAPTERS = [QiskitAdapter(), CirqAdapter(), CudaqAdapter()]

EXECUTION_TIMEOUT_SECONDS = 30

_HAS_SIGNAL_ALARM = hasattr(__import__("signal"), "SIGALRM")


class ExecutionTimeout(Exception):
    pass


def _timeout_handler(signum, frame):
    raise ExecutionTimeout(
        f"Code execution timed out after {EXECUTION_TIMEOUT_SECONDS} seconds"
    )


class Executor:
    def __init__(self):
        self._namespace: dict = {}

    def _detect_adapter(self, code: str):
        for adapter in ADAPTERS:
            if adapter.detect(code):
                return adapter
        return None

    def _run_code(self, code: str) -> tuple[str, str | None]:
        """Execute code and return (stdout, error_traceback_or_none)."""
        import signal

        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()

        # Reset namespace each time to avoid stale state
        self._namespace = {"__builtins__": __builtins__}

        try:
            # Set up timeout on Unix (macOS/Linux). signal.SIGALRM is not
            # available on Windows, so the timeout is skipped there.
            if _HAS_SIGNAL_ALARM:
                old_handler = signal.signal(signal.SIGALRM, _timeout_handler)
                signal.alarm(EXECUTION_TIMEOUT_SECONDS)
            try:
                with contextlib.redirect_stdout(stdout_capture), contextlib.redirect_stderr(stderr_capture):
                    exec(code, self._namespace)
            finally:
                if _HAS_SIGNAL_ALARM:
                    signal.alarm(0)
                    signal.signal(signal.SIGALRM, old_handler)
            return stdout_capture.getvalue(), None
        except ExecutionTimeout as e:
            return stdout_capture.getvalue(), str(e)
        except Exception:
            tb = traceback.format_exc()
            return stdout_capture.getvalue(), tb

    def parse(self, code: str) -> tuple[CircuitSnapshot | None, str, str | None]:
        """Parse code and extract circuit snapshot without simulation.

        Returns (snapshot_or_none, stdout, error_or_none).
        """
        adapter = self._detect_adapter(code)
        if adapter is None:
            return None, "", "No supported quantum framework detected in code."

        stdout, error = self._run_code(code)
        if error:
            return None, stdout, error

        circuit = adapter.find_circuit(self._namespace)
        if circuit is None:
            return None, stdout, None  # Valid code but no circuit object found

        snapshot = adapter.extract_snapshot(circuit)
        return snapshot, stdout, None

    def execute(self, code: str, shots: int) -> tuple[SimulationResult | None, CircuitSnapshot | None, str, str | None]:
        """Execute code with full simulation.

        Returns (result_or_none, snapshot_or_none, stdout, error_or_none).
        """
        adapter = self._detect_adapter(code)
        if adapter is None:
            return None, None, "", "No supported quantum framework detected in code."

        stdout, error = self._run_code(code)
        if error:
            return None, None, stdout, error

        circuit = adapter.find_circuit(self._namespace)
        if circuit is None:
            return None, None, stdout, "No quantum circuit found in code."

        snapshot = adapter.extract_snapshot(circuit)

        try:
            result = adapter.simulate(circuit, shots)
        except Exception:
            tb = traceback.format_exc()
            return None, snapshot, stdout, tb

        return result, snapshot, stdout, None
