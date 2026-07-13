import contextlib
import dataclasses
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
    # Source-mode adapters (Q#) compile source through their own toolchain;
    # the code never reaches Python exec().
    source_mode: bool = False


ADAPTER_SPECS = (
    # Q# first: its source would be a syntax error under every Python spec,
    # and none of the Python patterns can false-positive on Q# keywords.
    AdapterSpec(
        framework="qsharp",
        module="kernel.adapters.qsharp_adapter",
        class_name="QsharpAdapter",
        detect_pattern=re.compile(
            r"^\s*(namespace\s+[\w.]+|operation\s+\w+\s*\(|import\s+Std|open\s+Microsoft\.Quantum)",
            re.MULTILINE,
        ),
        dependencies=("qdk",),
        source_mode=True,
    ),
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
    AdapterSpec(
        framework="stim",
        module="kernel.adapters.stim_adapter",
        class_name="StimAdapter",
        detect_pattern=re.compile(r"import\s+stim|from\s+stim\s+import"),
        dependencies=("stim",),
    ),
)

# Raw `.stim` text (language: "stim") routes through the SAME adapter class
# but source-mode style: stim.Circuit(text), never Python exec. Kept out of
# ADAPTER_SPECS because raw stim text has no reliable lexical signature —
# it is reachable only via the explicit language hint. (PRD 10 D2)
STIM_SOURCE_SPEC = AdapterSpec(
    framework="stim",
    module="kernel.adapters.stim_adapter",
    class_name="StimAdapter",
    detect_pattern=re.compile(r"(?!)"),  # never matches; hint-only routing
    dependencies=("stim",),
    source_mode=True,
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
        "qdk": "Microsoft QDK",
        "stim": "Stim",
        "sinter": "Sinter",
        "pymatching": "PyMatching",
    }.get(dependency, dependency)
    return (
        f"{display} is not installed, so {framework} code cannot run in this environment."
    )


class Executor:
    def __init__(self, capture_limit_bytes: int | None = None):
        self._namespace: dict = {}
        self._capture_limit_bytes = capture_limit_bytes
        # Accumulated record_metric(name, value) calls from the most recent
        # run (protocol v1.1 / PRD 09 Phase B). Reset on every _run_code.
        self._metrics: dict[str, float] = {}
        # Most recent stim.Circuit seen by parse/execute (protocol v1.2 /
        # PRD 10 Phase A). Lets the qec_snapshot message re-derive the DEM
        # payload at a different edge cap without re-running user code.
        self._last_qec_circuit = None

    def _new_capture(self) -> io.TextIOBase:
        if self._capture_limit_bytes is None:
            return io.StringIO()

        from kernel.agent_limits import BoundedTextCapture

        return BoundedTextCapture(self._capture_limit_bytes)

    def _reset_namespace(self) -> None:
        self._namespace = {"__builtins__": __builtins__}
        self._metrics = {}

    def _record_metric(self, name: str, value: float) -> None:
        """The `record_metric` closure injected into user code's namespace.

        Last write wins per name — documented in PRD 09: recording the same
        name twice overwrites rather than accumulating.
        """
        self._metrics[str(name)] = float(value)

    def _detect_adapter_spec(self, code: str) -> AdapterSpec | None:
        for spec in ADAPTER_SPECS:
            if spec.detect_pattern.search(code):
                return spec
        return None

    def _resolve_spec(self, code: str, language: str | None) -> AdapterSpec | None:
        """Pick the adapter spec, honoring an explicit language hint.

        The frontend knows the file type, so its hint beats regex detection:
        "qsharp" routes straight to the Q# spec, "python" excludes
        source-mode specs so Q#-looking text in Python strings or comments
        can't hijack routing. No hint falls back to pure regex detection.
        """
        if language == "qsharp":
            return next(
                (spec for spec in ADAPTER_SPECS if spec.framework == "qsharp"), None
            )
        if language == "stim":
            # Raw .stim interchange text — hint-only routing, source-mode
            # style (stim.Circuit(text), no Python exec). PRD 10 D2.
            return STIM_SOURCE_SPEC
        if language == "python":
            return next(
                (
                    spec
                    for spec in ADAPTER_SPECS
                    if not spec.source_mode and spec.detect_pattern.search(code)
                ),
                None,
            )
        return self._detect_adapter_spec(code)

    def resolve_framework(self, code: str, *, language: str | None = None) -> str | None:
        """Select an adapter without importing or executing generated source.

        Selection uses the language hint and lexical patterns. It is a routing
        correctness check, not package confinement: comments and dynamic
        imports can intentionally differ from the selected adapter.
        """
        spec = self._resolve_spec(code, language)
        return spec.framework if spec is not None else None

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

    def _run_code(
        self,
        code: str,
        *,
        params: dict[str, float] | None = None,
        seed: int | None = None,
    ) -> tuple[str, str, KernelError | None]:
        """Execute user code and return (stdout, stderr, error).

        stdout and stderr are captured separately so the frontend can
        style them differently in the terminal. A Python-level exception
        is surfaced as the KernelError (with stdout/stderr still returned
        so the user sees what was printed before the failure).

        Protocol v1.1 (PRD 09 Phase B), additive: `params` is ALWAYS
        injected into the namespace as a dict (empty when not supplied),
        so `params.get("theta", default)` is portable between casual runs
        and experiment runs. `record_metric(name, value)` is always
        injected too. When `seed` is given, Python's `random` and (if
        installed) `numpy.random` are seeded before exec so user-side
        randomness is captured by reproducible runs as well.
        """
        import random
        import signal
        import threading

        stdout_capture = self._new_capture()
        stderr_capture = self._new_capture()

        self._reset_namespace()
        self._namespace["params"] = dict(params) if params else {}
        self._namespace["record_metric"] = self._record_metric

        if seed is not None:
            random.seed(seed)
            try:
                import numpy as np

                np.random.seed(seed)
            except ImportError:
                pass

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
            return stdout_capture.getvalue(), stderr_capture.getvalue(), None
        except ExecutionTimeout as exc:
            return stdout_capture.getvalue(), stderr_capture.getvalue(), KernelError(
                code="timeout",
                message=str(exc),
            )
        except (SyntaxError, IndentationError):
            tb = traceback.format_exc()
            return stdout_capture.getvalue(), stderr_capture.getvalue(), KernelError(
                code="compile_error",
                message=_short_error_message(tb),
                traceback=tb,
            )
        except Exception:
            tb = traceback.format_exc()
            return stdout_capture.getvalue(), stderr_capture.getvalue(), KernelError(
                code="execution_error",
                message=_short_error_message(tb),
                traceback=tb,
            )

    def run_python(self, code: str) -> tuple[str, str, KernelError | None]:
        return self._run_code(code)

    def parse(
        self, code: str, *, language: str | None = None
    ) -> tuple[CircuitSnapshot | None, str, str, KernelError | None]:
        spec = self._resolve_spec(code, language)
        if spec is None:
            return None, "", "", KernelError(
                code="unsupported_framework",
                message="No supported quantum framework detected in code.",
            )

        adapter, adapter_error = self._load_adapter(spec)
        if adapter_error:
            return None, "", "", adapter_error

        if spec.source_mode:
            # Source-mode adapters own the whole pipeline — their source
            # never reaches exec(). Their return shape matches ours exactly.
            try:
                outcome = adapter.parse_source(code)
            except Exception as exc:
                return None, "", "", self._capability_error(spec, exc, "adapter_error")
            if spec.framework == "stim":
                self._last_qec_circuit = getattr(adapter, "last_circuit", None)
            return outcome

        stdout, stderr, error = self._run_code(code)
        if error:
            error = self._normalize_runtime_error(spec, error)
            error.framework = spec.framework
            return None, stdout, stderr, error

        try:
            circuit = adapter.find_circuit(self._namespace)
        except Exception as exc:
            return None, stdout, stderr, self._capability_error(spec, exc, "adapter_error")

        if spec.framework == "stim":
            self._last_qec_circuit = circuit

        if circuit is None:
            return None, stdout, stderr, None

        try:
            snapshot = adapter.extract_snapshot(circuit)
        except Exception as exc:
            return None, stdout, stderr, self._capability_error(spec, exc, "adapter_error")

        return snapshot, stdout, stderr, None

    def execute(
        self,
        code: str,
        shots: int,
        *,
        language: str | None = None,
        params: dict[str, float] | None = None,
        seed: int | None = None,
    ) -> tuple[SimulationResult | None, CircuitSnapshot | None, str, str, KernelError | None]:
        """Run the full pipeline: build the circuit, snapshot, simulate.

        `params`/`seed` are optional (protocol v1.1 / PRD 09 Phase B),
        additive over the v1 contract — omitting both reproduces the exact
        v1 behavior. `params` is injected into the exec namespace (always a
        dict, `{}` when omitted); `seed` requests reproducible sampling and
        is forwarded to the adapter's `simulate`/`execute_source`, which
        reports back via `SimulationResult.seed_honored`. Any
        `record_metric(name, value)` calls the user's code made are merged
        into the returned result's `metrics` (empty dict when none).
        """
        spec = self._resolve_spec(code, language)
        if spec is None:
            return None, None, "", "", KernelError(
                code="unsupported_framework",
                message="No supported quantum framework detected in code.",
            )

        adapter, adapter_error = self._load_adapter(spec)
        if adapter_error:
            return None, None, "", "", adapter_error

        if spec.source_mode:
            try:
                outcome = adapter.execute_source(code, shots, params=params, seed=seed)
            except Exception as exc:
                return None, None, "", "", self._capability_error(
                    spec, exc, "execution_error"
                )
            if spec.framework == "stim":
                self._last_qec_circuit = getattr(adapter, "last_circuit", None)
            return outcome

        stdout, stderr, error = self._run_code(code, params=params, seed=seed)
        if error:
            error = self._normalize_runtime_error(spec, error)
            error.framework = spec.framework
            return None, None, stdout, stderr, error

        try:
            circuit = adapter.find_circuit(self._namespace)
        except Exception as exc:
            return None, None, stdout, stderr, self._capability_error(spec, exc, "adapter_error")

        if spec.framework == "stim":
            self._last_qec_circuit = circuit

        if circuit is None:
            return None, None, stdout, stderr, KernelError(
                code="no_circuit",
                message="No quantum circuit found in code.",
                framework=spec.framework,
            )

        try:
            snapshot = adapter.extract_snapshot(circuit)
        except Exception as exc:
            return None, None, stdout, stderr, self._capability_error(spec, exc, "adapter_error")

        try:
            result = adapter.simulate(circuit, shots, seed=seed)
        except Exception as exc:
            return None, snapshot, stdout, stderr, self._capability_error(
                spec, exc, "simulation_error"
            )

        # Merge whatever the user's code recorded via record_metric — always
        # present on the wire (empty dict when nothing was recorded).
        result = dataclasses.replace(result, metrics=dict(self._metrics))

        return result, snapshot, stdout, stderr, None

    def qec_snapshot_payload(
        self,
        *,
        code: str | None = None,
        language: str | None = None,
        max_edges: int | None = None,
    ) -> tuple[dict | None, KernelError | None]:
        """Build the `qec_snapshot` payload (protocol v1.2 / PRD 10 Phase A).

        Two forms:
        - With `code`: stateless — build the circuit fresh (raw .stim text
          parses cheaply; Python stim code re-runs through exec, which is
          documented as having side effects, exactly like `parse`).
        - Without `code`: reuse the most recent stim circuit this
          connection parsed/executed — the "render anyway" path, where the
          frontend re-requests the DEM at a higher edge cap without
          re-running anything.
        """
        from kernel.qec.dem import MAX_DEM_EDGES

        cap = MAX_DEM_EDGES if max_edges is None else max(1, int(max_edges))

        circuit = self._last_qec_circuit
        if code is not None:
            spec = self._resolve_spec(code, language)
            if spec is None or spec.framework != "stim":
                return None, KernelError(
                    code="unsupported_framework",
                    message=(
                        "qec_snapshot requires a Stim circuit — send raw .stim "
                        'text with language "stim", or Python code that builds '
                        "a stim.Circuit."
                    ),
                )
            adapter, adapter_error = self._load_adapter(spec)
            if adapter_error:
                return None, adapter_error
            if spec.source_mode:
                try:
                    circuit = adapter.build_from_source(code)
                except ValueError as exc:
                    return None, KernelError(
                        code="compile_error",
                        message=str(exc).strip().splitlines()[0],
                        framework="stim",
                    )
            else:
                stdout, stderr, error = self._run_code(code)
                if error:
                    error = self._normalize_runtime_error(spec, error)
                    error.framework = spec.framework
                    return None, error
                try:
                    circuit = adapter.find_circuit(self._namespace)
                except Exception as exc:
                    return None, self._capability_error(spec, exc, "adapter_error")
            self._last_qec_circuit = circuit

        if circuit is None:
            return None, KernelError(
                code="no_circuit",
                message=(
                    "No Stim circuit available for qec_snapshot — parse or "
                    "execute one first, or include `code` in the request."
                ),
                framework="stim",
            )

        try:
            from kernel.qec.dem import build_qec_payload

            return build_qec_payload(circuit, max_edges=cap), None
        except ImportError:
            return None, KernelError(
                code="missing_dependency",
                message=_missing_dependency_message("stim", "stim"),
                framework="stim",
                dependency="stim",
            )
        except Exception as exc:
            return None, self._capability_error(None, exc, "adapter_error")

    def transpile(
        self,
        code: str,
        *,
        basis_gates: list[str] | None = None,
        coupling_map: list[list[int]] | None = None,
        optimization_level: int = 1,
        language: str | None = None,
    ) -> tuple[dict | None, str, str, KernelError | None]:
        """Build a Qiskit circuit from `code` and transpile it against a target.

        Return shape mirrors parse()/execute(): (payload, stdout, stderr,
        error). The payload is a plain metrics dict rather than a typed
        dataclass — there is no CircuitSnapshot/SimulationResult equivalent
        for a transpile preview, just depth/gate-count/mapping facts.

        Qiskit-only: any other detected (or absent) framework returns a
        `transpile_unsupported_framework` KernelError instead of running,
        since qiskit.transpile has no meaning for cirq/Q# circuit objects.
        qiskit is imported lazily inside this method, matching the rest of
        the module's no-import-time-dependency pattern.
        """
        spec = self._resolve_spec(code, language)
        if spec is None or spec.framework != "qiskit":
            return None, "", "", KernelError(
                code="transpile_unsupported_framework",
                message="Transpilation preview currently supports Qiskit circuits.",
                framework=spec.framework if spec else None,
            )

        adapter, adapter_error = self._load_adapter(spec)
        if adapter_error:
            return None, "", "", adapter_error

        stdout, stderr, error = self._run_code(code)
        if error:
            error = self._normalize_runtime_error(spec, error)
            error.framework = spec.framework
            return None, stdout, stderr, error

        try:
            circuit = adapter.find_circuit(self._namespace)
        except Exception as exc:
            return None, stdout, stderr, self._capability_error(spec, exc, "adapter_error")

        if circuit is None:
            return None, stdout, stderr, KernelError(
                code="no_circuit",
                message="No quantum circuit found in code.",
                framework=spec.framework,
            )

        try:
            from qiskit import transpile as qiskit_transpile
        except ImportError as exc:
            dependency = exc.name or "qiskit"
            return None, stdout, stderr, KernelError(
                code="missing_dependency",
                message=_missing_dependency_message(spec.framework, dependency),
                framework=spec.framework,
                dependency=dependency,
            )

        try:
            transpiled = qiskit_transpile(
                circuit,
                basis_gates=basis_gates or None,
                coupling_map=coupling_map or None,
                optimization_level=optimization_level,
            )
        except Exception:
            tb = traceback.format_exc()
            return None, stdout, stderr, KernelError(
                code="adapter_error",
                message=_short_error_message(tb),
                traceback=tb,
                framework=spec.framework,
            )

        gate_counts: dict[str, int] = {}
        two_qubit_count = 0
        for instruction in transpiled.data:
            name = instruction.operation.name
            gate_counts[name] = gate_counts.get(name, 0) + 1
            if len(instruction.qubits) == 2:
                two_qubit_count += 1

        metrics = {
            "depth": transpiled.depth(),
            "gate_counts": gate_counts,
            "two_qubit_count": two_qubit_count,
            "num_qubits": transpiled.num_qubits,
            "basis_gates": list(basis_gates) if basis_gates else None,
            "coupling_mapped": bool(coupling_map),
        }

        return metrics, stdout, stderr, None
