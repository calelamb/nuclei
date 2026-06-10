"""Replay every docs-site protocol fixture against the real kernel handler.

The developer docs (docs-site/src/content/docs/kernel-api/) never paste
request/response JSON inline — every protocol example is a fixture file in
docs-site/fixtures/ that this module replays through the REAL
``kernel.server.handle_message`` handler. If the protocol drifts, the docs
build keeps rendering the old JSON but this suite goes red. Docs don't lie.

Fixture forms (see docs-site/fixtures/README.md for the full convention):

- ``NAME.request.json`` + ``NAME.responses.json`` — one request, the exact
  ordered list of response messages it produces.
- ``NAME.session.json`` — ``[{"request": {...}, "responses": [...]}, ...]``
  replayed over a single connection (single Executor, shared job state).
- ``docs-site/fixtures/illustrative/`` — examples that require credentials
  or real hardware; rendered in the docs but **not** replayed here. They are
  listed in docs-site/fixtures/UNTESTED.md.

Matcher: expected values are exact by default; ``"<any>"`` matches anything,
``"<approx:X:TOL>"`` matches a number within TOL of X, ``"<job-id>"`` matches
the id captured from the most recent ``hardware_job_submitted`` response
(and is substituted into later *requests* in session fixtures). Objects must
have exactly the same key set; arrays must match element-wise at the same
length.

Isolation: ``kernel.server`` builds a module-level HardwareManager at import
time, which would auto-reconnect providers from the OS keyring and load
``~/.nuclei/jobs.json``. The import below is therefore guarded with
``NUCLEI_DISABLE_CRED_STORE=1`` and a throwaway ``NUCLEI_DATA_DIR`` (same
pattern as test_server_qsharp_submit.py) so collection can never touch the
developer's real keyring or job store. The autouse ``_isolate`` fixture then
swaps ``server.hardware_manager`` for a fresh, fully isolated manager per
test (tmp-path job store, in-memory credential fallback, simulator
connected — mirroring what server.py does at import), so hardware fixtures
are deterministic and order-independent. ``handle_message`` reads the
``hardware_manager`` global at call time, so monkeypatching the module
attribute is sufficient.

Dependency policy: fixtures whose request code targets a Python framework
(qiskit/cirq/cudaq) are skipped when that framework isn't installed (CI
installs none of them). Q# fixtures are NOT skip-guarded — qdk is a hard
requirement of this suite locally and in CI (kernel-tests.yml installs it).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from unittest import mock

import pytest

with mock.patch.dict(os.environ, {
    "NUCLEI_DISABLE_CRED_STORE": "1",
    "NUCLEI_DATA_DIR": tempfile.mkdtemp(prefix="nuclei-docs-fixtures-"),
}):
    import kernel.server as server

import kernel.hardware.credential_store as credential_store
from kernel.executor import ADAPTER_SPECS
from kernel.hardware.job_store import JobStore
from kernel.hardware.manager import HardwareManager

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = REPO_ROOT / "docs-site" / "fixtures"

SINGLE_FIXTURES = sorted(FIXTURES_DIR.glob("*.request.json"))
SESSION_FIXTURES = sorted(FIXTURES_DIR.glob("*.session.json"))


# ───────────────────────── isolation ─────────────────────────


@pytest.fixture(autouse=True)
def _isolate(monkeypatch, tmp_path):
    """Per-test isolation mirroring kernel/tests/hardware/conftest.py.

    That conftest's autouse fixtures only apply inside the hardware package,
    so this module does its own: force the credential store's in-memory
    fallback (never the real keyring), point NUCLEI_DATA_DIR at tmp_path,
    and replace the module-level ``server.hardware_manager`` with a fresh
    manager whose job store lives under tmp_path. The fresh manager gets
    the simulator connected, exactly like server.py does at import.
    """
    monkeypatch.delenv("NUCLEI_DISABLE_CRED_STORE", raising=False)
    monkeypatch.setenv("NUCLEI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(credential_store, "_keyring_available", lambda: False)
    credential_store.reset_memory_fallback_for_tests()

    manager = HardwareManager(
        auto_reconnect=False,
        job_store=JobStore(path=str(tmp_path / "jobs.json")),
    )
    manager.connect_provider("simulator", {})
    monkeypatch.setattr(server, "hardware_manager", manager)
    yield
    credential_store.reset_memory_fallback_for_tests()


# ───────────────────────── matcher ─────────────────────────

_APPROX = re.compile(r"^<approx:(-?[0-9.eE+]+):([0-9.eE+]+)>$")


def assert_matches(expected, actual, *, captured_job_id=None, path="$"):
    """Assert ``actual`` matches ``expected`` under the fixture conventions.

    - ``"<any>"`` matches any value (including null, objects, arrays).
    - ``"<approx:X:TOL>"`` matches a number within TOL of X.
    - ``"<job-id>"`` matches the captured hardware job id.
    - dicts: exactly the same key set, values matched recursively.
    - lists: same length, element-wise.
    - everything else: strict equality.
    """
    if expected == "<any>":
        return
    if isinstance(expected, str):
        approx = _APPROX.match(expected)
        if approx:
            target, tol = float(approx.group(1)), float(approx.group(2))
            assert isinstance(actual, (int, float)) and not isinstance(actual, bool), (
                f"{path}: expected a number, got {actual!r}"
            )
            assert abs(actual - target) <= tol, (
                f"{path}: {actual} is not within {tol} of {target}"
            )
            return
        if expected == "<job-id>":
            assert captured_job_id is not None, (
                f"{path}: fixture expects <job-id> but no hardware_job_submitted "
                "response has been captured"
            )
            assert actual == captured_job_id, (
                f"{path}: {actual!r} != captured job id {captured_job_id!r}"
            )
            return
    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"{path}: expected object, got {actual!r}"
        assert set(expected) == set(actual), (
            f"{path}: key mismatch — missing {sorted(set(expected) - set(actual))}, "
            f"unexpected {sorted(set(actual) - set(expected))}"
        )
        for key, value in expected.items():
            assert_matches(
                value, actual[key],
                captured_job_id=captured_job_id, path=f"{path}.{key}",
            )
        return
    if isinstance(expected, list):
        assert isinstance(actual, list), f"{path}: expected array, got {actual!r}"
        assert len(expected) == len(actual), (
            f"{path}: expected {len(expected)} elements, got {len(actual)}"
        )
        for i, (exp, act) in enumerate(zip(expected, actual)):
            assert_matches(
                exp, act, captured_job_id=captured_job_id, path=f"{path}[{i}]",
            )
        return
    assert expected == actual, f"{path}: {actual!r} != expected {expected!r}"


# ───────────────────────── fake websocket ─────────────────────────


class FakeWebSocket:
    """In-process stand-in for a websockets server connection.

    ``handle_message`` consumes its socket with ``async for raw in websocket``
    and replies with ``await websocket.send(text)`` (server.py:162-167) — so
    this fake implements exactly that surface: an async iterator yielding
    request JSON strings, and a ``send`` that records parsed responses
    grouped under the request step that triggered them.

    Session support: the id from the most recent ``hardware_job_submitted``
    response is captured, and the literal string ``"<job-id>"`` in any
    *later* request is substituted with it before being handed to the
    handler.
    """

    def __init__(self, requests: list[dict]):
        self._pending = list(requests)
        self.steps: list[list[dict]] = []
        self.captured_job_id: str | None = None

    def __aiter__(self):
        return self

    async def __anext__(self) -> str:
        if not self._pending:
            raise StopAsyncIteration
        request = self._substitute(self._pending.pop(0))
        self.steps.append([])
        return json.dumps(request)

    async def send(self, text: str) -> None:
        message = json.loads(text)
        if message.get("type") == "hardware_job_submitted":
            job_id = message.get("job", {}).get("id")
            if isinstance(job_id, str):
                self.captured_job_id = job_id
        self.steps[-1].append(message)

    def _substitute(self, value):
        if value == "<job-id>":
            if self.captured_job_id is None:
                raise AssertionError(
                    "fixture request uses <job-id> before any "
                    "hardware_job_submitted response"
                )
            return self.captured_job_id
        if isinstance(value, dict):
            return {k: self._substitute(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._substitute(v) for v in value]
        return value


def replay(requests: list[dict]) -> FakeWebSocket:
    websocket = FakeWebSocket(requests)
    asyncio.run(server.handle_message(websocket))
    return websocket


def _skip_unless_framework_deps(requests: list[dict]) -> None:
    """Skip when a fixture targets a Python framework that isn't installed.

    Requirements are derived from the same detection regexes the executor
    uses, so the skip logic can never drift from routing. Q# (source-mode)
    is deliberately not skip-guarded: qdk is a hard requirement of this
    suite (kernel-tests.yml installs it in CI).
    """
    for request in requests:
        code = request.get("code", "")
        for spec in ADAPTER_SPECS:
            if spec.source_mode:
                continue
            if spec.detect_pattern.search(code):
                for dependency in spec.dependencies:
                    pytest.importorskip(dependency)


# ───────────────────────── matcher self-tests ─────────────────────────


def test_matcher_exact_and_any():
    assert_matches({"type": "output", "text": "<any>"}, {"type": "output", "text": "hi"})
    with pytest.raises(AssertionError):
        assert_matches({"type": "output"}, {"type": "stderr"})


def test_matcher_rejects_extra_and_missing_keys():
    with pytest.raises(AssertionError, match="key mismatch"):
        assert_matches({"a": 1}, {"a": 1, "b": 2})
    with pytest.raises(AssertionError, match="key mismatch"):
        assert_matches({"a": 1, "b": 2}, {"a": 1})


def test_matcher_approx():
    assert_matches("<approx:0.5:0.05>", 0.51)
    with pytest.raises(AssertionError):
        assert_matches("<approx:0.5:0.05>", 0.6)
    with pytest.raises(AssertionError):
        assert_matches("<approx:0.5:0.05>", "0.5")


def test_matcher_arrays_same_length():
    assert_matches([1, "<any>"], [1, {"deep": True}])
    with pytest.raises(AssertionError, match="elements"):
        assert_matches([1], [1, 2])


def test_matcher_job_id_capture():
    assert_matches("<job-id>", "abc", captured_job_id="abc")
    with pytest.raises(AssertionError):
        assert_matches("<job-id>", "abc", captured_job_id="xyz")
    with pytest.raises(AssertionError):
        assert_matches("<job-id>", "abc", captured_job_id=None)


# ───────────────────────── fixture replay ─────────────────────────


def test_fixture_inventory_nonempty():
    """Guard against silently passing when the fixture dir goes missing."""
    assert FIXTURES_DIR.is_dir(), f"missing fixtures dir: {FIXTURES_DIR}"
    assert SINGLE_FIXTURES, "no *.request.json fixtures found"
    assert SESSION_FIXTURES, "no *.session.json fixtures found"


@pytest.mark.parametrize(
    "request_path", SINGLE_FIXTURES,
    ids=lambda p: p.name.replace(".request.json", ""),
)
def test_single_exchange_fixture(request_path: Path):
    request = json.loads(request_path.read_text())
    responses_path = request_path.with_name(
        request_path.name.replace(".request.json", ".responses.json")
    )
    expected = json.loads(responses_path.read_text())
    _skip_unless_framework_deps([request])

    websocket = replay([request])

    actual = websocket.steps[0] if websocket.steps else []
    actual_types = [m.get("type") for m in actual]
    expected_types = [m.get("type") for m in expected]
    assert actual_types == expected_types, (
        f"{request_path.name}: response sequence {actual_types} "
        f"!= documented {expected_types}"
    )
    for i, (exp, act) in enumerate(zip(expected, actual)):
        assert_matches(
            exp, act,
            captured_job_id=websocket.captured_job_id,
            path=f"responses[{i}]",
        )


@pytest.mark.parametrize(
    "session_path", SESSION_FIXTURES,
    ids=lambda p: p.name.replace(".session.json", ""),
)
def test_session_fixture(session_path: Path):
    steps = json.loads(session_path.read_text())
    _skip_unless_framework_deps([step["request"] for step in steps])

    websocket = replay([step["request"] for step in steps])

    assert len(websocket.steps) == len(steps)
    for index, step in enumerate(steps):
        expected = step["responses"]
        actual = websocket.steps[index]
        actual_types = [m.get("type") for m in actual]
        expected_types = [m.get("type") for m in expected]
        assert actual_types == expected_types, (
            f"{session_path.name} step {index}: response sequence "
            f"{actual_types} != documented {expected_types}"
        )
        for i, (exp, act) in enumerate(zip(expected, actual)):
            assert_matches(
                exp, act,
                captured_job_id=websocket.captured_job_id,
                path=f"steps[{index}].responses[{i}]",
            )


# ───────────────────────── runnable client example ─────────────────────────


def test_python_example_client_against_live_server():
    """Run docs-site/fixtures/clients/example_client.py against a REAL
    websockets server wrapping the real handler, on an ephemeral port.

    Proves the documented client example actually speaks the protocol:
    exit 0 and a histogram line ("00: 132"-style) on stdout.
    """
    pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")
    import websockets

    client_path = FIXTURES_DIR / "clients" / "example_client.py"
    assert client_path.is_file(), f"missing client example: {client_path}"

    async def run() -> tuple[int, str, str]:
        async with websockets.serve(
            server.handle_message, "127.0.0.1", 0,
            max_size=server.MAX_MESSAGE_SIZE,
        ) as ws_server:
            port = ws_server.sockets[0].getsockname()[1]
            process = await asyncio.create_subprocess_exec(
                sys.executable, str(client_path), f"ws://127.0.0.1:{port}",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=120
            )
            return process.returncode, stdout.decode(), stderr.decode()

    returncode, stdout, stderr = asyncio.run(run())
    assert returncode == 0, f"example client failed:\nstdout:\n{stdout}\nstderr:\n{stderr}"
    assert re.search(r"^[01]{2}: \d+$", stdout, re.MULTILINE), (
        f"expected a histogram line on stdout, got:\n{stdout}"
    )
