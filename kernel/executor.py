import contextlib
import importlib
import io
import re
import traceback
from dataclasses import dataclass

from kernel.models import CircuitSnapshot, KernelError, SimulationResult

EXECUTION_TIMEOUT_SECONDS = 30
_HAS_SIGNAL_ALARM = hasattr(__import__("signal"), "SIGALRM")


@dataclass(frozen=True)
class AdapterSpec:
    framework: str
    module: str
    class_name: str
    detect_pattern: re.Pattern[str]
    dependencies: tuple[str, ...]


ADAPTER_SPECS = (
    AdapterSpec(
        framework="qiskit",
        module="kernel.adapters.qiskit_adapter",
        class_name="QiskitAdapter",
        detect_pattern=re.compile(r"from\s+qiskit\s+import|import\s+qiskit"),
        dependencies=("qiskit", "qiskit_aer"),
    ),
    AdapterSpec(
        framework="cirq",
        module="kernel.adapters.cirq_adapter",
        class_name="CirqAdapter",
        detect_pattern=re.compile(r"import\s+cirq|from\s+cirq\s+import"),
        dependencies=("cirq",),
    ),
    AdapterSpec(
        framework="cuda-q",
        module="kernel.adapters.cudaq_adapter",
        class_name="CudaqAdapter",
        detect_pattern=re.compile(r"import\s+cudaq|from\s+cudaq\s+import|@cudaq\.kernel"),
        dependencies=("cudaq",),
    ),
)


class ExecutionTimeout(Exception):
    pass


def _timeout_handler(signum, frame):
    raise ExecutionTimeout(
        f"Code execution timed out after {EXECUTION_TIMEOUT_SECONDS} seconds"
    )


def _short_error_message(error_text: str) -> str:
    lines = [line.strip() for line in error_text.strip().splitlines() if line.strip()]
    return lines[-1] if lines else "Execution failed."


def _missing_dependency_message(framework: str, dependency: str) -> str:
    display = {
        "qiskit": "Qiskit",
        "qiskit_aer": "Qiskit Aer",
        "cirq": "Cirq",
        "cudaq": "CUDA-Q",
    }.get(dependency, dependency)
    return (
        f"{display} is not installed, so {framework} code cannot run in this environment."
    )


class Executor:
    def __init__(self):
        self._namespace: dict = {}

    def _reset_namespace(self) -> None:
        self._namespace = {"__builtins__": __builtins__}

    def _detect_adapter_spec(self, code: str) -> AdapterSpec | None:
        for spec in ADAPTER_SPECS:
            if spec.detect_pattern.search(code):
                return spec
        return None

    def _load_adapter(self, spec: AdapterSpec):
        try:
            module = importlib.import_module(spec.module)
            adapter_cls = getattr(module, spec.class_name)
            return adapter_cls(), None
        except ImportError as exc:
            dependency = exc.name or spec.dependencies[0]
            return None, KernelError(
                code="missing_dependency",
                message=_missing_dependency_message(spec.framework, dependency),
                framework=spec.framework,
                dependency=dependency,
            )

    def _capability_error(
        self, spec: AdapterSpec | None, exc: Exception, fallback_code: str = "execution_error"
    ) -> KernelError:
        dependency = getattr(exc, "name", None)
        if isinstance(exc, ImportError) or dependency:
            dependency = dependency or (spec.dependencies[0] if spec else None)
            return KernelError(
                code="missing_dependency",
                message=_missing_dependency_message(
                    spec.framework if spec else "this framework",
                    dependency or "dependency",
                ),
                framework=spec.framework if spec else None,
                dependency=dependency,
            )

        tb = traceback.format_exc()
        return KernelError(
            code=fallback_code,
            message=_short_error_message(tb),
            traceback=tb,
            framework=spec.framework if spec else None,
        )

    def _normalize_runtime_error(
        self, spec: AdapterSpec | None, error: KernelError
    ) -> KernelError:
        if not error.traceback or spec is None:
            return error

        match = re.search(
            r"ModuleNotFoundError: No module named ['\"]([^'\"]+)['\"]",
            error.traceback,
        )
        if not match:
            return error

        dependency = match.group(1).split(".")[0]
        if dependency not in spec.dependencies:
            return error

        return KernelError(
            code="missing_dependency",
            message=_missing_dependency_message(spec.framework, dependency),
            framework=spec.framework,
            dependency=dependency,
        )

    def _run_code(self, code: str) -> tuple[str, KernelError | None]:
        import signal
        import threading

        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()

        self._reset_namespace()

        # SIGALRM-based timeout only works from the main thread. The server
        # now runs parse/execute inside `asyncio.to_thread`, so we fall back
        # to running code without a timeout guard on worker threads. The WS
        # heartbeat on the server still lets us detect a hung kernel.
        use_signal_timeout = _HAS_SIGNAL_ALARM and threading.current_thread() is threading.main_thread()

        try:
            if use_signal_timeout:
                old_handler = signal.signal(signal.SIGALRM, _timeout_handler)
                signal.alarm(EXECUTION_TIMEOUT_SECONDS)
            try:
                with contextlib.redirect_stdout(stdout_capture), contextlib.redirect_stderr(
                    stderr_capture
                ):
                    exec(code, self._namespace)
            finally:
                if use_signal_timeout:
                    signal.alarm(0)
                    signal.signal(signal.SIGALRM, old_handler)
            return stdout_capture.getvalue(), None
        except ExecutionTimeout as exc:
            return stdout_capture.getvalue(), KernelError(
                code="timeout",
                message=str(exc),
            )
        except (SyntaxError, IndentationError):
            tb = traceback.format_exc()
            return stdout_capture.getvalue(), KernelError(
                code="compile_error",
                message=_short_error_message(tb),
                traceback=tb,
            )
        except Exception:
            tb = traceback.format_exc()
            return stdout_capture.getvalue(), KernelError(
                code="execution_error",
                message=_short_error_message(tb),
                traceback=tb,
            )

    def run_python(self, code: str) -> tuple[str, KernelError | None]:
        return self._run_code(code)

    def parse(
        self, code: str
    ) -> tuple[CircuitSnapshot | None, str, KernelError | None]:
        spec = self._detect_adapter_spec(code)
        if spec is None:
            return None, "", KernelError(
                code="unsupported_framework",
                message="No supported quantum framework detected in code.",
            )

        adapter, adapter_error = self._load_adapter(spec)
        if adapter_error:
            return None, "", adapter_error

        stdout, error = self._run_code(code)
        if error:
            error = self._normalize_runtime_error(spec, error)
            error.framework = spec.framework
            return None, stdout, error

        try:
            circuit = adapter.find_circuit(self._namespace)
        except Exception as exc:
            return None, stdout, self._capability_error(spec, exc, "adapter_error")

        if circuit is None:
            return None, stdout, None

        try:
            snapshot = adapter.extract_snapshot(circuit)
        except Exception as exc:
            return None, stdout, self._capability_error(spec, exc, "adapter_error")

        return snapshot, stdout, None

    def execute(
        self, code: str, shots: int
    ) -> tuple[SimulationResult | None, CircuitSnapshot | None, str, KernelError | None]:
        spec = self._detect_adapter_spec(code)
        if spec is None:
            return None, None, "", KernelError(
                code="unsupported_framework",
                message="No supported quantum framework detected in code.",
            )

        adapter, adapter_error = self._load_adapter(spec)
        if adapter_error:
            return None, None, "", adapter_error

        stdout, error = self._run_code(code)
        if error:
            error = self._normalize_runtime_error(spec, error)
            error.framework = spec.framework
            return None, None, stdout, error

        try:
            circuit = adapter.find_circuit(self._namespace)
        except Exception as exc:
            return None, None, stdout, self._capability_error(spec, exc, "adapter_error")

        if circuit is None:
            return None, None, stdout, KernelError(
                code="no_circuit",
                message="No quantum circuit found in code.",
                framework=spec.framework,
            )

        try:
            snapshot = adapter.extract_snapshot(circuit)
        except Exception as exc:
            return None, None, stdout, self._capability_error(spec, exc, "adapter_error")

        try:
            result = adapter.simulate(circuit, shots)
        except Exception as exc:
            return None, snapshot, stdout, self._capability_error(
                spec, exc, "simulation_error"
            )

        return result, snapshot, stdout, None
