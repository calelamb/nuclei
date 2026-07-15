"""Tests for Executor.lint / format_code — the editor's ruff-backed diagnostics
and formatting (dev tools Phase 4).

Guarded so a kernel test env without ruff still passes (lint degrades to no
diagnostics; format is skipped).
"""

import shutil
import subprocess
import sys

import pytest

from kernel.executor import Executor


def _ruff_available() -> bool:
    if shutil.which("ruff"):
        return True
    try:
        subprocess.run([sys.executable, "-m", "ruff", "--version"], capture_output=True, timeout=5)
        return True
    except Exception:
        return False


RUFF = _ruff_available()
needs_ruff = pytest.mark.skipif(not RUFF, reason="ruff not installed in this env")


@needs_ruff
def test_lint_flags_an_unused_import() -> None:
    diagnostics, error = Executor().lint("import os\nx = 1\n")
    assert error is None
    codes = {d["code"] for d in diagnostics}
    assert "F401" in codes  # unused import
    unused = next(d for d in diagnostics if d["code"] == "F401")
    assert unused["line"] == 1
    assert unused["severity"] == "warning"
    assert "os" in unused["message"]


@needs_ruff
def test_lint_clean_code_returns_no_diagnostics() -> None:
    diagnostics, error = Executor().lint("x = 1\nprint(x)\n")
    assert error is None
    assert diagnostics == []


def test_lint_skips_qsharp() -> None:
    # No ruff needed — Q# is short-circuited before any subprocess.
    diagnostics, error = Executor().lint("operation Main() : Unit { }", language="qsharp")
    assert error is None
    assert diagnostics == []


@needs_ruff
def test_format_reformats_and_is_idempotent() -> None:
    ex = Executor()
    formatted, error = ex.format_code("x=1\ndef f( a ):\n  return  a\n")
    assert error is None
    assert formatted is not None
    assert "x = 1" in formatted
    assert "def f(a):" in formatted
    # Formatting already-formatted code is a no-op.
    again, error2 = ex.format_code(formatted)
    assert error2 is None
    assert again == formatted


def test_format_rejects_qsharp() -> None:
    formatted, error = Executor().format_code("operation Main() : Unit { }", language="qsharp")
    assert formatted is None
    assert error is not None
    assert error.code == "format_unsupported"
