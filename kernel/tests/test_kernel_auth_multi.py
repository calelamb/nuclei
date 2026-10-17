"""Multi-kernel safety of the runtime files: per-port files + a latest-kernel pointer."""

import json
import os
import stat
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from kernel import auth

TOKEN_A = "a" * 43
TOKEN_B = "b" * 43


def _cfg(token: str) -> auth.KernelAuthConfig:
    return auth.build_config(token=token, insecure=False, dev=False)


def _two_kernels(directory: Path) -> None:
    auth.write_runtime_file(_cfg(TOKEN_A), 9742, runtime_dir=directory)
    auth.write_runtime_file(_cfg(TOKEN_B), 9743, runtime_dir=directory)


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX modes")
def test_per_port_file_is_user_only_and_leaves_no_temp_files(tmp_path):
    runtime = tmp_path / "runtime"
    auth.write_runtime_file(_cfg(TOKEN_A), 9742, runtime_dir=runtime)
    per_port = runtime / "kernel-9742.json"
    assert stat.S_IMODE(os.stat(per_port).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(runtime).st_mode) == 0o700
    assert json.loads(per_port.read_text())["token"] == TOKEN_A
    assert sorted(p.name for p in runtime.iterdir()) == ["kernel-9742.json", "kernel.json"]


def test_pointer_is_last_writer_but_per_port_files_keep_each_token(tmp_path):
    _two_kernels(tmp_path)
    assert json.loads((tmp_path / "kernel.json").read_text())["token"] == TOKEN_B
    assert json.loads((tmp_path / "kernel-9742.json").read_text())["token"] == TOKEN_A
    assert json.loads((tmp_path / "kernel-9743.json").read_text())["token"] == TOKEN_B


def test_reader_with_a_port_gets_that_kernels_token(tmp_path):
    _two_kernels(tmp_path)
    assert auth.read_runtime_file(runtime_dir=tmp_path, port=9742)["token"] == TOKEN_A
    assert auth.read_runtime_file(runtime_dir=tmp_path, port=9743)["token"] == TOKEN_B
    assert auth.read_runtime_file(runtime_dir=tmp_path)["token"] == TOKEN_B


def test_legacy_pointer_only_is_used_when_its_port_matches(tmp_path):
    (tmp_path / "kernel.json").write_text(json.dumps(
        {"url": "ws://localhost:9742", "port": 9742, "pid": os.getpid(), "token": TOKEN_A}
    ))
    assert auth.read_runtime_file(runtime_dir=tmp_path, port=9742)["token"] == TOKEN_A
    with pytest.raises(FileNotFoundError, match="9999"):
        auth.read_runtime_file(runtime_dir=tmp_path, port=9999)


def test_stale_per_port_file_never_falls_back_to_another_kernels_token(tmp_path):
    dead = subprocess.Popen([sys.executable, "-c", "pass"])
    dead.wait()
    auth.write_runtime_file(_cfg(TOKEN_B), 9743, runtime_dir=tmp_path)
    (tmp_path / "kernel-9742.json").write_text(json.dumps(
        {"url": "ws://localhost:9742", "port": 9742, "pid": dead.pid, "token": TOKEN_A}
    ))
    with pytest.raises(auth.StaleRuntimeFileError):
        auth.read_runtime_file(runtime_dir=tmp_path, port=9742)


def test_per_port_file_with_mismatched_port_is_rejected(tmp_path):
    (tmp_path / "kernel-9742.json").write_text(json.dumps(
        {"url": "ws://localhost:9743", "port": 9743, "pid": os.getpid(), "token": TOKEN_B}
    ))
    with pytest.raises(ValueError, match="9742"):
        auth.read_runtime_file(runtime_dir=tmp_path, port=9742)


@pytest.mark.parametrize("bad", [0, -1, 70000, True, "9742"])
def test_invalid_port_is_rejected(tmp_path, bad):
    with pytest.raises(ValueError):
        auth.read_runtime_file(runtime_dir=tmp_path, port=bad)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        auth.write_runtime_file(_cfg(TOKEN_A), bad, runtime_dir=tmp_path)  # type: ignore[arg-type]


def test_exiting_kernel_keeps_the_other_kernels_files(tmp_path):
    _two_kernels(tmp_path)
    auth.remove_runtime_files(tmp_path, 9742, os.getpid())
    assert not (tmp_path / "kernel-9742.json").exists()
    assert (tmp_path / "kernel-9743.json").exists()
    assert json.loads((tmp_path / "kernel.json").read_text())["port"] == 9743


def test_exiting_latest_kernel_repoints_pointer_at_a_live_older_kernel(tmp_path):
    other = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        (tmp_path / "kernel-9742.json").write_text(json.dumps(
            {"url": "ws://localhost:9742", "port": 9742, "pid": other.pid, "token": TOKEN_A}
        ))
        auth.write_runtime_file(_cfg(TOKEN_B), 9743, runtime_dir=tmp_path)
        auth.remove_runtime_files(tmp_path, 9743, os.getpid())
        pointer = json.loads((tmp_path / "kernel.json").read_text())
        assert (pointer["port"], pointer["token"]) == (9742, TOKEN_A)
    finally:
        other.kill()
        other.wait()


def test_exiting_kernel_never_removes_a_file_it_does_not_own(tmp_path):
    auth.write_runtime_file(_cfg(TOKEN_A), 9742, runtime_dir=tmp_path)
    auth.remove_runtime_files(tmp_path, 9742, os.getpid() + 1)
    assert (tmp_path / "kernel-9742.json").exists()
    assert (tmp_path / "kernel.json").exists()


def test_both_files_removed_on_sigterm(tmp_path):
    import signal

    script = textwrap.dedent(
        f"""
        import sys, time
        sys.path.insert(0, {str(Path(auth.__file__).parent.parent)!r})
        from kernel import auth
        auth.write_runtime_file(auth.build_config(token={TOKEN_A!r}, insecure=False, dev=False),
                                9742, runtime_dir={str(tmp_path)!r})
        print("ready", flush=True)
        time.sleep(60)
        """
    )
    proc = subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.PIPE, text=True)
    try:
        assert proc.stdout.readline().strip() == "ready"
        assert (tmp_path / "kernel-9742.json").exists()
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=10)
    finally:
        if proc.poll() is None:
            proc.kill()
    assert not (tmp_path / "kernel-9742.json").exists()
    assert not (tmp_path / "kernel.json").exists()
