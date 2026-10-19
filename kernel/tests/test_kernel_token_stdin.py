"""The kernel token travels over stdin, never the process environment.

A process's initial environment block stays readable by same-user processes
(``sysctl KERN_PROCARGS2`` on macOS, ``/proc/<pid>/environ`` on Linux), even
after ``os.environ.pop``. The desktop shell therefore writes ``token\\n`` to the
kernel's stdin and sets only the secret-free ``NUCLEI_KERNEL_TOKEN_STDIN=1``.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import secrets
import subprocess
import sys
import time
from pathlib import Path

import pytest
import websockets

from kernel import auth

REPO_ROOT = Path(auth.__file__).resolve().parent.parent
TOKEN = "s" * 43


# ── config_from_env ──────────────────────────────────────────────────────


def test_token_is_read_from_a_single_stdin_line():
    config = auth.config_from_env(
        {auth.TOKEN_STDIN_ENV: "1"}, stdin=io.StringIO(TOKEN + "\nleftover\n")
    )
    assert config.token == TOKEN and not config.insecure


def test_stdin_flag_without_a_token_line_refuses_to_start():
    for stream in (io.StringIO(""), io.StringIO("\n")):
        with pytest.raises(auth.AuthConfigError, match="no token line"):
            auth.config_from_env({auth.TOKEN_STDIN_ENV: "1"}, stdin=stream)


def test_stdin_flag_does_not_fall_back_to_insecure_dev_mode():
    with pytest.raises(auth.AuthConfigError):
        auth.config_from_env(
            {auth.TOKEN_STDIN_ENV: "1", auth.INSECURE_ENV: "1"}, stdin=io.StringIO("")
        )


def test_stdin_token_wins_over_an_env_token():
    config = auth.config_from_env(
        {auth.TOKEN_STDIN_ENV: "1", auth.TOKEN_ENV: "e" * 43}, stdin=io.StringIO(TOKEN + "\n")
    )
    assert config.token == TOKEN


def test_short_stdin_token_is_rejected_like_an_env_token():
    with pytest.raises(auth.AuthConfigError):
        auth.config_from_env({auth.TOKEN_STDIN_ENV: "1"}, stdin=io.StringIO("short\n"))


def test_stdin_is_not_read_without_the_flag():
    stream = io.StringIO(TOKEN + "\n")
    with pytest.raises(auth.AuthConfigError):
        auth.config_from_env({}, stdin=stream)
    assert stream.tell() == 0


def test_env_token_still_works_for_manual_and_dev_runs():
    assert auth.config_from_env({auth.TOKEN_ENV: TOKEN}).token == TOKEN


def test_flag_is_removed_from_the_process_environment(monkeypatch):
    monkeypatch.setenv(auth.TOKEN_STDIN_ENV, "1")
    monkeypatch.delenv(auth.TOKEN_ENV, raising=False)
    auth.config_from_env(stdin=io.StringIO(TOKEN + "\n"))
    assert auth.TOKEN_STDIN_ENV not in os.environ


def test_scrubbed_environment_drops_the_stdin_flag():
    scrubbed = auth.scrubbed_environment({auth.TOKEN_STDIN_ENV: "1", "KEEP": "x"})
    assert scrubbed == {"KEEP": "x"}


# ── a real kernel process ────────────────────────────────────────────────


def _start_kernel(tmp_path: Path, *, token_via: str, token: str):
    env = {k: v for k, v in os.environ.items() if not k.startswith("NUCLEI_")}
    env.update(PYTHONPATH=str(REPO_ROOT), NUCLEI_RUNTIME_DIR=str(tmp_path))
    if token_via == "stdin":
        env[auth.TOKEN_STDIN_ENV] = "1"
    else:
        env[auth.TOKEN_ENV] = token
    proc = subprocess.Popen(
        [sys.executable, str(REPO_ROOT / "kernel" / "server.py")],
        cwd=REPO_ROOT,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    if token_via == "stdin":
        proc.stdin.write(token + "\n")
    proc.stdin.close()
    deadline = time.time() + 90
    while time.time() < deadline:
        line = proc.stdout.readline()
        if "ready on ws://" in line:
            return proc, int(line.strip().rsplit(":", 1)[1])
        if not line and proc.poll() is not None:
            break
    proc.kill()
    raise AssertionError("kernel did not become ready")


async def _handshake(port: int, token: str) -> dict:
    async with websockets.connect(f"ws://localhost:{port}") as ws:
        nonce = secrets.token_hex(32)
        await ws.send(json.dumps({"type": "authenticate", "token": token, "nonce": nonce}))
        return json.loads(await asyncio.wait_for(ws.recv(), 10))


def _procargs(pid: int) -> bytes:
    """Raw KERN_PROCARGS2 buffer (args + initial environment), as any same-user
    process can read it. The reviewer's probe, run without a sandbox."""
    import ctypes

    libc = ctypes.CDLL(None, use_errno=True)
    mib = (ctypes.c_int * 3)(1, 49, pid)  # CTL_KERN, KERN_PROCARGS2, pid
    size = ctypes.c_size_t()
    assert libc.sysctl(mib, 3, None, ctypes.byref(size), None, 0) == 0
    buf = ctypes.create_string_buffer(size.value)
    assert libc.sysctl(mib, 3, buf, ctypes.byref(size), None, 0) == 0
    return buf.raw[: size.value]


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX pipes")
def test_kernel_authenticates_with_a_stdin_token(tmp_path):
    token = secrets.token_urlsafe(32)
    proc, port = _start_kernel(tmp_path, token_via="stdin", token=token)
    try:
        assert asyncio.run(_handshake(port, token))["type"] == "authenticated"
        runtime = json.loads((tmp_path / auth.RUNTIME_FILE_NAME).read_text())
        assert runtime["token"] == token
    finally:
        proc.kill()
        proc.wait()


@pytest.mark.skipif(sys.platform != "darwin", reason="KERN_PROCARGS2 is a macOS interface")
def test_token_is_not_recoverable_from_the_kernels_procargs(tmp_path):
    """MEDIUM-1: the reviewer's probe must find nothing; and the probe must be
    able to find a token that is passed the old way (positive control)."""
    secret = secrets.token_urlsafe(32)
    via_env, env_port = _start_kernel(tmp_path / "env", token_via="env", token=secret)
    try:
        assert secret.encode() in _procargs(via_env.pid), "probe cannot see env tokens"
    finally:
        via_env.kill()
        via_env.wait()

    secret = secrets.token_urlsafe(32)
    via_stdin, port = _start_kernel(tmp_path / "stdin", token_via="stdin", token=secret)
    try:
        assert asyncio.run(_handshake(port, secret))["type"] == "authenticated"
        assert secret.encode() not in _procargs(via_stdin.pid)
    finally:
        via_stdin.kill()
        via_stdin.wait()


# ── QEC Data Engine entrypoint ───────────────────────────────────────────


def test_qec_engine_reads_its_token_from_stdin_when_asked(monkeypatch):
    from kernel.qec_data import server_entrypoint as entry

    monkeypatch.setenv(entry.TOKEN_STDIN_VARIABLE, "1")
    monkeypatch.delenv(entry.TOKEN_ENVIRONMENT_VARIABLE, raising=False)
    monkeypatch.setattr(sys, "stdin", io.StringIO("qec-token-value\nignored\n"))
    assert entry._read_token() == "qec-token-value"
    assert entry.TOKEN_STDIN_VARIABLE not in os.environ


def test_qec_engine_stdin_mode_without_a_line_yields_no_token(monkeypatch):
    from kernel.qec_data import server_entrypoint as entry

    monkeypatch.setenv(entry.TOKEN_STDIN_VARIABLE, "1")
    monkeypatch.setenv(entry.TOKEN_ENVIRONMENT_VARIABLE, "from-env")
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    assert entry._read_token() is None  # never silently falls back to the env


def test_qec_engine_still_accepts_an_env_token_for_manual_runs(monkeypatch):
    from kernel.qec_data import server_entrypoint as entry

    monkeypatch.delenv(entry.TOKEN_STDIN_VARIABLE, raising=False)
    monkeypatch.setenv(entry.TOKEN_ENVIRONMENT_VARIABLE, "from-env")
    assert entry._read_token() == "from-env"
