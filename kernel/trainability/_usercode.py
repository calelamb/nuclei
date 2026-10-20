"""Run the user's circuit code the way ``parse``/``execute`` do (same trust).

Used by the inspector (in the kernel process, like ``parse``) and by the job
worker (in the subprocess).  Gate source lines are recovered with
``trace_gate_lines`` so the converter can fill ``IrGate.source_line``.
"""

from __future__ import annotations

import ast
import builtins
import io
import sys
import traceback
from dataclasses import dataclass, field
from typing import Any

from kernel import run_context
from kernel.trainability._errors import TrainabilityError, short_message
from kernel.trainability.convert import from_object
from kernel.trainability.ir import ParamCircuit
from kernel.trainability.linetrace import GateLineMap, trace_gate_lines
from kernel.trainability.pauli import ObservableError, PauliSum, PauliTerm, parse_observable

FILENAME = "<nuclei-trainability>"
DECLARED_OBSERVABLE = "nuclei_observable"
UNSUPPORTED_LANGUAGES = ("qsharp", "stim")


@dataclass
class LoadedCircuit:
    circuit: ParamCircuit
    source_object: Any
    namespace: dict = field(repr=False)
    lines: GateLineMap | None = None


def _scoped_builtins(sink: io.StringIO) -> dict:
    """A private copy of the builtins whose ``print`` writes to ``sink``.

    Capturing user prints this way touches no process-global state.  The old
    ``contextlib.redirect_stdout`` swapped ``sys.stdout`` while this ran on a
    worker thread, so output of a concurrent editor ``execute`` landed in the
    sink (and the restore order could leave the wrong stream installed).
    In-process inspect/lint must stay fast (a subprocess costs ~250 ms, half
    the lint budget, against ~0.3 ms in-process), hence no subprocess here.
    """
    scoped = dict(vars(builtins))
    real_print = builtins.print

    def captured_print(*args, sep=" ", end="\n", file=None, flush=False):
        real_print(*args, sep=sep, end=end, file=sink if file is None else file, flush=False)

    scoped["print"] = captured_print
    return scoped


def _worker_namespace(runtime, code: str, params: dict | None) -> tuple[dict, GateLineMap]:
    """In a run worker: the program's execution is shared (loaded-circuit cache) with parse and the other consumers."""
    program = runtime.load_program(code, params=dict(params or {}))
    if program.error is not None:
        wire = program.error["code"]
        raise TrainabilityError(wire if wire == "compile_error" else "execution_error", program.error["message"])
    return program.namespace, program.line_map


def run_namespace(code: str, params: dict | None) -> tuple[dict, GateLineMap]:
    """Execute ``code`` with ``params`` injected; returns (namespace, lines)."""
    runtime = run_context.current()
    if runtime is not None:
        return _worker_namespace(runtime, code, params)
    run_context.assert_inprocess_exec_allowed("trainability _usercode.run_namespace")
    sink = io.StringIO()
    namespace: dict = {
        "__builtins__": _scoped_builtins(sink),
        "params": dict(params) if params else {},
        "record_metric": lambda name, value: None,
    }
    try:
        compiled = compile(code, FILENAME, "exec")
    except SyntaxError as exc:
        raise TrainabilityError("compile_error", f"{exc.msg} (line {exc.lineno})") from exc
    try:
        with trace_gate_lines(FILENAME) as lines:
            exec(compiled, namespace)  # noqa: S102 - user's own code, same trust as execute
    except TrainabilityError:
        raise
    except (Exception, SystemExit) as exc:
        raise TrainabilityError("execution_error", short_message(traceback.format_exc())) from exc
    return namespace, lines


def find_circuit_object(namespace: dict) -> Any | None:
    """The last circuit object in definition order, like the adapters."""
    candidates: list[Any] = []
    qiskit = sys.modules.get("qiskit")
    cirq = sys.modules.get("cirq")
    for value in namespace.values():
        if isinstance(value, ParamCircuit):
            candidates.append(value)
        elif qiskit is not None and isinstance(value, qiskit.QuantumCircuit):
            candidates.append(value)
        elif cirq is not None and isinstance(value, cirq.Circuit):
            candidates.append(value)
    return candidates[-1] if candidates else None


def load_circuit(code: str, params: dict | None, language: str | None = None) -> LoadedCircuit:
    if language in UNSUPPORTED_LANGUAGES:
        raise TrainabilityError(
            "unsupported_language", f"Trainability analysis needs a Python circuit, not {language}."
        )
    namespace, lines = run_namespace(code, params)
    obj = find_circuit_object(namespace)
    if obj is None:
        raise TrainabilityError(
            "no_circuit", "No Qiskit or Cirq circuit was found after running the code."
        )
    circuit = from_object(obj, line_map=lines)
    return LoadedCircuit(circuit, obj, namespace, lines)


# ------------------------------------------------------------- sweepable


def detect_sweepable_params(code: str) -> list[str]:
    """Names read via ``params.get("x")`` or ``params["x"]`` (first-seen order)."""
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []
    found: dict[str, None] = {}
    for node in ast.walk(tree):
        key = _params_key(node)
        if key is not None:
            found.setdefault(key, None)
    return list(found)


def _is_params(node: ast.AST) -> bool:
    return isinstance(node, ast.Name) and node.id == "params"


def _str_const(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _params_key(node: ast.AST) -> str | None:
    if isinstance(node, ast.Call):
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr == "get" and _is_params(func.value) and node.args:
            return _str_const(node.args[0])
    elif isinstance(node, ast.Subscript) and _is_params(node.value):
        return _str_const(node.slice)
    return None


# ----------------------------------------------------------- observables


def declared_observable(loaded: LoadedCircuit) -> PauliSum | str | None:
    """The module-level ``nuclei_observable`` converted, or None."""
    value = loaded.namespace.get(DECLARED_OBSERVABLE)
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, PauliSum):
        return value
    return _foreign_to_pauli_sum(value, loaded)


def _foreign_to_pauli_sum(value: Any, loaded: LoadedCircuit) -> PauliSum:
    n = loaded.circuit.n_qubits
    qiskit_quantum_info = sys.modules.get("qiskit.quantum_info")
    if qiskit_quantum_info is not None and isinstance(value, qiskit_quantum_info.SparsePauliOp):
        terms = _sparse_pauli_terms(value)
    elif sys.modules.get("cirq") is not None and type(value).__name__ == "PauliSum":
        terms = _cirq_terms(value, loaded.source_object)
    else:
        raise ObservableError(
            f"{DECLARED_OBSERVABLE} must be a string, SparsePauliOp or cirq.PauliSum "
            f"(got {type(value).__name__})",
            0,
        )
    return _canonical(terms, n)


def _sparse_pauli_terms(op: Any) -> list[PauliTerm]:
    terms = []
    for label, coeff in op.to_list():
        coeff = complex(coeff)
        if abs(coeff.imag) > 1e-12:
            raise ObservableError("observable has a complex coefficient (not Hermitian)", 0)
        ops = tuple(
            sorted((len(label) - 1 - i, ch) for i, ch in enumerate(label) if ch != "I")
        )
        terms.append(PauliTerm(coeff.real, ops))
    return terms


def _cirq_terms(value: Any, circuit_obj: Any) -> list[PauliTerm]:
    index = {q: i for i, q in enumerate(sorted(circuit_obj.all_qubits()))} if hasattr(
        circuit_obj, "all_qubits"
    ) else {}
    terms = []
    for string in value:
        coeff = complex(string.coefficient)
        if abs(coeff.imag) > 1e-12:
            raise ObservableError("observable has a complex coefficient (not Hermitian)", 0)
        ops = []
        for qubit, pauli in string.items():
            if qubit not in index:
                raise ObservableError(f"observable acts on {qubit}, which is not in the circuit", 0)
            ops.append((index[qubit], str(pauli).upper()))
        terms.append(PauliTerm(coeff.real, tuple(sorted(ops))))
    return terms


def _canonical(terms: list[PauliTerm], n: int) -> PauliSum:
    """Merge duplicate terms by round-tripping through the canonical text."""
    return parse_observable(PauliSum(tuple(terms)).to_text(), n)


def resolve_observable(
    request_spec: str | None, loaded: LoadedCircuit
) -> PauliSum:
    """request -> module ``nuclei_observable`` -> ``preset:local_z``."""
    n = loaded.circuit.n_qubits
    if request_spec is not None and request_spec.strip():
        return parse_observable(request_spec, n)
    declared = declared_observable(loaded)
    if isinstance(declared, PauliSum):
        return declared
    if isinstance(declared, str):
        return parse_observable(declared, n)
    return parse_observable("preset:local_z", n)
