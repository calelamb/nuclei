"""Regression tests for the PRD 14 red-team findings (response forging, escapes, floods)."""

from __future__ import annotations

import json
import os
import time

import pytest

pytest.importorskip("stim")

from kernel.discovery import isolation as iso  # noqa: E402
from kernel.discovery.sandbox import default_request, run_candidate  # noqa: E402

PROCESS = iso.IsolationInfo(iso.MODE_PROCESS)


def run(program: str, *, wall=60, cpu=10, task="stim_circuit", info=PROCESS, calls=None):
    request = default_request(task, program, "build", calls or [{"args": [], "kwargs": {}}], cpu)
    return run_candidate(request, wall_seconds=wall, isolation=info)


def code(response) -> str | None:
    return (response.get("error") or {}).get("code")


FORGED = (
    '{"protocol_version":1,"status":"ok","artifacts":[{"call_index":0,"artifact":'
    '{"circuit_text":"ARBITRARY_UNVALIDATED_ARTIFACT_FROM_CANDIDATE"}}],'
    '"stdout":"forged","stderr":"","error":null}'
)


def test_candidate_cannot_forge_the_response_on_an_inherited_fd():
    # PoC poc_fd_forge.py (RT-H1): write a forged response to a private fd, then _exit.
    program = (
        "import os\n"
        "for fd in range(3, 32):\n"
        "    try:\n"
        f"        os.write(fd, {FORGED!r}.encode() + b'\\n')\n"
        "    except OSError:\n"
        "        pass\n"
        "os._exit(0)\n"
        "def build():\n    import stim\n    return stim.Circuit('H 0')\n"
    )
    response = run(program)
    assert "ARBITRARY_UNVALIDATED" not in json.dumps(response)
    assert response["status"] == "error"


def test_forged_artifact_over_any_channel_is_revalidated():
    # Whatever the candidate smuggles, a non-circuit artifact never reaches the scorer.
    program = (
        "import stim\n"
        "def build():\n"
        "    return 'ARBITRARY_UNVALIDATED_ARTIFACT_FROM_CANDIDATE'\n"
    )
    assert code(run(program)) == "bad_return_type"


def test_supervisor_rejects_trailing_data_after_the_response():
    from kernel.discovery.procrun import ProcResult
    from kernel.discovery.sandbox import _interpret

    ok = '{"protocol_version":1,"status":"ok","artifacts":[],"stdout":"","stderr":"","error":null}'
    assert _interpret(ProcResult(stdout=(ok + "\n").encode(), returncode=0), "process")["status"] == "ok"
    for tail in ("\n" + ok, "garbage", "\n{}"):
        response = _interpret(ProcResult(stdout=(ok + tail).encode(), returncode=0), "process")
        assert code(response) == "worker_bad_output", tail
    nan = ok.replace('"artifacts":[]', '"artifacts":NaN')
    assert code(_interpret(ProcResult(stdout=nan.encode(), returncode=0), "process")) == "worker_bad_output"


def test_candidate_that_exits_early_gets_a_coded_error_not_a_success():
    program = "import os\nos._exit(0)\ndef build():\n    pass\n"
    assert code(run(program)) == "candidate_exited"
