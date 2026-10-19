"""The static AST pre-screen for candidate programs (PRD 15 R-19)."""

from __future__ import annotations

import glob
import os

import pytest

from kernel.discovery import isolation as iso
from kernel.discovery.prescreen import first_rejection_message, prescreen
from kernel.discovery.sandbox import ERR_PRESCREEN, prescreen_response, run_candidate

PROCESS = iso.IsolationInfo(iso.MODE_PROCESS)
LANDLOCKED = iso.IsolationInfo(iso.MODE_LANDLOCK)


def rules(source: str) -> set[str]:
    return {finding.rule for finding in prescreen(source)}


# ----------------------------------------------------------------------------- what is rejected


@pytest.mark.parametrize(
    "source,rule",
    [
        ("__import__('os').remove('x')", "dunder_import"),
        ("import builtins\nbuiltins.__import__('os')", "dunder_import"),
        ("from builtins import __import__", "dunder_import"),
        ("eval('1 + 1')", "dynamic_code"),
        ("exec('import os')", "dynamic_code"),
        ("code = compile('1', '<x>', 'eval')", "dynamic_code"),
        ("import builtins\nbuiltins.exec('1')", "dynamic_code"),
        ("import importlib", "importlib"),
        ("from importlib import import_module", "importlib"),
        ("import importlib as il\nil.import_module('os')", "importlib"),
        ("import shutil\nshutil.rmtree('/tmp/x')", "shutil"),
        ("from shutil import rmtree\nrmtree('/tmp/x')", "shutil"),
        ("import shutil as sh\nsh.copy('a', 'b')", "shutil"),
        ("open('f', 'w')", "open_write"),
        ("open('f', 'a')", "open_write"),
        ("open('f', 'x')", "open_write"),
        ("open('f', 'r+')", "open_write"),
        ("open('f', mode='wb')", "open_write"),
        ("import io\nio.open('f', 'w')", "open_write"),
        ("from pathlib import Path\nPath('f').open('w')", "open_write"),
        ("open('f', 'r' + 'w')", "open_write"),
        ("def f(mode):\n    return open('f', mode)", "open_dynamic_mode"),
        ("import os\nos.open('f', os.O_WRONLY)", "os_open"),
        ("from os import open", "os_open"),
        ("import os\nos.remove('f')", "file_removal"),
        ("import os\nos.unlink('f')", "file_removal"),
        ("import os\nos.rmdir('d')", "file_removal"),
        ("import os as o\no.remove('f')", "file_removal"),
        ("from os import remove", "file_removal"),
        ("from os import *", "file_removal"),
        ("from pathlib import Path\nPath('f').unlink()", "file_removal"),
        ("from pathlib import Path\nPath('d').rmdir()", "file_removal"),
        ("from pathlib import Path\nPath('f').write_text('x')", "file_removal"),
        ("from pathlib import Path\nPath('f').write_bytes(b'x')", "file_removal"),
        ("import os\ngetattr(os, 'remove')('f')", "blocked_getattr"),
        ("import os\ngetattr(os, 'unl' + 'ink')('f')", "blocked_getattr"),
        ("getattr(__builtins__, 'eval')", "introspection"),
        ("import os\nvars(os)['remove']('f')", "blocked_getattr"),
        ("().__class__.__bases__[0].__subclasses__()", "introspection"),
        ("def f():\n    pass\nf.__globals__['os']", "introspection"),
    ],
)
def test_rejects(source, rule):
    assert rule in rules(source)


def test_findings_carry_the_line_and_a_readable_message():
    findings = prescreen("import math\n\nimport shutil\nshutil.rmtree('/tmp/x')\n")
    assert [f.line for f in findings] == [3, 4]
    assert first_rejection_message(findings).startswith("prescreen: shutil at line 3:")
    assert "(+1 more)" in first_rejection_message(findings)


# --------------------------------------------------------------------- what must keep working


@pytest.mark.parametrize(
    "source",
    [
        "import re\nre.compile('a+')",
        "values = [1, 2, 3]\nvalues.remove(2)",
        "text = 'a-b'.replace('-', '_')",
        "open('data.txt')",
        "open('data.txt', 'r')",
        "open('data.txt', 'rb')",
        "import os\nos.path.join('a', 'b')\nos.getcwd()",
        "import os\nos.makedirs('d', exist_ok=True) if False else None",
        "import math\nimport numpy as np\nnp.zeros(3)",
        "import stim\ndef build():\n    return stim.Circuit('H 0')",
        "getattr(obj, 'shape', None)",
        "getattr(obj, name)",
        "d = {'remove': 1}\nd.get('keep')",
        "evaluate = 1\nexecutor = 2",
    ],
)
def test_accepts_ordinary_code(source):
    assert prescreen(source) == []


def test_syntax_errors_are_left_to_the_worker():
    assert prescreen("def broken(:\n") == []


def test_every_shipped_seed_program_passes():
    seeds = glob.glob(os.path.join(os.path.dirname(__file__), "..", "discovery", "seeds", "*.py"))
    assert seeds, "expected seed programs next to the discovery package"
    for path in seeds:
        with open(path, encoding="utf-8") as handle:
            assert prescreen(handle.read()) == [], path


# ------------------------------------------------------------------------ when the screen applies


def test_applies_on_process_tier_and_to_untrusted_origins_at_any_tier():
    hostile = "import shutil\nshutil.rmtree('/tmp/nope')\n"
    assert prescreen_response(hostile, PROCESS, "user")["error"]["code"] == ERR_PRESCREEN
    assert prescreen_response(hostile, PROCESS, None)["error"]["code"] == ERR_PRESCREEN
    assert prescreen_response(hostile, LANDLOCKED, "claude")["error"]["code"] == ERR_PRESCREEN
    assert prescreen_response(hostile, LANDLOCKED, "user") is None
    assert prescreen_response(hostile, LANDLOCKED, None) is None
    assert prescreen_response("x = 1\n", PROCESS, "claude") is None


def test_the_rejection_response_is_a_normal_sandbox_error_with_honest_detail():
    response = prescreen_response("open('f', 'w')", PROCESS, "claude")
    assert response["status"] == "error" and response["artifacts"] == []
    assert response["error"]["message"].startswith("prescreen: open_write")
    assert response["error"]["rules"] == ["open_write"]
    assert response["isolation"] == "process"
    assert response["isolation_detail"] == {"reads": "unrestricted", "writes": "unrestricted", "network": "unrestricted"}


def test_run_candidate_never_starts_a_worker_for_a_rejected_candidate(tmp_path):
    victim = tmp_path / "victim"
    victim.mkdir()
    (victim / "keep.txt").write_text("important")
    program = f"import shutil\ndef build():\n    shutil.rmtree({str(victim)!r})\n"
    request = {
        "protocol_version": 1, "task": "stim_circuit", "program": program, "entry": "build",
        "calls": [{"args": [], "kwargs": {}}], "cpu_seconds": 10,
    }
    response = run_candidate(request, wall_seconds=30, isolation=PROCESS, origin="claude")
    assert response["error"]["code"] == ERR_PRESCREEN
    assert (victim / "keep.txt").read_text() == "important"
