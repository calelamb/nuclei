"""Framework detection (audit R-3).

Which quantum framework does this source use?  The answer comes from the
imports in the *parsed* program, not from a regex over the text, so
``from qiskit.circuit.library import EfficientSU2``, ``from qiskit_aer import
AerSimulator``, ``from cirq.contrib.svg import SVGCircuit`` and imports nested
inside functions, main guards or ``try`` blocks all count, while comments and
strings no longer do.

Detection never imports or runs the program.  After a program has run, the
executor falls back to :func:`framework_by_type` (a scan of the namespace by
circuit type) for programs whose own file imports no framework, such as a
script that builds its circuit in a sibling module.
"""

from __future__ import annotations

import ast
import re
import sys
from dataclasses import dataclass
from typing import Any

__all__ = [
    "Detection",
    "FrameworkRule",
    "RULES",
    "detect",
    "fallback_pattern",
    "framework_by_type",
    "looks_like_qsharp",
    "resolve_framework",
]


@dataclass(frozen=True)
class FrameworkRule:
    framework: str  # adapter id in ``executor.ADAPTER_SPECS``
    roots: tuple[str, ...]  # exact top-level import roots
    prefixes: tuple[str, ...]  # root prefixes (``qiskit_aer``, ``qiskit_ibm_runtime``, ...)
    order: int  # tie-break when two frameworks first appear at the same position


RULES: tuple[FrameworkRule, ...] = (
    FrameworkRule("qiskit", ("qiskit",), ("qiskit_",), 10),
    FrameworkRule("cirq", ("cirq", "qsimcirq"), ("cirq_",), 20),
    FrameworkRule("cuda-q", ("cudaq",), (), 30),
    FrameworkRule("stim", ("stim", "sinter"), (), 40),
)

# Q# has no import statement to key on; this is the single source of truth for "does this look
# like Q#?" (the executor's Q# spec and the hardware router reuse it).
QSHARP_PATTERN = re.compile(
    r"^\s*(namespace\s+[\w.]+|operation\s+\w+\s*\(|import\s+Std|open\s+Microsoft\.Quantum)",
    re.MULTILINE,
)

_DYNAMIC_IMPORTERS = frozenset({"import_module", "__import__"})


@dataclass(frozen=True)
class Detection:
    framework: str | None  # the first candidate
    candidates: tuple[str, ...]
    source_mode: bool  # Q# / raw stim text: never reaches Python ``exec``
    method: str  # "hint" | "ast" | "regex" | "none"
    # No framework import, but the program imports a non-stdlib module (e.g. a sibling helper that
    # builds the circuit): the executor runs it and finds the circuit by type instead of refusing.
    foreign_imports: bool = False


def looks_like_qsharp(code: str) -> bool:
    return QSHARP_PATTERN.search(code) is not None


def fallback_pattern(framework: str) -> re.Pattern[str]:
    """The multiline import regex for one framework (used only when ``ast`` cannot parse)."""
    rule = next((r for r in RULES if r.framework == framework), None)
    if rule is None:
        return re.compile(r"(?!)")
    alternatives = [re.escape(root) for root in rule.roots] + [re.escape(p) + r"\w*" for p in rule.prefixes]
    return re.compile(r"^\s*(?:from|import)\s+(?:" + "|".join(alternatives) + r")\b", re.MULTILINE)


_SYNTAX_FALLBACK = re.compile(
    r"^\s*(?:from|import)\s+(qiskit\w*|cirq\w*|qsimcirq|cudaq|stim|sinter)\b", re.MULTILINE
)


def _framework_for_root(root: str) -> FrameworkRule | None:
    for rule in RULES:
        if root in rule.roots or any(root.startswith(prefix) for prefix in rule.prefixes):
            return rule
    return None


def _dotted_root(name: str) -> str:
    return name.split(".", 1)[0]


def _dynamic_import_root(node: ast.Call) -> str | None:
    func = node.func
    called = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
    if called in _DYNAMIC_IMPORTERS and node.args:
        first = node.args[0]
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            return _dotted_root(first.value)
    return None


def _is_cudaq_kernel_decorator(node: ast.expr) -> bool:
    target = node.func if isinstance(node, ast.Call) else node
    return (
        isinstance(target, ast.Attribute)
        and target.attr == "kernel"
        and isinstance(target.value, ast.Name)
        and target.value.id == "cudaq"
    )


def _import_roots(tree: ast.AST) -> list[tuple[tuple[int, int], str]]:
    """``((line, col), root)`` for every import-like reference, in source order."""
    found: list[tuple[tuple[int, int], str]] = []
    for node in ast.walk(tree):
        position = (getattr(node, "lineno", 0), getattr(node, "col_offset", 0))
        if isinstance(node, ast.Import):
            found.extend((position, _dotted_root(alias.name)) for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            found.append((position, _dotted_root(node.module)))
        elif isinstance(node, ast.Call):
            root = _dynamic_import_root(node)
            if root is not None:
                found.append((position, root))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if any(_is_cudaq_kernel_decorator(d) for d in node.decorator_list):
                found.append((position, "cudaq"))
    found.sort(key=lambda item: item[0])
    return found


def _has_foreign_imports(roots: list[tuple[tuple[int, int], str]]) -> bool:
    stdlib = getattr(sys, "stdlib_module_names", frozenset())
    return any(root not in stdlib and root != "__future__" for _, root in roots)


def _ordered_candidates(roots: list[tuple[tuple[int, int], str]]) -> tuple[str, ...]:
    first_seen: dict[str, tuple[tuple[int, int], int]] = {}
    for position, root in roots:
        rule = _framework_for_root(root)
        if rule is not None and rule.framework not in first_seen:
            first_seen[rule.framework] = (position, rule.order)
    return tuple(sorted(first_seen, key=lambda fw: first_seen[fw]))


def _regex_candidates(code: str) -> tuple[str, ...]:
    found: dict[str, int] = {}
    for match in _SYNTAX_FALLBACK.finditer(code):
        rule = _framework_for_root(match.group(1))
        if rule is not None and rule.framework not in found:
            found[rule.framework] = match.start()
    return tuple(sorted(found, key=lambda fw: found[fw]))


def _hinted(framework: str) -> Detection:
    return Detection(framework, (framework,), True, "hint")


def _detect_unparsed(code: str, language: str | None) -> Detection:
    if language is None and looks_like_qsharp(code):
        return _hinted("qsharp")
    candidates = _regex_candidates(code)
    return Detection(candidates[0] if candidates else None, candidates, False, "regex" if candidates else "none")


def detect(code: str, language: str | None = None) -> Detection:
    """Choose the framework(s) a program uses (``language`` is the editor's file-type hint)."""
    if language == "qsharp":
        return _hinted("qsharp")
    if language == "stim":
        return _hinted("stim")
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        return _detect_unparsed(code, language)
    roots = _import_roots(tree)
    candidates = _ordered_candidates(roots)
    if candidates:
        return Detection(candidates[0], candidates, False, "ast")
    if language is None and looks_like_qsharp(code):  # e.g. a Q# file that is also valid Python
        return _hinted("qsharp")
    return Detection(None, (), False, "none", _has_foreign_imports(roots))


def resolve_framework(code: str, *, language: str | None = None) -> str | None:
    return detect(code, language).framework


def _circuit_types() -> list[tuple[str, type]]:
    """(framework, circuit class) for every framework whose package is already imported."""
    found: list[tuple[str, type]] = []
    qiskit = sys.modules.get("qiskit")
    if qiskit is not None and hasattr(qiskit, "QuantumCircuit"):
        found.append(("qiskit", qiskit.QuantumCircuit))
    cirq = sys.modules.get("cirq")
    if cirq is not None:
        found.extend(("cirq", getattr(cirq, name)) for name in ("Circuit", "FrozenCircuit") if hasattr(cirq, name))
    stim = sys.modules.get("stim")
    if stim is not None and hasattr(stim, "Circuit"):
        found.append(("stim", stim.Circuit))
    return found


def framework_by_type(namespace: dict[str, Any]) -> str | None:
    """The framework of the most recently defined circuit object in ``namespace``.

    Only packages the program has already imported are consulted, so this never imports anything.
    """
    types = _circuit_types()
    if not types:
        return None
    for value in reversed(list(namespace.values())):
        for framework, cls in types:
            if isinstance(value, cls):
                return framework
    return None
