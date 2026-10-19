"""Static AST pre-screen for candidate programs (PRD 15 R-19).

A cheap, deterministic scan that rejects the obvious ways a candidate could delete, overwrite or
smuggle code, *before* anything executes. It runs on a plain-``process`` host (where no OS
sandbox exists) and for every program written by an untrusted origin (``claude``) at any tier.

This is a speed bump for accidental and prompt-injected destruction, not a security boundary: a
determined adversary can write Python this scan does not recognise. The boundary is the OS tier
(``landlock`` / ``bwrap`` / ``sandbox-exec``) and, where there is none, the user's informed consent.

Rejected, each with a stable rule id:

========================  ===========================================================================
``dunder_import``         ``__import__`` in any position (also ``builtins.__import__``)
``dynamic_code``          ``eval`` / ``exec`` / ``compile`` (builtins, not ``re.compile``)
``importlib``             importing or using ``importlib``
``shutil``                importing or using ``shutil`` (``rmtree``, ``copy``, ``move`` ...)
``open_write``            ``open`` / ``Path.open`` / ``io.open`` with a mode containing ``w a x +``
``open_dynamic_mode``     ``open`` whose mode is not a string literal (it could be a write mode)
``os_open``               ``os.open`` (flags can request writing)
``file_removal``          ``os.remove`` / ``unlink`` / ``rmdir`` / ``removedirs`` / ``rename`` ... and
                          ``pathlib`` ``unlink`` / ``rmdir`` / ``write_text`` / ``write_bytes``
``blocked_getattr``       ``getattr(x, "<blocked name>")`` and ``x["<blocked name>"]`` with a literal
``introspection``         ``__builtins__`` / ``__subclasses__`` / ``__globals__`` (sandbox-escape chains)
========================  ===========================================================================
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass

__all__ = ["Finding", "prescreen", "first_rejection_message"]

_DYNAMIC_BUILTINS = frozenset({"eval", "exec", "compile"})
_OS_DESTRUCTIVE = frozenset({"remove", "unlink", "rmdir", "removedirs", "rename", "renames", "replace", "truncate"})
_PATH_DESTRUCTIVE = frozenset({"unlink", "rmdir", "rmtree", "write_text", "write_bytes"})
_INTROSPECTION = frozenset({"__builtins__", "__subclasses__", "__globals__"})
_WRITE_MODE_CHARS = frozenset("wax+")
_MODE_RE = re.compile(r"[rwxabtU+]{1,4}")
# Names that must not be reachable through a string literal (``getattr(os, "remove")``).
# ``replace`` is left out: ``str.replace`` is far too common to treat as destructive here.
_LITERAL_BLOCKED = (
    (_OS_DESTRUCTIVE - {"replace"}) | _PATH_DESTRUCTIVE | _DYNAMIC_BUILTINS | _INTROSPECTION
    | {"__import__", "rmtree", "system", "popen", "importlib", "shutil"}
)


@dataclass(frozen=True)
class Finding:
    rule: str
    line: int
    message: str


def _const_str(node: ast.AST) -> str | None:
    """The string ``node`` evaluates to when it is a literal, a literal concatenation or a constant f-string."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = _const_str(node.left), _const_str(node.right)
        return left + right if left is not None and right is not None else None
    if isinstance(node, ast.JoinedStr):
        parts = [_const_str(v) for v in node.values]
        return "".join(parts) if all(p is not None for p in parts) else None
    return None


class _Scanner(ast.NodeVisitor):
    def __init__(self) -> None:
        self.findings: list[Finding] = []
        self._modules: dict[str, str] = {}  # local name -> imported module root

    def _add(self, rule: str, node: ast.AST, message: str) -> None:
        self.findings.append(Finding(rule, getattr(node, "lineno", 0), message))

    # --- imports ---------------------------------------------------------------------------
    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            root = alias.name.split(".")[0]
            self._modules[alias.asname or root] = root
            self._flag_module(root, node)
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        root = (node.module or "").split(".")[0]
        self._flag_module(root, node)
        for alias in node.names:
            name = alias.name
            if root == "os" and name == "open":
                self._add("os_open", node, "'os.open' can open files for writing")
            elif root == "os" and (name == "*" or name in _OS_DESTRUCTIVE):
                self._add("file_removal", node, f"'from os import {name}' exposes a file-destroying call")
            if root == "builtins" and name in _DYNAMIC_BUILTINS | {"__import__"}:
                self._add("dynamic_code" if name != "__import__" else "dunder_import", node, f"'{name}' is not allowed")
        self.generic_visit(node)

    def _flag_module(self, root: str, node: ast.AST) -> None:
        if root == "shutil":
            self._add("shutil", node, "'shutil' can delete and overwrite files")
        elif root == "importlib":
            self._add("importlib", node, "'importlib' loads arbitrary code")

    # --- names and attributes --------------------------------------------------------------
    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, ast.Load):
            if node.id == "__import__":
                self._add("dunder_import", node, "'__import__' is not allowed")
            elif node.id in _DYNAMIC_BUILTINS:
                self._add("dynamic_code", node, f"'{node.id}' runs arbitrary code")
            elif node.id in _INTROSPECTION:
                self._add("introspection", node, f"'{node.id}' is used to escape restrictions")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        base = self._modules.get(node.value.id) if isinstance(node.value, ast.Name) else None
        attr = node.attr
        if attr in _INTROSPECTION:
            self._add("introspection", node, f"'.{attr}' is used to escape restrictions")
        elif base == "shutil":
            self._add("shutil", node, "'shutil' can delete and overwrite files")
        elif base == "importlib":
            self._add("importlib", node, "'importlib' loads arbitrary code")
        elif base == "builtins" and attr in _DYNAMIC_BUILTINS | {"__import__"}:
            self._add("dunder_import" if attr == "__import__" else "dynamic_code", node, f"'builtins.{attr}' is not allowed")
        elif base == "os" and attr in _OS_DESTRUCTIVE:
            self._add("file_removal", node, f"'os.{attr}' destroys or overwrites files")
        elif base == "os" and attr == "open":
            self._add("os_open", node, "'os.open' can open files for writing")
        elif attr in _PATH_DESTRUCTIVE:
            self._add("file_removal", node, f"'.{attr}()' deletes or overwrites files")
        self.generic_visit(node)

    def visit_Subscript(self, node: ast.Subscript) -> None:
        key = _const_str(node.slice)
        if key in _LITERAL_BLOCKED:
            self._add("blocked_getattr", node, f"['{key}'] reaches a blocked name")
        self.generic_visit(node)

    # --- calls -------------------------------------------------------------------------------
    def visit_Call(self, node: ast.Call) -> None:
        func = node.func
        if isinstance(func, ast.Name) and func.id == "getattr" and len(node.args) >= 2:
            name = _const_str(node.args[1])
            if name in _LITERAL_BLOCKED:
                self._add("blocked_getattr", node, f"getattr(..., '{name}') reaches a blocked name")
        if self._is_open_call(func):
            self._check_open_mode(node)
        self.generic_visit(node)

    def _is_open_call(self, func: ast.AST) -> bool:
        if isinstance(func, ast.Name):
            return func.id == "open"
        return isinstance(func, ast.Attribute) and func.attr in ("open", "fdopen")

    def _check_open_mode(self, node: ast.Call) -> None:
        """``open(file, mode)`` / ``io.open`` / ``Path.open(mode)``: reject write modes."""
        func = node.func
        keyword = next((k.value for k in node.keywords if k.arg == "mode"), None)
        known_module = isinstance(func, ast.Name) or (
            isinstance(func.value, ast.Name) and self._modules.get(func.value.id) in ("io", "builtins", "os")
        )
        if known_module:
            mode_node = node.args[1] if len(node.args) >= 2 else keyword
            if mode_node is not None and _const_str(mode_node) is None:
                self._add("open_dynamic_mode", node, "open() mode must be a string literal")
                return
            modes = [_const_str(mode_node)] if mode_node is not None else []
        else:
            # An unknown receiver (``Path(...).open``, ``tarfile.open``): the mode is wherever a
            # mode-shaped literal sits; a variable there cannot be judged and is not flagged.
            literals = [_const_str(a) for a in (*node.args[:2], keyword) if a is not None]
            modes = [m for m in literals if m and _MODE_RE.fullmatch(m)]
        for mode in modes:
            if _WRITE_MODE_CHARS & set(mode):
                self._add("open_write", node, f"open(..., '{mode}') writes files")
                return


def prescreen(program: str) -> list[Finding]:
    """All rejections found in ``program``, in source order. A syntax error yields none: the worker reports it."""
    try:
        tree = ast.parse(program)
    except (SyntaxError, ValueError, RecursionError):
        return []
    scanner = _Scanner()
    scanner.visit(tree)
    return sorted(scanner.findings, key=lambda f: (f.line, f.rule))


def first_rejection_message(findings: list[Finding]) -> str:
    """``prescreen: <rule> at line N: <why>`` for the first finding (plus a count of the rest)."""
    first = findings[0]
    more = f" (+{len(findings) - 1} more)" if len(findings) > 1 else ""
    return f"prescreen: {first.rule} at line {first.line}: {first.message}{more}"
