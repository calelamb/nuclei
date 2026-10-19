"""Regression for the cross-site remote-code-execution report (fixed in 0.14.1).

Before authentication, any web page open while Nuclei ran could connect to
``ws://localhost:<port>`` from the browser (a WebSocket is not subject to the
same-origin policy) and send ``run_python``. This test boots a REAL kernel
process and replays that attack and its variants over real sockets:

* a cross-origin handshake is refused with HTTP 403, with or without a token;
* a connection with no token (or a wrong one) is closed with 4401 before any
  message is handled, so ``run_python`` and the Lab families are unreachable;
* the marker file the original exploit wrote is never created;
* a legitimate authenticated client still works (the marker IS created), so the
  test cannot pass merely because the kernel is broken.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

REPO_ROOT = Path(__file__).resolve().parents[2]
TOKEN = "xsite-regression-token-" + "q" * 32
EVIL_ORIGIN = "https://evil.example.com"
RECV_TIMEOUT = 30


@pytest.fixture(scope="module")
def kernel(tmp_path_factory):
    runtime = tmp_path_factory.mktemp("runtime")
    env = {
        **os.environ,
        "PYTHONPATH": str(REPO_ROOT),
        "NUCLEI_KERNEL_TOKEN": TOKEN,
        "NUCLEI_RUNTIME_DIR": str(runtime),
        "NUCLEI_DISABLE_CRED_STORE": "1",
        "NUCLEI_DATA_DIR": str(tmp_path_factory.mktemp("data")),
    }
    env.pop("NUCLEI_KERNEL_INSECURE_DEV", None)
    proc = subprocess.Popen(
        [sys.executable, str(REPO_ROOT / "kernel" / "server.py")],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env, cwd=REPO_ROOT,
    )
    port = None
    for _ in range(400):
        line = proc.stdout.readline()
        if not line:
            break
        if "ready on ws://" in line:
            port = int(line.strip().rsplit(":", 1)[1])
            break
    if port is None:
        proc.kill()
        pytest.fail("the kernel did not announce a port")
    try:
        yield {"port": port, "uri": f"ws://localhost:{port}", "pid": proc.pid}
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def _marker_code(marker: Path) -> str:
    return f"open({str(marker)!r}, 'w').write('rce')"


async def _first_response(uri, frames, **connect_kwargs):
    """Send ``frames`` and return (messages received, close code or None)."""
    received: list[dict] = []
    code = None
    async with connect(uri, **connect_kwargs) as ws:
        for frame in frames:
            await ws.send(json.dumps(frame))
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), RECV_TIMEOUT)
                received.append(json.loads(raw))
        except ConnectionClosed as closed:
            code = closed.rcvd.code if closed.rcvd else None
    return received, code


def _run(coro):
    return asyncio.run(coro)


@pytest.mark.parametrize("frames", [
    [],
    [{"type": "authenticate", "token": TOKEN}],
    [{"type": "authenticate", "token": TOKEN}, {"type": "run_python", "code": "1"}],
], ids=["no-frames", "valid-token", "token-and-request"])
def test_cross_origin_handshake_is_refused_with_403(kernel, tmp_path, frames):
    marker = tmp_path / "rce_marker.txt"
    frames = [dict(f, code=_marker_code(marker)) if f.get("type") == "run_python" else f for f in frames]

    async def attempt():
        with pytest.raises(InvalidStatus) as info:
            await _first_response(kernel["uri"], frames, origin=EVIL_ORIGIN)
        return info.value.response.status_code

    assert _run(attempt()) == 403
    assert not marker.exists()


def test_poc_run_python_without_a_token_is_unreachable(kernel, tmp_path):
    marker = tmp_path / "rce_marker.txt"
    received, code = _run(_first_response(
        kernel["uri"], [{"type": "run_python", "code": _marker_code(marker)}]))
    assert code == 4401
    assert not any(m.get("type") == "python_result" for m in received)
    assert not marker.exists()


@pytest.mark.parametrize("request_type", ["discovery_evaluators", "trainability_inspect", "execute", "environment"])
def test_no_message_family_answers_before_authentication(kernel, request_type):
    received, code = _run(_first_response(kernel["uri"], [{"type": request_type, "code": "x"}]))
    assert code == 4401 and received == []


def test_wrong_token_is_closed_with_4401_and_never_reaches_run_python(kernel, tmp_path):
    marker = tmp_path / "rce_marker.txt"
    received, code = _run(_first_response(kernel["uri"], [
        {"type": "authenticate", "token": TOKEN[:-1] + "!"},
        {"type": "run_python", "code": _marker_code(marker)},
    ]))
    assert code == 4401 and received == []
    assert not marker.exists()


def test_rebinding_style_host_header_is_refused_with_403(kernel):
    async def attempt():
        with pytest.raises(InvalidStatus) as info:
            await _first_response(
                f"ws://127.0.0.1:{kernel['port']}", [],
                additional_headers={"Host": "attacker.example"})
        return info.value.response.status_code

    assert _run(attempt()) == 403


def test_authenticated_client_still_runs_python_and_the_lab(kernel, tmp_path):
    """Positive control: the marker mechanism works, so the refusals above are real."""
    marker = tmp_path / "authed_marker.txt"

    async def session():
        async with connect(kernel["uri"]) as ws:
            await ws.send(json.dumps({"type": "authenticate", "token": TOKEN}))
            ack = json.loads(await asyncio.wait_for(ws.recv(), RECV_TIMEOUT))
            await ws.send(json.dumps({"type": "run_python", "code": _marker_code(marker)}))
            while True:
                reply = json.loads(await asyncio.wait_for(ws.recv(), RECV_TIMEOUT))
                if reply.get("type") == "python_result":
                    break
            await ws.send(json.dumps({"type": "discovery_evaluators"}))
            lab = json.loads(await asyncio.wait_for(ws.recv(), RECV_TIMEOUT))
            return ack, reply, lab

    ack, reply, lab = _run(session())
    assert ack == {"type": "authenticated"}
    assert reply["success"] is True and marker.read_text() == "rce"
    assert lab["type"] == "discovery_evaluators_result"
