"""Kernel WebSocket authentication: token handshake, Origin/Host allowlist,
fail-closed configuration and the user-only runtime file."""

import asyncio
import json
import os
import socket
import stat
import sys
from pathlib import Path

import pytest
import websockets
# The kernel serves with websockets' asyncio implementation (13.0+); the
# tests must too, or they silently exercise a different API on old pins.
from websockets.asyncio.client import connect as ws_connect
from websockets.asyncio.server import serve as ws_serve
from websockets.exceptions import InvalidStatus

from kernel import auth, server

TOKEN = "t" * 43


def _config(**overrides) -> auth.KernelAuthConfig:
    values = {"token": TOKEN, "insecure": False, "dev": False}
    values.update(overrides)
    return auth.build_config(**values)


class Recorder:
    """Inner handler stand-in: records every frame that reaches it."""

    def __init__(self) -> None:
        self.frames: list[str] = []

    async def __call__(self, websocket) -> None:
        async for raw in websocket:
            self.frames.append(raw)
            await websocket.send(json.dumps({"type": "echo", "raw": raw}))


async def _serve(config, inner):
    handler = auth.secure_handler(inner, config)
    ws_server = await ws_serve(handler, "127.0.0.1", 0)
    return ws_server, ws_server.sockets[0].getsockname()[1]


async def _attempt(port, first_frames, headers=None, host=None):
    """Connect, send frames; return (messages received, close code).

    ``host`` is a "name:port" authority placed in the URL (so it becomes the
    Host header) while the TCP connection still goes to 127.0.0.1:``port``.
    """
    extra = dict(headers or {})
    origin = extra.pop("Origin", None)
    authority = host if host is not None else f"127.0.0.1:{port}"
    received: list[dict] = []
    close_code = None
    try:
        async with ws_connect(
            f"ws://{authority}",
            host="127.0.0.1",
            port=port,
            additional_headers=extra,
            origin=origin,
        ) as ws:
            for frame in first_frames:
                await ws.send(frame)
            try:
                while True:
                    received.append(json.loads(await asyncio.wait_for(ws.recv(), 0.4)))
            except websockets.ConnectionClosed:
                pass
            except TimeoutError:  # connection stayed open and went quiet
                pass
            # ``ws.close_code`` only exists from websockets 14; the protocol
            # object carries it on every supported version (13.0+).
            close_code = ws.protocol.close_code
    except websockets.ConnectionClosed as closed:
        close_code = closed.rcvd.code if closed.rcvd else None
    return received, close_code


def _run(coro):
    return asyncio.run(coro)


def _auth_frame(token=TOKEN) -> str:
    return json.dumps({"type": "authenticate", "token": token})


def test_correct_token_reaches_handler():
    async def scenario():
        inner = Recorder()
        ws_server, port = await _serve(_config(), inner)
        try:
            return inner, await _attempt(port, [_auth_frame(), '{"type":"ping"}'])
        finally:
            ws_server.close()
    inner, (received, _) = _run(scenario())
    assert received[0] == {"type": "authenticated"}
    assert inner.frames == ['{"type":"ping"}']


def test_origin_less_client_with_token_works():
    async def scenario():
        ws_server, port = await _serve(_config(), Recorder())
        try:
            return await _attempt(port, [_auth_frame(), "{}"])
        finally:
            ws_server.close()
    received, _ = _run(scenario())
    assert received[0]["type"] == "authenticated"


@pytest.mark.parametrize("bad_first", [
    json.dumps({"type": "authenticate", "token": "wrong"}),
    json.dumps({"type": "execute", "code": "import os"}),
    json.dumps({"type": "authenticate"}),
    json.dumps({"type": "authenticate", "token": 7}),
    "not json",
])
def test_missing_or_wrong_token_refused_before_any_handler(bad_first):
    async def scenario():
        inner = Recorder()
        ws_server, port = await _serve(_config(), inner)
        try:
            return inner, await _attempt(port, [bad_first, '{"type":"ping"}'])
        finally:
            ws_server.close()
    inner, (received, close_code) = _run(scenario())
    assert inner.frames == []
    assert all(m.get("type") != "authenticated" for m in received)
    assert close_code == auth.CLOSE_UNAUTHENTICATED


def test_silent_client_times_out_without_reaching_handler():
    async def scenario():
        inner = Recorder()
        handler = auth.secure_handler(inner, _config(), auth_timeout=0.2)
        ws_server = await ws_serve(handler, "127.0.0.1", 0)
        port = ws_server.sockets[0].getsockname()[1]
        try:
            return inner, await _attempt(port, [])
        finally:
            ws_server.close()
    inner, (_, close_code) = _run(scenario())
    assert inner.frames == []
    assert close_code == auth.CLOSE_UNAUTHENTICATED


@pytest.mark.parametrize("origin", [
    "https://evil.example", "http://localhost:5173", "null", "tauri://evil",
])
def test_foreign_origin_refused_even_with_valid_token(origin):
    async def scenario():
        inner = Recorder()
        ws_server, port = await _serve(_config(), inner)
        try:
            return inner, await _attempt(
                port, [_auth_frame(), '{"type":"ping"}'], headers={"Origin": origin}
            )
        finally:
            ws_server.close()
    inner, (received, close_code) = _run(scenario())
    assert inner.frames == []
    assert received == []
    assert close_code == auth.CLOSE_FORBIDDEN


@pytest.mark.parametrize("origin", [
    "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost",
])
def test_tauri_origins_accepted(origin):
    async def scenario():
        ws_server, port = await _serve(_config(), Recorder())
        try:
            return await _attempt(port, [_auth_frame()], headers={"Origin": origin})
        finally:
            ws_server.close()
    received, _ = _run(scenario())
    assert received[0]["type"] == "authenticated"


def test_vite_dev_origin_only_in_dev():
    async def scenario(dev):
        ws_server, port = await _serve(_config(dev=dev), Recorder())
        try:
            return await _attempt(
                port, [_auth_frame()], headers={"Origin": "http://localhost:5173"}
            )
        finally:
            ws_server.close()
    prod_received, prod_code = _run(scenario(False))
    dev_received, _ = _run(scenario(True))
    assert prod_received == [] and prod_code == auth.CLOSE_FORBIDDEN
    assert dev_received[0]["type"] == "authenticated"


def test_foreign_host_header_refused_dns_rebinding():
    async def scenario():
        inner = Recorder()
        ws_server, port = await _serve(_config(), inner)
        try:
            return inner, await _attempt(
                port, [_auth_frame(), "{}"], host="attacker.example:%d" % port
            )
        finally:
            ws_server.close()
    inner, (received, close_code) = _run(scenario())
    assert inner.frames == [] and received == []
    assert close_code == auth.CLOSE_FORBIDDEN


def test_duplicate_host_headers_refused():
    async def scenario():
        inner = Recorder()
        ws_server, port = await _serve(_config(), inner)
        try:
            return inner, await _attempt(
                port, [_auth_frame()], headers={"Host": f"localhost:{port}"}
            )
        finally:
            ws_server.close()
    inner, (received, close_code) = _run(scenario())
    assert inner.frames == [] and received == []
    assert close_code == auth.CLOSE_FORBIDDEN


def test_host_with_wrong_port_refused():
    async def scenario():
        ws_server, port = await _serve(_config(), Recorder())
        try:
            return await _attempt(port, [_auth_frame()], host="localhost:1")
        finally:
            ws_server.close()
    received, close_code = _run(scenario())
    assert received == [] and close_code == auth.CLOSE_FORBIDDEN


def test_localhost_host_header_accepted():
    async def scenario():
        ws_server, port = await _serve(_config(), Recorder())
        try:
            return await _attempt(port, [_auth_frame()], host=f"localhost:{port}")
        finally:
            ws_server.close()
    received, _ = _run(scenario())
    assert received[0]["type"] == "authenticated"


def test_real_handler_not_reached_without_token():
    """The actual executor handler must never see an unauthenticated frame."""
    async def scenario():
        ws_server = await server._try_serve(0, _config())
        # "localhost" may bind IPv4 and IPv6 on different ephemeral ports.
        port = next(
            s for s in ws_server.sockets if s.family == socket.AF_INET
        ).getsockname()[1]
        try:
            bad = await _attempt(port, [json.dumps({"type": "parse", "code": "x=1"})])
            good = await _attempt(port, [_auth_frame(), json.dumps({"type": "nope"})])
            return bad, good
        finally:
            ws_server.close()
    (bad_received, bad_code), (good_received, _) = _run(scenario())
    assert bad_received == [] and bad_code == auth.CLOSE_UNAUTHENTICATED
    assert good_received[0]["type"] == "authenticated"
    assert good_received[1]["message"].startswith("Unknown message type")


def _real_server_port(ws_server) -> int:
    return next(s for s in ws_server.sockets if s.family == socket.AF_INET).getsockname()[1]


@pytest.mark.parametrize("origin", ["https://evil.example", "null"])
def test_foreign_origin_gets_http_403_before_handshake_completes(origin):
    async def scenario():
        ws_server = await server._try_serve(0, _config())
        port = _real_server_port(ws_server)
        try:
            with pytest.raises(InvalidStatus) as info:
                async with ws_connect(
                    f"ws://127.0.0.1:{port}", origin=origin
                ):
                    pass
            return info.value.response.status_code
        finally:
            ws_server.close()
    assert _run(scenario()) == 403


def test_foreign_host_gets_http_403_before_handshake_completes():
    async def scenario():
        ws_server = await server._try_serve(0, _config())
        port = _real_server_port(ws_server)
        try:
            with pytest.raises(InvalidStatus) as info:
                async with ws_connect(
                    f"ws://attacker.example:{port}", host="127.0.0.1", port=port
                ):
                    pass
            return info.value.response.status_code
        finally:
            ws_server.close()
    assert _run(scenario()) == 403


def test_real_server_accepts_originless_authenticated_client():
    async def scenario():
        ws_server = await server._try_serve(0, _config())
        port = _real_server_port(ws_server)
        try:
            return await _attempt(port, [_auth_frame()])
        finally:
            ws_server.close()
    received, _ = _run(scenario())
    assert received[0]["type"] == "authenticated"


# ── mutual authentication (server proof) ─────────────────────────────────

NONCE = "ab" * 32


def _nonce_frame(nonce=NONCE, token=TOKEN) -> str:
    return json.dumps({"type": "authenticate", "token": token, "nonce": nonce})


def _expected_proof(token=TOKEN, nonce=NONCE) -> str:
    import hashlib
    import hmac
    return hmac.new(token.encode(), nonce.encode(), hashlib.sha256).hexdigest()


def test_ack_carries_hmac_proof_when_client_sends_a_nonce():
    async def scenario():
        ws_server, port = await _serve(_config(), Recorder())
        try:
            return await _attempt(port, [_nonce_frame()])
        finally:
            ws_server.close()
    received, _ = _run(scenario())
    assert received[0] == {"type": "authenticated", "proof": _expected_proof()}


def test_ack_has_no_proof_for_a_legacy_frame_without_a_nonce():
    async def scenario():
        ws_server, port = await _serve(_config(), Recorder())
        try:
            return await _attempt(port, [_auth_frame()])
        finally:
            ws_server.close()
    received, _ = _run(scenario())
    assert received[0] == {"type": "authenticated"}


@pytest.mark.parametrize("nonce", [7, None, "", "short", "x" * 257, ["a"]])
def test_malformed_nonce_is_refused(nonce):
    async def scenario():
        inner = Recorder()
        ws_server, port = await _serve(_config(), inner)
        try:
            return inner, await _attempt(port, [_nonce_frame(nonce), '{"type":"ping"}'])
        finally:
            ws_server.close()
    inner, (received, close_code) = _run(scenario())
    assert inner.frames == []
    assert all(m.get("type") != "authenticated" for m in received)
    assert close_code == auth.CLOSE_UNAUTHENTICATED


def test_wrong_token_never_yields_a_proof():
    async def scenario():
        ws_server, port = await _serve(_config(), Recorder())
        try:
            return await _attempt(port, [_nonce_frame(token="w" * 43)])
        finally:
            ws_server.close()
    received, _ = _run(scenario())
    assert received == []


def test_proof_differs_per_nonce_and_token():
    assert auth.server_proof(TOKEN, NONCE) != auth.server_proof(TOKEN, "cd" * 32)
    assert auth.server_proof(TOKEN, NONCE) != auth.server_proof("u" * 43, NONCE)


def test_real_server_returns_proof():
    async def scenario():
        ws_server = await server._try_serve(0, _config())
        port = _real_server_port(ws_server)
        try:
            return await _attempt(port, [_nonce_frame()])
        finally:
            ws_server.close()
    received, _ = _run(scenario())
    assert received[0]["proof"] == _expected_proof()


# ── configuration (fail closed) ──────────────────────────────────────────


def test_config_without_token_refuses_to_start():
    with pytest.raises(auth.AuthConfigError):
        auth.config_from_env({})


def test_config_with_empty_or_short_token_refuses():
    with pytest.raises(auth.AuthConfigError):
        auth.config_from_env({auth.TOKEN_ENV: ""})
    with pytest.raises(auth.AuthConfigError):
        auth.config_from_env({auth.TOKEN_ENV: "short"})


def test_insecure_flag_allows_missing_token_and_warns(caplog, capsys):
    config = auth.config_from_env({auth.INSECURE_ENV: "1"})
    assert config.insecure and config.token is None
    assert "INSECURE" in capsys.readouterr().err


def test_insecure_flag_requires_exact_one():
    with pytest.raises(auth.AuthConfigError):
        auth.config_from_env({auth.INSECURE_ENV: "true"})


def test_insecure_mode_still_checks_origin_and_skips_token():
    async def scenario():
        inner = Recorder()
        config = auth.config_from_env({auth.INSECURE_ENV: "1"})
        ws_server, port = await _serve(config, inner)
        try:
            ok = await _attempt(port, ['{"type":"ping"}'])
            bad = await _attempt(
                port, ['{"type":"ping"}'], headers={"Origin": "https://evil.example"}
            )
            return inner, ok, bad
        finally:
            ws_server.close()
    inner, (ok_received, _), (bad_received, bad_code) = _run(scenario())
    assert ok_received[0]["type"] == "echo"
    assert bad_received == [] and bad_code == auth.CLOSE_FORBIDDEN
    assert len(inner.frames) == 1


def test_dev_flag_adds_vite_origins():
    config = auth.config_from_env({auth.TOKEN_ENV: TOKEN, auth.DEV_ENV: "1"})
    assert "http://localhost:5173" in config.allowed_origins
    prod = auth.config_from_env({auth.TOKEN_ENV: TOKEN})
    assert "http://localhost:5173" not in prod.allowed_origins


# ── runtime file ─────────────────────────────────────────────────────────


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX modes")
def test_runtime_file_is_user_only(tmp_path):
    runtime_dir = tmp_path / "runtime"
    path = auth.write_runtime_file(_config(), 9742, runtime_dir=runtime_dir)
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(runtime_dir).st_mode) == 0o700
    data = json.loads(path.read_text())
    assert data["token"] == TOKEN and data["port"] == 9742 and data["pid"] == os.getpid()
    assert data["url"] == "ws://localhost:9742"


def test_runtime_file_skipped_in_insecure_mode(tmp_path):
    config = auth.config_from_env({auth.INSECURE_ENV: "1"})
    assert auth.write_runtime_file(config, 9742, runtime_dir=tmp_path) is None


def test_runtime_file_replaces_stale_loose_permissions(tmp_path):
    if sys.platform == "win32":
        pytest.skip("POSIX modes")
    path = tmp_path / auth.RUNTIME_FILE_NAME
    path.write_text("old")
    os.chmod(path, 0o644)
    auth.write_runtime_file(_config(), 9742, runtime_dir=tmp_path)
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600


def test_read_runtime_token_roundtrip(tmp_path):
    auth.write_runtime_file(_config(), 9742, runtime_dir=tmp_path)
    info = auth.read_runtime_file(runtime_dir=tmp_path)
    assert info["token"] == TOKEN


def test_config_from_env_removes_token_from_process_environment(monkeypatch):
    monkeypatch.setenv(auth.TOKEN_ENV, TOKEN)
    config = auth.config_from_env()
    assert config.token == TOKEN
    assert auth.TOKEN_ENV not in os.environ


def test_config_from_env_leaves_explicit_mapping_untouched():
    env = {auth.TOKEN_ENV: TOKEN}
    auth.config_from_env(env)
    assert env == {auth.TOKEN_ENV: TOKEN}


def test_scrubbed_environment_drops_kernel_secrets():
    env = {auth.TOKEN_ENV: TOKEN, "PATH": "/bin", auth.INSECURE_ENV: "1"}
    assert auth.scrubbed_environment(env) == {"PATH": "/bin"}


def test_agent_worker_does_not_inherit_token(monkeypatch):
    captured = {}

    async def fake_exec(*args, **kwargs):
        captured.update(kwargs)
        raise OSError("stop here")

    monkeypatch.setenv(auth.TOKEN_ENV, TOKEN)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    _run(server.run_agent_worker({"request_id": "r"}))
    assert auth.TOKEN_ENV not in captured["env"]


def test_unwritable_runtime_dir_is_reported_not_fatal(tmp_path, capsys):
    blocker = tmp_path / "file"
    blocker.write_text("x")
    assert server._publish_runtime_file(_config(), 9742, runtime_dir=blocker / "sub") is None
    assert "runtime file" in capsys.readouterr().err


# ── runtime file lifecycle (signals, stale pid) ──────────────────────────


def test_runtime_file_removed_on_sigterm(tmp_path):
    import signal
    import subprocess
    import textwrap
    import time

    script = textwrap.dedent(
        f"""
        import sys, time
        sys.path.insert(0, {str(Path(auth.__file__).parent.parent)!r})
        from kernel import auth
        cfg = auth.build_config(token={TOKEN!r}, insecure=False, dev=False)
        auth.write_runtime_file(cfg, 9742, runtime_dir={str(tmp_path)!r})
        print("ready", flush=True)
        time.sleep(60)
        """
    )
    proc = subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.PIPE, text=True)
    try:
        assert proc.stdout.readline().strip() == "ready"
        assert (tmp_path / auth.RUNTIME_FILE_NAME).exists()
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=10)
    finally:
        if proc.poll() is None:
            proc.kill()
    assert not (tmp_path / auth.RUNTIME_FILE_NAME).exists()


def test_read_runtime_file_rejects_dead_pid(tmp_path):
    import subprocess

    dead = subprocess.Popen([sys.executable, "-c", "pass"])
    dead.wait()
    (tmp_path / auth.RUNTIME_FILE_NAME).write_text(json.dumps(
        {"url": "ws://localhost:9743", "port": 9743, "pid": dead.pid, "token": TOKEN}
    ))
    with pytest.raises(auth.StaleRuntimeFileError):
        auth.read_runtime_file(runtime_dir=tmp_path)
