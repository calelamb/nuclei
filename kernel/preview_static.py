"""The static fast path for live circuit preview (audit R-8 d, design note section 3.2).

For the common straight-line program (imports, numeric constants, a circuit built by plain gate
calls) the circuit diagram does not need the program to *run*: this module interprets the AST
itself, calling only a whitelist of circuit-building APIs, so keystrokes never trigger file writes,
network calls, ``print`` spam or a multi-second optimisation loop.  Anything outside the whitelist
(defs, loops, comprehensions, main guards, unknown names or calls) returns ``None`` and the caller
falls back to the worker's cached execution; so does any error a gate call raises, so the user sees
the real traceback from the real run.  Nothing is imported here: libraries must already be loaded.
"""

from __future__ import annotations

import ast
import operator
import sys
from dataclasses import dataclass
from typing import Any

IMPORT_ROOTS = frozenset({"qiskit", "qiskit_aer", "cirq", "numpy", "math"})
QISKIT_GATES = frozenset(
    "h x y z s sdg t tdg sx sxdg id rx ry rz p u cx cy cz ch swap iswap ccx cswap crx cry crz cp rxx ryy rzz "
    "measure measure_all barrier reset".split()
)
QISKIT_CLASSES = frozenset({"QuantumCircuit", "QuantumRegister", "ClassicalRegister", "Parameter", "ParameterVector"})
CIRQ_CLASSES = frozenset({"Circuit", "LineQubit", "GridQubit", "NamedQubit"})
CIRQ_OPS = frozenset({"H", "X", "Y", "Z", "S", "T", "CNOT", "CX", "CZ", "SWAP", "CCX", "TOFFOLI", "rx", "ry", "rz", "measure"})
CONSTRUCTORS = frozenset({"range", "rect", "square", "from_diagram"})
MATH_NAMES = frozenset({"sin", "cos", "tan", "sqrt", "exp", "log", "arccos", "arcsin", "arctan", "acos", "asin", "atan", "radians"})
SAFE_BUILTINS = {"range": range, "float": float, "int": int, "abs": abs, "min": min, "max": max, "len": len}
SINK_NAMES = frozenset({
    "print", "AerSimulator", "get_backend", "run", "result", "get_counts", "get_statevector",
    "Simulator", "simulate", "histogram", "draw", "plot_histogram", "show", "sample",
})
BINARY = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
          ast.Pow: operator.pow, ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod}
MAX_STATEMENTS = 2000


class _Bail(Exception):
    """The program is outside the static subset; run it instead."""


@dataclass(frozen=True)
class StaticCircuit:
    framework: str
    circuit: Any


def _loaded(name: str) -> Any:
    module = sys.modules.get(name)
    if module is None:
        raise _Bail(name)
    return module


class _Interpreter:
    def __init__(self) -> None:
        self.env: dict[str, Any] = {}

    # -- statements --------------------------------------------------------

    def run(self, tree: ast.Module) -> None:
        if len(tree.body) > MAX_STATEMENTS:
            raise _Bail("too long")
        for statement in tree.body:
            self.statement(statement)

    def statement(self, node: ast.stmt) -> None:
        if isinstance(node, ast.Import):
            for alias in node.names:
                self._bind_import(alias.asname or alias.name.split(".")[0], alias.name if alias.asname else alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            self._import_from(node)
        elif isinstance(node, ast.Expr):
            if not self._is_sink(node.value):
                self.expression(node.value)
        elif isinstance(node, ast.Assign):
            if self._is_sink(node.value):
                return
            self._assign(node.targets, self.expression(node.value))
        elif not isinstance(node, ast.Pass):
            raise _Bail(type(node).__name__)

    def _bind_import(self, bound: str, dotted: str) -> None:
        if dotted.split(".")[0] not in IMPORT_ROOTS:
            raise _Bail(dotted)
        self.env[bound] = _loaded(dotted)

    def _import_from(self, node: ast.ImportFrom) -> None:
        if node.level or not node.module or node.module.split(".")[0] not in IMPORT_ROOTS:
            raise _Bail(str(node.module))
        module = _loaded(node.module)
        for alias in node.names:
            if alias.name == "*" or not hasattr(module, alias.name):
                raise _Bail(alias.name)
            self.env[alias.asname or alias.name] = getattr(module, alias.name)

    def _assign(self, targets: list[ast.expr], value: Any) -> None:
        if len(targets) != 1:
            raise _Bail("chained assignment")
        target = targets[0]
        if isinstance(target, ast.Name):
            self.env[target.id] = value
        elif isinstance(target, (ast.Tuple, ast.List)) and all(isinstance(t, ast.Name) for t in target.elts):
            values = list(value)
            if len(values) != len(target.elts):
                raise _Bail("unpack size")
            for name, item in zip(target.elts, values):
                self.env[name.id] = item
        else:
            raise _Bail("assignment target")

    @staticmethod
    def _is_sink(node: ast.expr) -> bool:
        calls = [n for n in ast.walk(node) if isinstance(n, ast.Call)]
        return bool(calls) and all(_callee_name(c.func) in SINK_NAMES and not _needs_real_run(c) for c in calls)

    # -- expressions ---------------------------------------------------------

    def expression(self, node: ast.expr) -> Any:
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            return self._name(node.id)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            operand = self._number(self.expression(node.operand))
            return -operand if isinstance(node.op, ast.USub) else operand
        if isinstance(node, ast.BinOp) and type(node.op) in BINARY:
            return BINARY[type(node.op)](self._number(self.expression(node.left)), self._number(self.expression(node.right)))
        if isinstance(node, (ast.List, ast.Tuple)):
            return [self._element(e) for e in node.elts] if isinstance(node, ast.List) else tuple(self._element(e) for e in node.elts)
        if isinstance(node, ast.Attribute):
            return self._attribute(node)
        if isinstance(node, ast.Subscript):
            return self._subscript(node)
        if isinstance(node, ast.Call):
            return self._call(node)
        raise _Bail(type(node).__name__)

    def _element(self, node: ast.expr) -> Any:
        return self.expression(node)

    def _name(self, name: str) -> Any:
        if name in self.env:
            return self.env[name]
        if name in SAFE_BUILTINS:
            return SAFE_BUILTINS[name]
        raise _Bail(name)

    @staticmethod
    def _number(value: Any) -> Any:
        if isinstance(value, bool) or not isinstance(value, (int, float)) and not hasattr(value, "parameters"):
            raise _Bail("non-numeric operand")
        return value

    def _attribute(self, node: ast.Attribute) -> Any:
        base = self.expression(node.value)
        if isinstance(base, type(sys)) or isinstance(base, type):
            if not hasattr(base, node.attr):
                raise _Bail(node.attr)
            return getattr(base, node.attr)
        raise _Bail("attribute on a value")

    def _subscript(self, node: ast.Subscript) -> Any:
        base = self.expression(node.value)
        index = node.slice
        if isinstance(index, ast.Slice):
            parts = [None if p is None else self.expression(p) for p in (index.lower, index.upper, index.step)]
            return base[slice(*parts)]
        return base[self.expression(index)]

    # -- calls -----------------------------------------------------------------

    def _call(self, node: ast.Call) -> Any:
        args = []
        for arg in node.args:
            if isinstance(arg, ast.Starred):
                args.extend(self.expression(arg.value))
            else:
                args.append(self.expression(arg))
        kwargs = {}
        for keyword in node.keywords:
            if keyword.arg is None:
                raise _Bail("**kwargs")
            kwargs[keyword.arg] = self.expression(keyword.value)
        return self._resolve_callee(node.func)(*args, **kwargs)

    def _resolve_callee(self, func: ast.expr):
        if isinstance(func, ast.Name):
            target = self._name(func.id)
            if target in SAFE_BUILTINS.values() or self._allowed_function(target):
                return target
            raise _Bail(func.id)
        if isinstance(func, ast.Attribute):
            return self._resolve_attribute_callee(func)
        if isinstance(func, ast.Call):  # cirq.rx(theta)(qubit)
            produced = self._call(func)
            if _is_cirq_gate(produced):
                return produced
        raise _Bail("callee")

    def _resolve_attribute_callee(self, func: ast.Attribute):
        owner = self.expression(func.value)
        qiskit, cirq = sys.modules.get("qiskit"), sys.modules.get("cirq")
        if qiskit is not None and isinstance(owner, qiskit.QuantumCircuit) and func.attr in QISKIT_GATES:
            return getattr(owner, func.attr)
        if cirq is not None and isinstance(owner, cirq.Circuit) and func.attr == "append":
            return owner.append
        target = getattr(owner, func.attr, None)
        if target is not None and self._allowed_function(target, owner):
            return target
        if isinstance(owner, type) and owner.__name__ in CIRQ_CLASSES | QISKIT_CLASSES and func.attr in CONSTRUCTORS:
            return target  # cirq.LineQubit.range / GridQubit.rect, ...
        raise _Bail(func.attr)

    def _allowed_function(self, target: Any, owner: Any = None) -> bool:
        module = getattr(target, "__module__", "") or ""
        name = getattr(target, "__name__", "")
        if module == "math" or (module.startswith("numpy") and name in MATH_NAMES):
            return True
        if isinstance(target, type) or hasattr(target, "__self__") and isinstance(getattr(target, "__self__", None), type):
            cls = target if isinstance(target, type) else target.__self__
            return (cls.__module__.startswith("qiskit") and cls.__name__ in QISKIT_CLASSES) or (
                cls.__module__.startswith("cirq") and cls.__name__ in CIRQ_CLASSES
            )
        if module.startswith("cirq") and (name in CIRQ_OPS or _is_cirq_gate(target)):
            return True
        return name in CIRQ_OPS and _is_cirq_gate(target)


def _needs_real_run(call: ast.Call) -> bool:
    """``qc.draw('mpl')`` and friends need optional libraries: only a real run can say whether they work."""
    if _callee_name(call.func) != "draw":
        return False
    only_text = len(call.args) == 1 and isinstance(call.args[0], ast.Constant) and call.args[0].value == "text"
    return bool(call.args or call.keywords) and not only_text


def _callee_name(func: ast.expr) -> str | None:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _is_cirq_gate(value: Any) -> bool:
    cirq = sys.modules.get("cirq")
    return cirq is not None and isinstance(value, cirq.Gate)


def _find(env: dict[str, Any]) -> StaticCircuit | None:
    qiskit, cirq = sys.modules.get("qiskit"), sys.modules.get("cirq")
    found: StaticCircuit | None = None
    for value in env.values():
        if qiskit is not None and isinstance(value, qiskit.QuantumCircuit):
            found = StaticCircuit("qiskit", value)
        elif cirq is not None and isinstance(value, cirq.Circuit):
            found = StaticCircuit("cirq", value)
    return found


def try_static(code: str) -> StaticCircuit | None:
    """The circuit the program builds, without running it; ``None`` when the program is not simple enough."""
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        return None
    interpreter = _Interpreter()
    try:
        interpreter.run(tree)
    except _Bail:
        return None
    except Exception:  # noqa: BLE001 - a gate call that raises means "run it and show the real error"
        return None
    return _find(interpreter.env)
