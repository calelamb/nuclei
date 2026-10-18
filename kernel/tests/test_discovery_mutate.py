"""AST mutation baseline: region preservation, determinism, parseability, operators."""

from __future__ import annotations

import ast
import random

import pytest

from kernel.discovery.mutate import (
    DEFAULT_END_MARKER,
    DEFAULT_START_MARKER,
    OPERATORS,
    MutationError,
    _analyze,
    mutate,
)
from kernel.discovery.seeds.qec_repetition import build  # noqa: F401  (import check)

SEED_PATH = "kernel/discovery/seeds/qec_repetition.py"

QISKIT_PROGRAM = '''\
"""Header docstring with 3 numbers 7."""
import math
from qiskit import QuantumCircuit

SCALE = 0.25  # outside the region: must never change

def build(n_qubits):
    qc = QuantumCircuit(n_qubits)
    # EVOLVE-BLOCK-START
    qc.h(0)
    for i in range(n_qubits - 1):
        qc.cx(i, i + 1)
    qc.rz(0.5, 1)
    qc.rx(1.25, 0)
    x = [1, 2, 3]
    qc.ry(0.3, x[1])
    # EVOLVE-BLOCK-END
    qc.measure_all()
    return qc

if __name__ == "__main__":
    print(build(3), 99)
'''


def region(text: str) -> tuple[str, str, str]:
    start = text.index(DEFAULT_START_MARKER)
    after_start = text.index("\n", start) + 1
    end = text.index(DEFAULT_END_MARKER)
    line_start = text.rindex("\n", 0, end) + 1
    return text[:after_start], text[after_start:line_start], text[line_start:]


@pytest.fixture(scope="module")
def seed_program() -> str:
    with open(SEED_PATH, encoding="utf-8") as handle:
        return handle.read()


def test_region_is_preserved_byte_for_byte_across_many_seeds(seed_program):
    for program in (QISKIT_PROGRAM, seed_program):
        head, _, tail = region(program)
        produced = 0
        for seed in range(60):
            for item in mutate(program, seed=seed, count=4):
                produced += 1
                new_head, _, new_tail = region(item["program"])
                assert new_head == head and new_tail == tail
                ast.parse(item["program"])
                assert item["program"] != program
        assert produced > 100


def test_deterministic_per_seed_and_differs_across_seeds():
    a = mutate(QISKIT_PROGRAM, seed=11, count=5)
    b = mutate(QISKIT_PROGRAM, seed=11, count=5)
    c = mutate(QISKIT_PROGRAM, seed=12, count=5)
    assert a == b
    assert [m["program"] for m in a] != [m["program"] for m in c]


def test_results_are_unique_and_described():
    items = mutate(QISKIT_PROGRAM, seed=3, count=8)
    assert len({m["program"] for m in items}) == len(items) > 3
    for item in items:
        assert item["operators"] and set(item["operators"]) <= set(OPERATORS)
        assert len(item["operators"]) <= 3
        assert item["description"].count(";") == len(item["operators"]) - 1


def test_max_ops_is_respected():
    for item in mutate(QISKIT_PROGRAM, seed=5, count=10, max_ops=1):
        assert len(item["operators"]) == 1


def test_never_calls_unparse_on_the_file_formatting_is_untouched():
    odd = QISKIT_PROGRAM.replace("def build(n_qubits):", "def build( n_qubits ):").replace("SCALE = 0.25", "SCALE   =   0.25")
    for item in mutate(odd, seed=2, count=6):
        assert "def build( n_qubits ):" in item["program"] and "SCALE   =   0.25" in item["program"]


def apply(name: str, program: str, seed: int = 0):
    ctx = _analyze(program, DEFAULT_START_MARKER, DEFAULT_END_MARKER)
    outcome = OPERATORS[name](ctx, random.Random(seed))
    assert outcome is not None, name
    lines, description = outcome
    return "".join(lines), description


@pytest.mark.parametrize("seed", range(5))
def test_perturb_constant_ranges(seed):
    new, description = apply("perturb_constant", QISKIT_PROGRAM, seed)
    assert description.startswith("perturb_constant")
    ast.parse(new)
    old_lines, new_lines = QISKIT_PROGRAM.splitlines(), new.splitlines()
    changed = [(o, n) for o, n in zip(old_lines, new_lines) if o != n]
    assert len(old_lines) == len(new_lines) and len(changed) == 1
    new_value = description.split("->")[1].split("(")[0].strip()
    value = ast.literal_eval(new_value)
    if isinstance(value, int):
        assert 0 <= value <= 64


def test_perturb_float_scales_within_half_to_one_and_a_half():
    program = "# EVOLVE-BLOCK-START\nx = 2.0\n# EVOLVE-BLOCK-END\n"
    for seed in range(40):
        new, _ = apply("perturb_constant", program, seed)
        value = ast.literal_eval(new.splitlines()[1].split("=")[1].strip())
        assert 1.0 <= value <= 3.0 and isinstance(value, float)


def test_perturb_int_steps_by_one_and_clamps():
    program = "# EVOLVE-BLOCK-START\nx = 64\ny = 0\n# EVOLVE-BLOCK-END\n"
    seen = set()
    for seed in range(40):
        new, _ = apply("perturb_constant", program, seed)
        x, y = (int(line.split("=")[1]) for line in new.splitlines()[1:3])
        assert 0 <= x <= 64 and 0 <= y <= 64
        seen.add((x, y))
    assert (63, 0) in seen and (64, 1) in seen
    assert not any(x > 64 or y < 0 for x, y in seen)


def test_swap_statements_swaps_adjacent_pair_in_same_block():
    program = "# EVOLVE-BLOCK-START\na = 1\nb = 2\nc = 3\n# EVOLVE-BLOCK-END\n"
    results = {apply("swap_statements", program, seed)[0] for seed in range(20)}
    assert "# EVOLVE-BLOCK-START\nb = 2\na = 1\nc = 3\n# EVOLVE-BLOCK-END\n" in results
    assert "# EVOLVE-BLOCK-START\na = 1\nc = 3\nb = 2\n# EVOLVE-BLOCK-END\n" in results


def test_swap_statements_keeps_comments_between_in_place():
    program = "# EVOLVE-BLOCK-START\na = 1\n# note\nb = 2\n# EVOLVE-BLOCK-END\n"
    new, _ = apply("swap_statements", program)
    assert new == "# EVOLVE-BLOCK-START\nb = 2\n# note\na = 1\n# EVOLVE-BLOCK-END\n"


def test_duplicate_statement_copies_with_same_indent():
    program = "def f():\n    # EVOLVE-BLOCK-START\n    qc.h(0)\n    # EVOLVE-BLOCK-END\n    return 1\n"
    new, _ = apply("duplicate_statement", program)
    assert new == "def f():\n    # EVOLVE-BLOCK-START\n    qc.h(0)\n    qc.h(0)\n    # EVOLVE-BLOCK-END\n    return 1\n"


def test_delete_statement_never_empties_a_block():
    program = "def f():\n    # EVOLVE-BLOCK-START\n    qc.h(0)\n    # EVOLVE-BLOCK-END\n"
    new, description = apply("delete_statement", program)
    assert "    pass\n" in new and "replaced with pass" in description
    ast.parse(new)
    inner = "# EVOLVE-BLOCK-START\nfor i in range(3):\n    qc.h(i)\n# EVOLVE-BLOCK-END\n"
    for seed in range(20):
        ast.parse(apply("delete_statement", inner, seed)[0])


def test_delete_with_outside_siblings_just_removes():
    program = "def f():\n    keep = 1\n    # EVOLVE-BLOCK-START\n    qc.h(0)\n    # EVOLVE-BLOCK-END\n    return keep\n"
    new, description = apply("delete_statement", program)
    assert "qc.h(0)" not in new and "pass" not in new and "deleted" in description


@pytest.mark.parametrize(
    "src,expected",
    [("qc.h(0)", {"x", "y", "z", "s", "sdg", "t", "tdg", "sx"}), ("qc.rx(0.1, 0)", {"ry", "rz"}),
     ("qc.cx(0, 1)", {"cz", "cy"}), ("qc.rzz(0.1, 0, 1)", {"rxx", "ryy"})],
)
def test_swap_gate_method_groups(src, expected):
    program = f"# EVOLVE-BLOCK-START\n{src}\n# EVOLVE-BLOCK-END\n"
    outcomes = set()
    for seed in range(60):
        new, _ = apply("swap_gate_method", program, seed)
        outcomes.add(new.splitlines()[1].split("(")[0].split(".")[1])
    assert outcomes == expected


def test_swap_gate_method_stim_string_literals():
    program = '# EVOLVE-BLOCK-START\nc.append("CX", [0, 1])\nc.append("H", [0])\n# EVOLVE-BLOCK-END\n'
    outcomes = {apply("swap_gate_method", program, seed)[0] for seed in range(30)}
    assert 'c.append("CZ", [0, 1])\nc.append("H", [0])' in "".join(outcomes)
    assert 'c.append("CX", [0, 1])\nc.append("SQRT_X", [0])' in "".join(outcomes)


def test_change_index_only_touches_subscripts_and_call_args():
    program = "# EVOLVE-BLOCK-START\nx = 5\nqc.h(2)\ny = data[1]\n# EVOLVE-BLOCK-END\n"
    outcomes = {apply("change_index", program, seed)[0] for seed in range(40)}
    assert all("x = 5" in o for o in outcomes)
    assert any("qc.h(1)" in o or "qc.h(3)" in o for o in outcomes)
    assert any("data[0]" in o or "data[2]" in o for o in outcomes)
    zero = "# EVOLVE-BLOCK-START\nqc.h(0)\n# EVOLVE-BLOCK-END\n"
    assert {apply("change_index", zero, s)[0] for s in range(10)} == {"# EVOLVE-BLOCK-START\nqc.h(1)\n# EVOLVE-BLOCK-END\n"}


def test_statements_straddling_the_markers_are_never_touched():
    program = (
        "for i in range(7):\n    # EVOLVE-BLOCK-START\n    qc.h(1)\n    # EVOLVE-BLOCK-END\n    qc.h(2)\n"
    )
    for item in mutate(program, seed=1, count=10):
        assert item["program"].startswith("for i in range(7):\n    # EVOLVE-BLOCK-START\n")
        assert item["program"].endswith("    # EVOLVE-BLOCK-END\n    qc.h(2)\n")


def test_no_markers_means_whole_file_is_the_region():
    items = mutate("qc.h(0)\nqc.cx(0, 1)\n", seed=1, count=5)
    assert items and all("qc" in i["program"] for i in items)


def test_missing_final_newline_is_preserved():
    program = "a = 1\nb = 2"
    for item in mutate(program, seed=1, count=6):
        assert not item["program"].endswith("\n")
        ast.parse(item["program"])


def test_custom_markers():
    program = "x = 1\n#<<\ny = 2\n#>>\nz = 3\n"
    items = mutate(program, start_marker="#<<", end_marker="#>>", seed=1, count=5)
    assert items
    for item in items:
        assert item["program"].startswith("x = 1\n#<<\n") and item["program"].endswith("#>>\nz = 3\n")


def test_marker_errors():
    with pytest.raises(MutationError):
        mutate("# EVOLVE-BLOCK-START\nx = 1\n", seed=1, count=1)
    with pytest.raises(MutationError):
        mutate("# EVOLVE-BLOCK-END\nx = 1\n# EVOLVE-BLOCK-START\n", seed=1, count=1)
    with pytest.raises(MutationError):
        mutate("def f(:\n", seed=1, count=1)
    with pytest.raises(MutationError):
        mutate("x = 1\n", seed=1, count=0)


def test_empty_region_yields_nothing():
    assert mutate("# EVOLVE-BLOCK-START\n# EVOLVE-BLOCK-END\nx = 1\n", seed=1, count=3) == []


def test_unicode_before_a_constant_does_not_misplace_edits():
    program = '# EVOLVE-BLOCK-START\nlabel = "héllo wörld"; v = 2.0\n# EVOLVE-BLOCK-END\n'
    for item in mutate(program, seed=4, count=6):
        ast.parse(item["program"])
        assert "héllo wörld" in item["program"]


def test_seed_program_mutants_still_build_a_circuit(seed_program):
    """Parseable is the contract; most mutants of the seed should still execute."""
    import stim

    ran = 0
    for item in mutate(seed_program, seed=9, count=12):
        namespace: dict = {}
        exec(compile(item["program"], "<mutant>", "exec"), namespace)
        try:
            assert isinstance(namespace["build"](3, 3), stim.Circuit)
            ran += 1
        except Exception:
            pass
    assert ran >= 4
