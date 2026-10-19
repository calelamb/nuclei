"""AST mutation baseline: the no-LLM mutator (PRD 14 spec 6.5).

``mutate`` applies 1..``max_ops`` small, syntax-preserving edits to statements
that lie *fully inside* the marked evolve region. Everything outside the region
stays byte-identical: edits are line-level splices (positions come from the
AST, text comes from the original lines); the file is never re-rendered with
``ast.unparse``. Output is deterministic per seed and always ``ast.parse``-able
(every accepted edit is re-parsed and checked against the untouched prefix and
suffix before it is kept).

Operators: ``perturb_constant``, ``swap_statements``, ``duplicate_statement``,
``delete_statement``, ``swap_gate_method`` and ``change_index``.
"""

from __future__ import annotations

import ast
import random
from dataclasses import dataclass
from typing import Callable

DEFAULT_START_MARKER = "# EVOLVE-BLOCK-START"
DEFAULT_END_MARKER = "# EVOLVE-BLOCK-END"
ATTEMPTS_PER_MUTATION = 8
INT_LOW, INT_HIGH = 0, 64

_METHOD_GROUPS = (
    ("h", "x", "y", "z", "s", "sdg", "t", "tdg", "sx"),
    ("rx", "ry", "rz"),
    ("cx", "cz", "cy"),
    ("rxx", "ryy", "rzz"),
)
_STIM_SWAPS = {"CX": "CZ", "CZ": "CX", "H": "SQRT_X", "SQRT_X": "H"}
_STIM_APPEND_NAMES = ("append", "append_operation")
_NOT_DUPLICABLE = (
    ast.Return, ast.Break, ast.Continue, ast.Raise, ast.FunctionDef, ast.AsyncFunctionDef,
    ast.ClassDef, ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal,
)


class MutationError(ValueError):
    """The program/markers cannot be mutated (bad markers or unparseable source)."""


@dataclass
class _Ctx:
    lines: list[str]
    first: int  # first region line (0-based, inclusive)
    last: int  # last region line (0-based, inclusive)
    tree: ast.Module
    stmts: list[ast.stmt]  # statements fully inside the region
    siblings: list[list[ast.stmt]]  # statement lists (bodies) of the whole tree
    fstring_nodes: set[int]

    def in_region(self, node: ast.AST) -> bool:
        return self.first <= node.lineno - 1 and node.end_lineno - 1 <= self.last


Outcome = tuple[list[str], str] | None


# --- analysis ----------------------------------------------------------------


def _find_region(lines: list[str], start_marker: str, end_marker: str) -> tuple[int, int]:
    starts = [i for i, ln in enumerate(lines) if ln.strip().startswith(start_marker.strip())]
    ends = [i for i, ln in enumerate(lines) if ln.strip().startswith(end_marker.strip())]
    if not starts and not ends:
        return 0, len(lines) - 1
    if not starts or not ends:
        raise MutationError("Only one of the evolve markers was found; both are required.")
    start = starts[0]
    end = next((e for e in ends if e > start), None)
    if end is None:
        raise MutationError("The end marker must come after the start marker.")
    return start + 1, end - 1


def _stmt_start(node: ast.stmt) -> int:
    decorators = getattr(node, "decorator_list", [])
    return min([node.lineno, *[d.lineno for d in decorators]]) - 1


def _char_col(line: str, byte_col: int) -> int:
    return len(line.encode("utf-8")[:byte_col].decode("utf-8", errors="ignore"))


def _analyze(text: str, start_marker: str, end_marker: str) -> _Ctx:
    lines = text.splitlines(keepends=True) or [""]
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError) as exc:
        raise MutationError(f"Program does not parse: {exc}") from exc
    first, last = _find_region(lines, start_marker, end_marker)
    siblings: list[list[ast.stmt]] = []
    fstring_nodes: set[int] = set()
    for node in ast.walk(tree):
        for field in ("body", "orelse", "finalbody"):
            block = getattr(node, field, None)
            if isinstance(block, list) and block and isinstance(block[0], ast.stmt):
                siblings.append(block)
        if isinstance(node, ast.JoinedStr):
            fstring_nodes.update(id(inner) for inner in ast.walk(node))
    ctx = _Ctx(lines, first, last, tree, [], siblings, fstring_nodes)
    ctx.stmts = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.stmt) and _stmt_start(n) >= first and n.end_lineno - 1 <= last
    ]
    return ctx


def _clean(ctx: _Ctx, node: ast.stmt) -> bool:
    """The statement owns its lines: nothing else precedes it or follows it (except a comment)."""
    first_line = ctx.lines[_stmt_start(node)]
    if _stmt_start(node) == node.lineno - 1:
        if first_line[:_char_col(first_line, node.col_offset)].strip():
            return False
    last_line = ctx.lines[node.end_lineno - 1]
    rest = last_line[_char_col(last_line, node.end_col_offset):].strip()
    return rest == "" or rest.startswith("#")


def _indent(ctx: _Ctx, node: ast.stmt) -> str:
    line = ctx.lines[_stmt_start(node)]
    return line[: len(line) - len(line.lstrip())]


def _eol(line: str) -> str:
    return "\r\n" if line.endswith("\r\n") else "\n"


def _replace_span(ctx: _Ctx, node: ast.AST, new_text: str) -> list[str]:
    """Replace a single-line node's source text."""
    index = node.lineno - 1
    line = ctx.lines[index]
    start = _char_col(line, node.col_offset)
    end = _char_col(line, node.end_col_offset)
    lines = list(ctx.lines)
    lines[index] = line[:start] + new_text + line[end:]
    return lines


def _single_line_in_region(ctx: _Ctx, node: ast.AST) -> bool:
    return (
        ctx.in_region(node)
        and node.lineno == node.end_lineno
        and id(node) not in ctx.fstring_nodes
    )


# --- operators ---------------------------------------------------------------


def _format_float(value: float) -> str:
    text = format(value, ".6g")
    return text if any(c in text for c in ".en") else text + ".0"


def op_perturb_constant(ctx: _Ctx, rng: random.Random) -> Outcome:
    candidates = []
    for stmt in ctx.stmts:
        for node in ast.walk(stmt):
            if (
                isinstance(node, ast.Constant)
                and type(node.value) in (int, float)
                and _single_line_in_region(ctx, node)
                and (type(node.value) is float and node.value != 0.0 or type(node.value) is int and INT_LOW <= node.value <= INT_HIGH)
            ):
                candidates.append(node)
    candidates = _unique(candidates)
    if not candidates:
        return None
    node = rng.choice(candidates)
    old = node.value
    if type(old) is float:
        new_value = old * rng.uniform(0.5, 1.5)
        new_text = _format_float(new_value)
    else:
        step = rng.choice((-1, 1))
        new_value = min(INT_HIGH, max(INT_LOW, old + step))
        if new_value == old:
            new_value = old - step
        new_text = str(new_value)
    return _replace_span(ctx, node, new_text), f"perturb_constant: {old!r} -> {new_text} (line {node.lineno})"


def _unique(nodes: list[ast.AST]) -> list[ast.AST]:
    seen: set[tuple] = set()
    out = []
    for node in nodes:
        key = (node.lineno, node.col_offset, node.end_col_offset)
        if key not in seen:
            seen.add(key)
            out.append(node)
    return out


def _region_pairs(ctx: _Ctx) -> list[tuple[ast.stmt, ast.stmt]]:
    inside = {id(s) for s in ctx.stmts}
    pairs = []
    for block in ctx.siblings:
        for a, b in zip(block, block[1:]):
            if id(a) in inside and id(b) in inside and a.end_lineno - 1 < _stmt_start(b) and _clean(ctx, a) and _clean(ctx, b):
                pairs.append((a, b))
    return pairs


def op_swap_statements(ctx: _Ctx, rng: random.Random) -> Outcome:
    pairs = _region_pairs(ctx)
    if not pairs:
        return None
    a, b = rng.choice(pairs)
    a0, a1, b0, b1 = _stmt_start(a), a.end_lineno, _stmt_start(b), b.end_lineno
    seg_a, gap, seg_b = ctx.lines[a0:a1], ctx.lines[a1:b0], ctx.lines[b0:b1]
    lines = ctx.lines[:a0] + seg_b + gap + seg_a + ctx.lines[b1:]
    return lines, f"swap_statements: lines {a0 + 1} and {b0 + 1}"


def op_duplicate_statement(ctx: _Ctx, rng: random.Random) -> Outcome:
    candidates = [
        s for s in ctx.stmts
        if not isinstance(s, _NOT_DUPLICABLE)
        and not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant))
        and _clean(ctx, s)
    ]
    if not candidates:
        return None
    node = rng.choice(candidates)
    start, end = _stmt_start(node), node.end_lineno
    block = list(ctx.lines[start:end])
    if not block[-1].endswith(("\n", "\r")):
        block[-1] += "\n"
    lines = ctx.lines[:end] + block + ctx.lines[end:]
    return lines, f"duplicate_statement: line {start + 1}"


def op_delete_statement(ctx: _Ctx, rng: random.Random) -> Outcome:
    owner: dict[int, list[ast.stmt]] = {}
    for block in ctx.siblings:
        for stmt in block:
            owner[id(stmt)] = block
    candidates = [
        s for s in ctx.stmts
        if _clean(ctx, s) and not (len(owner.get(id(s), [s])) == 1 and isinstance(s, ast.Pass))
    ]
    if not candidates:
        return None
    node = rng.choice(candidates)
    start, end = _stmt_start(node), node.end_lineno
    if len(owner.get(id(node), [node])) == 1:
        replacement = [_indent(ctx, node) + "pass" + _eol(ctx.lines[end - 1])]
        verb = "replaced with pass"
    else:
        replacement = []
        verb = "deleted"
    return ctx.lines[:start] + replacement + ctx.lines[end:], f"delete_statement: line {start + 1} {verb}"


def _method_swap_candidates(ctx: _Ctx) -> list[tuple[ast.AST, str, list[str]]]:
    out = []
    for stmt in ctx.stmts:
        for node in ast.walk(stmt):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
                continue
            attr = node.func
            for group in _METHOD_GROUPS:
                if attr.attr in group and ctx.first <= attr.end_lineno - 1 <= ctx.last:
                    out.append((attr, "method", [g for g in group if g != attr.attr]))
            if (
                attr.attr in _STIM_APPEND_NAMES
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
                and node.args[0].value in _STIM_SWAPS
                and _single_line_in_region(ctx, node.args[0])
            ):
                out.append((node.args[0], "stim", [_STIM_SWAPS[node.args[0].value]]))
    return out


def op_swap_gate_method(ctx: _Ctx, rng: random.Random) -> Outcome:
    candidates = _method_swap_candidates(ctx)
    if not candidates:
        return None
    node, kind, options = rng.choice(candidates)
    new = rng.choice(options)
    lines = list(ctx.lines)
    if kind == "stim":
        index = node.lineno - 1
        line = ctx.lines[index]
        start, end = _char_col(line, node.col_offset), _char_col(line, node.end_col_offset)
        segment = line[start:end]
        if ast.literal_eval(segment) != node.value:
            return None
        lines[index] = line[:start] + segment.replace(node.value, new, 1) + line[end:]
        return lines, f"swap_gate_method: {node.value!r} -> {new!r} (line {node.lineno})"
    index = node.end_lineno - 1
    line = ctx.lines[index]
    end = _char_col(line, node.end_col_offset)
    start = end - len(node.attr)
    if start < 0 or line[start:end] != node.attr:
        return None
    lines[index] = line[:start] + new + line[end:]
    return lines, f"swap_gate_method: .{node.attr} -> .{new} (line {node.end_lineno})"


def _index_constants(ctx: _Ctx) -> list[ast.Constant]:
    found: list[ast.Constant] = []

    def take(root: ast.AST) -> None:
        for inner in ast.walk(root):
            if (
                isinstance(inner, ast.Constant)
                and type(inner.value) is int
                and inner.value >= 0
                and _single_line_in_region(ctx, inner)
            ):
                found.append(inner)

    for stmt in ctx.stmts:
        for node in ast.walk(stmt):
            if isinstance(node, ast.Subscript):
                take(node.slice)
            elif isinstance(node, ast.Call):
                for arg in [*node.args, *[k.value for k in node.keywords]]:
                    take(arg)
    return _unique(found)


def op_change_index(ctx: _Ctx, rng: random.Random) -> Outcome:
    candidates = _index_constants(ctx)
    if not candidates:
        return None
    node = rng.choice(candidates)
    new = node.value + 1 if node.value == 0 else node.value + rng.choice((-1, 1))
    return _replace_span(ctx, node, str(new)), f"change_index: {node.value} -> {new} (line {node.lineno})"


OPERATORS: dict[str, Callable[[_Ctx, random.Random], Outcome]] = {
    "perturb_constant": op_perturb_constant,
    "swap_statements": op_swap_statements,
    "duplicate_statement": op_duplicate_statement,
    "delete_statement": op_delete_statement,
    "swap_gate_method": op_swap_gate_method,
    "change_index": op_change_index,
}


# --- driver ------------------------------------------------------------------


def _outside_identical(old: list[str], new: list[str], first: int, last: int) -> bool:
    tail = len(old) - last - 1
    return new[:first] == old[:first] and (tail == 0 or new[len(new) - tail:] == old[last + 1:])


def _apply_one(text: str, markers: tuple[str, str], rng: random.Random) -> tuple[str, str, str] | None:
    ctx = _analyze(text, *markers)
    names = list(OPERATORS)
    rng.shuffle(names)
    for name in names:
        outcome = OPERATORS[name](ctx, rng)
        if outcome is None:
            continue
        lines, description = outcome
        new_text = "".join(lines)
        if not _outside_identical(ctx.lines, lines, ctx.first, ctx.last):
            continue
        try:
            ast.parse(new_text)
        except (SyntaxError, ValueError):
            continue
        return new_text, name, description
    return None


def mutate(
    program: str,
    *,
    start_marker: str | None = None,
    end_marker: str | None = None,
    seed: int,
    count: int,
    max_ops: int = 3,
) -> list[dict]:
    """Up to ``count`` distinct mutants of ``program`` (see module docstring)."""
    if count < 1 or max_ops < 1:
        raise MutationError("count and max_ops must be >= 1")
    markers = (start_marker or DEFAULT_START_MARKER, end_marker or DEFAULT_END_MARKER)
    # A missing final newline would let swapped lines fuse; work with one and strip it after.
    added_newline = bool(program) and not program.endswith(("\n", "\r"))
    work = program + "\n" if added_newline else program
    _analyze(work, *markers)  # validates markers and syntax up front
    results: list[dict] = []
    seen = {work}
    for attempt in range(count * ATTEMPTS_PER_MUTATION):
        if len(results) >= count:
            break
        rng = random.Random(f"nuclei-mutate:{seed}:{attempt}")
        text, operators, descriptions = work, [], []
        for _ in range(rng.randint(1, max_ops)):
            step = _apply_one(text, markers, rng)
            if step is None:
                break
            text, name, description = step
            operators.append(name)
            descriptions.append(description)
        if operators and text not in seen:
            seen.add(text)
            output = text[:-1] if added_newline and text.endswith("\n") else text
            results.append({"program": output, "operators": operators, "description": "; ".join(descriptions)})
    return results
