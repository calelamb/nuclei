"""The warm run-worker pool (PRD 15 R-B): lanes, limits, classification, freshness, isolation."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import textwrap
import time

import pytest

from kernel import run_ipc
from kernel.run_worker import DuplicateRunId
from kernel.run_worker_proc import split_markers
from kernel.tests._run_pool_fixtures import CollectingSink, call, isolated_pool, make_pool, pool, request  # noqa: F401 - fixtures

linux_only = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="Linux-only mechanism")


# -- stream marker splitting -----------------------------------------------------------------------

PREFIX = run_ipc.MARKER_PREFIX + b"abc"


def test_split_markers_plain_text_passes_through() -> None:
    assert split_markers(b"hello\n", PREFIX) == ([(b"hello\n", None)], b"")


def test_split_markers_finds_a_marker_and_what_follows() -> None:
    chunk = b"out" + run_ipc.end_marker("abc", 7) + b"next"
    segments, held = split_markers(chunk, PREFIX)
    assert segments == [(b"out", 7), (b"next", None)] and held == b""


def test_split_markers_holds_back_a_partial_marker() -> None:
    marker = run_ipc.end_marker("abc", 12)
    for cut in range(1, len(marker)):
        first, held = split_markers(b"x" + marker[:cut], PREFIX)
        assert b"".join(d for d, _ in first) + held == b"x" + marker[:cut]
        second, held2 = split_markers(held + marker[cut:], PREFIX)
        assert (second[0][1] if second[0][1] is not None else second[-1][1]) == 12 and held2 == b""


def test_split_markers_does_not_hold_ordinary_control_bytes() -> None:
    assert split_markers(b"a\x1eb", PREFIX) == ([(b"a\x1eb", None)], b"")


# -- lanes ---------------------------------------------------------------------------------------------


def test_preview_worker_is_reused_and_warm(pool) -> None:
    first = call(pool, "t_echo")
    started = time.monotonic()
    second = call(pool, "t_echo")
    assert first.reply["pid"] == second.reply["pid"]
    assert second.reply["served"] == first.reply["served"] + 1
    assert time.monotonic() - started < 1.0
    assert first.stats["reusable"] is True


def test_run_lane_uses_a_fresh_process_every_time(pool) -> None:
    pids = {call(pool, "t_echo_run").reply["pid"] for _ in range(3)}
    assert len(pids) == 3
    assert os.getpid() not in pids


def test_run_lane_uses_the_warm_spare(pool) -> None:
    call(pool, "t_echo_run")
    deadline = time.monotonic() + 30
    while pool.diagnostics()["spares"] < 1 and time.monotonic() < deadline:
        time.sleep(0.1)
    started = time.monotonic()
    result = call(pool, "t_echo_run")
    assert result.timing["spawn_wait_ms"] < 100
    assert time.monotonic() - started < 1.0


def test_output_is_attributed_to_its_own_request(pool) -> None:
    sink = CollectingSink()
    call(pool, "t_echo", {"say": "hello-out", "err": "hello-err"}, sink=sink)
    assert sink.text("stdout") == "hello-out\n" and sink.text("stderr") == "hello-err\n"
    quiet = CollectingSink()
    call(pool, "t_echo", sink=quiet)
    assert quiet.chunks == []


def test_output_is_truncated_at_the_cap_with_a_count(isolated_pool) -> None:
    small = isolated_pool(output_cap_bytes=64 * 1024)
    sink = CollectingSink()
    result = call(small, "t_flood", {"lines": 100_000}, sink=sink)
    assert result.error is None
    assert 0 < len(sink.text().encode()) <= 64 * 1024
    assert sink.dropped > 1_000_000


def test_output_streams_while_the_request_runs(pool) -> None:
    sink = CollectingSink()
    future = pool.submit(request("t_echo", {"say": "early"}), sink)
    future.result(timeout=30)
    assert [text for _s, text in sink.chunks] == ["early\n"]


def test_parse_output_can_be_buffered_until_the_end(pool) -> None:
    sink = CollectingSink()
    call(pool, "t_echo", {"say": "later"}, sink=sink, streaming=False)
    assert sink.text() == "later\n"


# -- limits and classification ---------------------------------------------------------------------------


def test_wall_clock_timeout_kills_the_group_and_the_next_request_succeeds(pool) -> None:
    started = time.monotonic()
    result = call(pool, "t_spin", wall_s=2)
    assert result.error["code"] == "timeout" and result.error["limit_s"] == 2 and result.pool_error
    assert time.monotonic() - started < 6
    assert call(pool, "t_echo_run").error is None


def test_request_wall_limit_overrides_the_op_default(pool) -> None:
    result = call(pool, "t_sleep_run", {"seconds": 30}, wall_s=300, ctx={"limits": {"wall_s": 1}})
    assert result.error["code"] == "timeout" and result.error["limit_s"] == 1.0


def test_os_exit_is_worker_died_and_the_pool_survives(pool) -> None:
    result = call(pool, "t_exit", {"code": 3})
    assert result.error["code"] == "worker_died" and result.error["reason"] == "exited:3"
    assert "kernel is fine" in result.error["message"]
    preview = call(pool, "t_exit_preview", {"code": 4})
    assert preview.error["code"] == "worker_died"
    assert call(pool, "t_echo").error is None


def test_rss_ceiling_reports_too_much_memory(isolated_pool) -> None:
    capped = isolated_pool(max_rss_bytes=1024 * 1024 * 1024)
    result = call(capped, "t_alloc", {"mb": 2048, "hold": 20}, wall_s=60)
    assert result.error["code"] == "too_much_memory"
    assert result.error["rss_bytes"] > result.error["limit_bytes"] == 1024 * 1024 * 1024
    assert call(capped, "t_echo").error is None


def test_cancel_kills_within_a_second(pool) -> None:
    call(pool, "t_echo_run")  # warm spare
    time.sleep(0.5)
    owner = 4242
    future = pool.submit(request("t_spin", run_id="cancel-me", owner=owner))
    time.sleep(1.0)
    started = time.monotonic()
    assert pool.cancel(owner, "cancel-me") is True
    result = future.result(timeout=10)
    assert time.monotonic() - started < 1.0
    assert result.error["code"] == "cancelled"


def test_stale_cancel_is_ignored_and_never_touches_the_next_run(pool) -> None:
    owner = 777
    assert call(pool, "t_echo_run", run_id="r1", owner=owner).error is None
    assert pool.cancel(owner, "r1") is False
    assert pool.cancel(owner, "never-existed") is False
    assert pool.cancel(owner + 1, "r1") is False
    follow = pool.submit(request("t_sleep_run", {"seconds": 1}, run_id="r2", owner=owner))
    assert pool.cancel(owner, "r1") is False
    assert follow.result(timeout=30).error is None


def test_duplicate_active_run_id_is_refused(pool) -> None:
    future = pool.submit(request("t_sleep_run", {"seconds": 2}, run_id="dup", owner=900))
    with pytest.raises(DuplicateRunId):
        pool.submit(request("t_echo_run", run_id="dup", owner=900))
    assert future.result(timeout=30).error is None
    assert call(pool, "t_echo_run", run_id="dup", owner=900).error is None


def test_cancelling_a_queued_preview_request_drops_it(pool) -> None:
    owner = 31
    blocker = pool.submit(request("t_sleep", {"seconds": 1.5}, owner=owner, run_id="blocker"))
    queued = pool.submit(request("t_echo", owner=owner, run_id="queued"))
    time.sleep(0.2)
    assert pool.cancel(owner, "queued") is True
    assert queued.result(timeout=5).error["code"] == "cancelled"
    assert blocker.result(timeout=30).error is None


def test_cancelling_a_running_preview_request_requeues_the_others(pool) -> None:
    mine, other = 41, 42
    running = pool.submit(request("t_sleep", {"seconds": 30}, owner=mine, run_id="slow"))
    time.sleep(0.5)
    waiting = pool.submit(request("t_echo", owner=other, run_id="waiting"))
    assert pool.cancel(mine, "slow") is True
    assert running.result(timeout=10).error["code"] == "cancelled"
    assert waiting.result(timeout=60).error is None


def test_queued_previews_with_a_coalesce_key_are_superseded(pool) -> None:
    owner = 51
    blocker = pool.submit(request("t_sleep", {"seconds": 1.0}, owner=owner, run_id="b"))
    time.sleep(0.2)
    first = pool.submit(request("t_echo", {"say": "one"}, owner=owner, run_id="p1", coalesce="parse"))
    second = pool.submit(request("t_echo", {"say": "two"}, owner=owner, run_id="p2", coalesce="parse"))
    assert first.result(timeout=30).superseded is True
    assert second.result(timeout=30).superseded is False
    blocker.result(timeout=30)


# -- user-code context: env, sys.path, module shadowing ---------------------------------------------------


def run_code(pool, code: str, *, root=None, file_path=None, lane_run: bool = False, run_id=None, **ctx):
    context = {"project_root": str(root) if root else None, "file_path": file_path, **ctx}
    return call(pool, "t_run_code_run" if lane_run else "t_run_code", {"code": code}, ctx=context, run_id=run_id)


def test_worker_env_has_no_token_but_keeps_the_users_environment(isolated_pool, monkeypatch) -> None:
    monkeypatch.setenv("NUCLEI_KERNEL_TOKEN", "super-secret")
    monkeypatch.setenv("NUCLEI_KERNEL_INSECURE_DEV", "1")
    monkeypatch.setenv("NUCLEI_RUNTIME_DIR", "/tmp/nope")
    monkeypatch.setenv("QISKIT_SETTINGS", "/tmp/qiskit-settings")
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid:3128")
    fresh = isolated_pool()
    env = call(fresh, "t_echo").reply["env"]
    assert not [name for name in env if name.startswith("NUCLEI_KERNEL_") or name == "NUCLEI_RUNTIME_DIR"]
    for kept in ("HOME", "QISKIT_SETTINGS", "HTTPS_PROXY", "PATH"):
        assert kept in env
    assert "MPLBACKEND" in env and "OMP_NUM_THREADS" in env


def test_worker_sys_path_shape_and_main_module(pool, tmp_path) -> None:
    (tmp_path / "sub").mkdir()
    code = textwrap.dedent(
        """
        import os, sys
        out_cwd = os.getcwd()
        out_name = __name__
        out_file = __file__
        out_path = sys.path[:3]
        out_main = sys.modules["__main__"].__file__
        """
    )
    main = tmp_path / "sub" / "main.py"
    result = run_code(pool, code, root=tmp_path, file_path=str(main))
    ns = result.reply["ns"]
    root = os.path.realpath(tmp_path)
    assert result.reply["error"] is None
    assert ns["out_cwd"] == root and ns["out_name"] == "__main__" and ns["out_file"] == str(main)
    assert ns["out_path"][:2] == [os.path.dirname(str(main)), root] and ns["out_main"] == str(main)


def test_worker_toplevel_names_are_not_nuclei_modules(pool) -> None:
    code = "import importlib.util\nout_found = [n for n in ('models', 'adapters', 'executor', 'auth', 'server', 'kernel') if importlib.util.find_spec(n)]\n"
    assert run_code(pool, code).reply["ns"]["out_found"] == []


@pytest.mark.parametrize("module", ["kernel", "noise", "models", "symmetry"])
def test_sibling_module_wins(pool, tmp_path, module: str) -> None:
    (tmp_path / f"{module}.py").write_text(f"MARKER = 'researcher-{module}'\n")
    code = f"import {module}\nout_marker = {module}.MARKER\nout_file = {module}.__file__\n"
    result = run_code(pool, code, root=tmp_path, file_path=str(tmp_path / "main.py"))
    assert result.reply["error"] is None
    assert result.reply["ns"]["out_marker"] == f"researcher-{module}"
    assert result.reply["ns"]["out_file"].startswith(os.path.realpath(tmp_path))
    # Nuclei's own package is back for the next op, in the same worker.
    assert call(pool, "t_echo").error is None
    assert call(pool, "t_msg_op", {"value": 1}).reply["ok"] is True


def test_relative_data_read_and_run_dir_write(pool, tmp_path) -> None:
    (tmp_path / "data.json").write_text('{"n": 7}')
    run_dir = tmp_path / "experiments" / "r1"
    run_dir.mkdir(parents=True)
    code = (
        "import json, os\nout_n = json.load(open('data.json'))['n']\n"
        "open(os.path.join(os.environ['NUCLEI_RUN_DIR'], 'out.txt'), 'w').write('done')\n"
    )
    result = run_code(pool, code, root=tmp_path, run_dir=str(run_dir), lane_run=True)
    assert result.reply["error"] is None and result.reply["ns"]["out_n"] == 7
    assert (run_dir / "out.txt").read_text() == "done"


def test_sys_exit_variants_are_user_exit_and_keep_the_preview_worker(pool) -> None:
    pids = set()
    for call_text in ("import sys; sys.exit(0)", "exit()", "quit(2)", "raise SystemExit('bye')"):
        result = run_code(pool, call_text)
        assert result.reply["error"]["code"] == "user_exit", call_text
        assert "the run was ended" in result.reply["error"]["message"]
        pids.add(result.reply["pid"])
    assert len(pids) == 1


def test_main_guard_runs_and_input_is_refused(pool) -> None:
    ok = run_code(pool, "if __name__ == '__main__':\n    out_ran = True\n")
    assert ok.reply["ns"]["out_ran"] is True
    refused = run_code(pool, "x = input('n? ')\n")
    assert refused.reply["error"]["code"] == "execution_error" and "input()" in refused.reply["error"]["message"]


def test_errors_show_the_users_traceback_without_nuclei_frames(pool) -> None:
    error = run_code(pool, "def f():\n    raise ValueError('nope')\nf()\n").reply["error"]
    assert error["code"] == "execution_error" and error["message"] == "ValueError: nope"
    assert "line 2, in f" in error["traceback"] and "run_context" not in error["traceback"]
    assert "raise ValueError('nope')" in error["traceback"]
    assert run_code(pool, "def (:\n").reply["error"]["code"] == "compile_error"


# -- preview freshness -------------------------------------------------------------------------------------


def test_preview_reuse_freshness(pool, tmp_path) -> None:
    (tmp_path / "rb_helper.py").write_text("STATE = ['dirty']\n")
    code = textwrap.dedent(
        """
        import os, builtins, logging, numpy as np, rb_helper
        os.environ['RB_TEST_X'] = '1'
        np.set_printoptions(precision=2)
        logging.getLogger().addHandler(logging.NullHandler())
        builtins.rb_flag = True
        """
    )
    before = call(pool, "t_probe")
    assert run_code(pool, code, root=tmp_path).reply["error"] is None
    after = call(pool, "t_probe", ctx={"project_root": str(tmp_path)})
    assert after.reply["pid"] == before.reply["pid"], "the preview worker was recycled"
    assert after.reply["env_x"] is None and after.reply["printoptions"] == before.reply["printoptions"]
    assert after.reply["log_handlers"] == before.reply["log_handlers"] and after.reply["builtin_flag"] is False
    assert after.reply["modules"] == [] and after.reply["cwd"] != str(tmp_path)


def test_edited_sibling_is_reimported(pool, tmp_path) -> None:
    helper = tmp_path / "rb_edit.py"
    helper.write_text("VALUE = 1\n")
    code = "import rb_edit\nout_value = rb_edit.VALUE\n"
    assert run_code(pool, code, root=tmp_path).reply["ns"]["out_value"] == 1
    helper.write_text("VALUE = 2\n")
    assert run_code(pool, code + "# edited\n", root=tmp_path).reply["ns"]["out_value"] == 2


def test_dirty_preview_worker_is_recycled(pool) -> None:
    clean = call(pool, "t_probe")
    leaky = run_code(pool, "import threading, time\nt = threading.Thread(target=time.sleep, args=(120,), daemon=True)\nt.start()\n")
    assert leaky.error is None and leaky.stats["reusable"] is False and "threads" in leaky.stats["dirty_reason"]
    fresh = call(pool, "t_probe")
    assert fresh.reply["pid"] != clean.reply["pid"] and fresh.reply["threads"] == clean.reply["threads"]


def test_children_left_behind_recycle_the_preview_worker(pool) -> None:
    code = "import subprocess, sys\nsubprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])\n"
    before = call(pool, "t_probe")
    run_code(pool, code)
    assert call(pool, "t_probe").reply["pid"] != before.reply["pid"]


# -- the loaded-circuit cache -----------------------------------------------------------------------------


def test_cache_serves_the_second_request_without_executing(pool, tmp_path) -> None:
    log = tmp_path / "exec_log.txt"
    code = f"open({str(log)!r}, 'a').write('x')\nout_n = 1\n"
    ctx = {"cache": "use"}
    first = run_code(pool, code, cache="use")
    second = run_code(pool, code, cache="use")
    assert first.reply["cache"] == "miss" and second.reply["cache"] == "hit"
    assert log.read_text() == "x"
    bypass = run_code(pool, code, cache="bypass")
    assert bypass.reply["cache"] == "miss" and log.read_text() == "xx"
    assert ctx


def test_cache_is_invalidated_by_a_changed_sibling_or_data_file(pool, tmp_path) -> None:
    (tmp_path / "rb_dep.py").write_text("V = 1\n")
    (tmp_path / "data.txt").write_text("a")
    code = "import rb_dep\nout_v = rb_dep.V\nout_d = open('data.txt').read()\n"
    assert run_code(pool, code, root=tmp_path, cache="use").reply["cache"] == "miss"
    assert run_code(pool, code, root=tmp_path, cache="use").reply["cache"] == "hit"
    (tmp_path / "data.txt").write_text("bb")
    third = run_code(pool, code, root=tmp_path, cache="use")
    assert third.reply["cache"] == "miss" and third.reply["ns"]["out_d"] == "bb"
    (tmp_path / "rb_dep.py").write_text("V = 5\n")
    assert run_code(pool, code, root=tmp_path, cache="use").reply["ns"]["out_v"] == 5


def test_timeouts_are_never_cached(pool) -> None:
    code = "import time\ntime.sleep(60)\n"
    first = call(pool, "t_run_code", {"code": code}, ctx={"cache": "use"}, wall_s=2)
    assert first.error["code"] == "timeout"
    again = call(pool, "t_run_code", {"code": code}, ctx={"cache": "use"}, wall_s=2)
    assert again.error["code"] == "timeout"


# -- multiprocessing --------------------------------------------------------------------------------------


@pytest.mark.parametrize("saved", [True, False], ids=["saved", "unsaved"])
@pytest.mark.parametrize("method", ["spawn", "default"])
def test_pool_map_editor_function(pool, tmp_path, saved: bool, method: str) -> None:
    context = "multiprocessing" if method == "default" else "multiprocessing.get_context('spawn')"
    code = textwrap.dedent(
        f"""
        import multiprocessing

        def square(x):
            return x * x

        if __name__ == '__main__':
            with {context}.Pool(2) as p:
                out_squares = p.map(square, range(5))
        """
    )
    file_path = None
    if saved:
        file_path = str(tmp_path / "sweep.py")
        (tmp_path / "sweep.py").write_text(code)
    result = run_code(pool, code, lane_run=True, root=tmp_path if saved else None, file_path=file_path)
    assert result.reply["error"] is None, result.reply["error"]
    assert result.reply["ns"]["out_squares"] == [0, 1, 4, 9, 16]


def test_plt_show_returns_and_figures_are_captured(pool) -> None:
    code = "import matplotlib.pyplot as plt\nplt.plot([0, 1], [1, 0])\nplt.title('conv')\nplt.show()\n"
    started = time.monotonic()
    result = run_code(pool, code, lane_run=True, figures=True)
    assert result.reply["error"] is None and result.reply["figures"] == 1
    assert time.monotonic() - started < 5


# -- message ops (the Lab's registered sync functions) ------------------------------------------------------


def test_message_op_success_and_mapped_error(pool) -> None:
    assert call(pool, "t_msg_op", {"value": 5}).reply == {"ok": True, "echo": 5}
    failed = call(pool, "t_msg_op", {"boom": True})
    assert failed.error == {"code": "mapped", "message": "boom"} and failed.reply is None


def test_unregistered_ops_are_refused(pool) -> None:
    bad = request("t_echo")
    bad.op = "os:system"
    result = pool.submit(bad).result(timeout=30)
    assert result.error["code"] == "worker_internal" and "unregistered" in result.error["message"]


# -- process lifecycle ---------------------------------------------------------------------------------------


@linux_only
def test_workers_die_with_the_server_process(tmp_path) -> None:
    script = tmp_path / "host.py"
    script.write_text(textwrap.dedent(
        f"""
        import sys, time
        sys.path.insert(0, {os.getcwd()!r})
        from kernel.tests._run_pool_fixtures import make_pool, call
        pool = make_pool()
        pids = [call(pool, "t_echo").reply["pid"], call(pool, "t_echo_run").reply["pid"]]
        print(pool.diagnostics()["preview_pid"], flush=True)
        time.sleep(300)
        """
    ))
    host = subprocess.Popen([sys.executable, str(script)], stdout=subprocess.PIPE, text=True, start_new_session=False)
    try:
        worker_pid = int(host.stdout.readline())
        os.kill(worker_pid, 0)
        host.send_signal(signal.SIGKILL)
        host.wait(10)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                os.kill(worker_pid, 0)
            except ProcessLookupError:
                return
            time.sleep(0.1)
        pytest.fail("the worker outlived its server")
    finally:
        if host.poll() is None:
            host.kill()


# -- master E-1: every exec path survives the four hazards ------------------------------------------------------

import importlib.util  # noqa: E402

from kernel.tests._run_server_helpers import BELL, converse, error_codes, run, start_kernel, warm_up  # noqa: E402

BODIES = {
    "sibling": "import rb_sibling_helper\nout = rb_sibling_helper.VALUE\n",
    "data": "import json\nout = json.load(open('data.json'))['n']\n",
    "spin": "while True:\n    pass\n",
    "exit": "import os\nos._exit(7)\n",
}
EXPECTED = {"sibling": None, "data": None, "spin": "timeout", "exit": "worker_died"}
BAD_CODES = {"timeout", "worker_died", "execution_error", "compile_error"}


@pytest.fixture(scope="module")
def hazard_kernel():
    instance = start_kernel(env={"NUCLEI_RUN_WALL_S": "3"})
    warm_up(instance)
    yield instance
    # E-4's tripwire: a missed exec path would have run in the server process and said so here.
    leaked = [line for line in instance.stderr_lines if "InProcessExecForbidden" in line]
    instance.stop()
    assert not leaked, leaked[:3]


def _project(tmp_path) -> dict:
    (tmp_path / "rb_sibling_helper.py").write_text("VALUE = 41\n")
    (tmp_path / "data.json").write_text('{"n": 2}')
    return {"project_root": str(tmp_path), "file_path": str(tmp_path / "main.py")}


def _stim_available() -> bool:
    return importlib.util.find_spec("stim") is not None


#: path -> (builds the request for a hazard body, frame types that end the exchange)
PATHS = {
    "parse": (lambda body, extra: {"type": "parse", "code": body + BELL, "language": "python", **extra}, {"snapshot", "error"}),
    "execute": (lambda body, extra: {"type": "execute", "code": body + BELL, "language": "python", "shots": 16, **extra}, {"result"}),
    "run_python": (lambda body, extra: {"type": "run_python", "code": body, **extra}, {"python_result"}),
    "transpile": (lambda body, extra: {"type": "transpile", "code": body + BELL, "language": "python", **extra}, {"transpile_result"}),
    "debug_trace": (lambda body, extra: {"type": "debug_trace", "code": body + BELL, "language": "python", **extra}, {"debug_trace_result"}),
    "trainability_inspect": (lambda body, extra: {"type": "trainability_inspect", "code": body + BELL, **extra}, {"trainability_inspected", "error"}),
    "trainability_lint": (lambda body, extra: {"type": "trainability_lint", "code": body + BELL, **extra}, {"trainability_lint_result", "error"}),
    "qec_snapshot": (lambda body, extra: {"type": "qec_snapshot", "code": "import stim\n" + body + 'circuit = stim.Circuit("H 0\\nM 0")\n', "language": "python", **extra}, {"qec_snapshot", "error"}),
    "qec_materialize": (lambda body, extra: {"type": "qec_materialize", "code": "import stim\n\ndef nuclei_circuits(noise):\n" + "".join(f"    {line}\n" for line in body.splitlines()) + '    return {"a": stim.Circuit("H 0\\nM 0")}\n', **extra}, {"qec_circuits", "error"}),
    "qec_estimate": (lambda body, extra: {"type": "qec_estimate", "code": body + BELL + "qc.t(0)\n", "language": "qiskit", **extra}, {"qec_estimate_result", "error"}),
    "hardware_submit_device": (lambda body, extra: {"type": "hardware_submit", "provider": "ibm", "backend": "ibm_brisbane", "shots": 16, "code": body + BELL, "language": "python", **extra}, {"hardware_job_submitted", "error"}),
    "hardware_submit_simulator": (lambda body, extra: {"type": "hardware_submit", "provider": "simulator", "backend": "sim_qasm", "shots": 16, "code": body + BELL, "language": "python", **extra}, {"hardware_job_submitted", "error"}),
}


def _verdict(path: str, frames: list[dict], kernel_for_job=None) -> set[str]:
    """The error codes a path reported, looking inside a failed simulator job and a failed device submit."""
    codes = set(error_codes(frames))
    for frame in frames:
        if frame.get("type") == "error" and path.startswith("hardware_submit"):
            message = frame.get("message", "")
            codes.update(c for c, text in (("timeout", "ran longer than"), ("worker_died", "exited")) if text in message)
    return codes


#: What a path that survived a benign hazard (sibling import, relative data read) must have produced: proof
#: that the user's program really ran there, not merely that no known error code showed up.
SUCCESS_FRAME = {
    "parse": "snapshot", "execute": "result", "run_python": "python_result", "transpile": "transpile_result",
    "debug_trace": "debug_trace_result", "trainability_inspect": "trainability_inspected",
    "trainability_lint": "trainability_lint_result", "qec_snapshot": "qec_snapshot", "qec_materialize": "qec_circuits",
    "qec_estimate": "qec_estimate_result", "hardware_submit_simulator": "hardware_job_submitted",
}
#: A device submit with no provider connected: the program was prepared (run by a worker) first, so reaching this
#: message proves the sibling import / data read worked; a failure there would have replaced it.
DEVICE_NOT_CONNECTED = "Hardware submit failed: Provider 'ibm' is not connected"
PROGRAM_FAILURE_MARKERS = ("ModuleNotFoundError", "FileNotFoundError", "rb_sibling_helper", "data.json")


def _assert_program_ran(path: str, hazard: str, frames: list[dict]) -> None:
    errors = [f for f in frames if f.get("type") == "error"]
    for frame in errors:
        text = frame.get("message", "") + frame.get("traceback", "")
        assert not any(marker in text for marker in PROGRAM_FAILURE_MARKERS), (path, hazard, frame)
    if path == "hardware_submit_device":
        assert [f.get("message") for f in errors] == [DEVICE_NOT_CONNECTED], (path, hazard, frames[-3:])
        return
    assert not errors, (path, hazard, errors)
    final = next((f for f in reversed(frames) if f.get("type") == SUCCESS_FRAME[path]), None)
    assert final is not None, (path, hazard, [f.get("type") for f in frames])
    if path == "hardware_submit_simulator":
        assert final["job"]["status"] == "complete" and final["job"]["error"] is None, final


@pytest.mark.parametrize("hazard", sorted(BODIES))
@pytest.mark.parametrize("path", sorted(PATHS))
def test_every_exec_path_survives(hazard_kernel, tmp_path, path: str, hazard: str) -> None:
    if path.startswith("qec_") and path != "qec_estimate" and not _stim_available():
        pytest.skip("stim is not installed")
    if path == "qec_estimate" and importlib.util.find_spec("qdk") is None and hazard in ("sibling", "data"):
        pytest.skip("qdk is not installed; the program itself would still be fine, the estimator is not")
    build, terminal = PATHS[path]
    request = build(BODIES[hazard], _project(tmp_path))
    started = time.monotonic()
    frames, probe = run(converse(hazard_kernel, [(request, terminal), ({"type": "parse", "code": BELL, "language": "python"}, {"snapshot", "error"})], timeout=30))
    assert time.monotonic() - started < 20
    codes = _verdict(path, frames)
    expected = EXPECTED[hazard]
    if path.startswith("hardware_submit_simulator") and expected:
        assert frames[-1]["type"] == "hardware_job_submitted" and frames[-1]["job"]["status"] == "failed"
    elif expected:
        assert expected in codes, (path, hazard, frames[-3:])
    else:
        assert not (codes & BAD_CODES), (path, hazard, frames[-3:])
        _assert_program_ran(path, hazard, frames)
    assert probe[-1]["type"] == "snapshot" and not error_codes(probe), "the next request on the same socket failed"


@pytest.mark.parametrize("hazard", sorted(BODIES))
@pytest.mark.parametrize("op", ["fake_symmetry_detect", "fake_symmetry_propose", "fake_deploy_inspect", "fake_qec_learned_sources"])
def test_future_lab_ops_inherit_every_guarantee(pool, tmp_path, op: str, hazard: str) -> None:
    import kernel.tests._fake_lab_ops  # noqa: F401 - registers the stand-ins in this process (workers import them by ref)
    from kernel.run_ops import spec_of
    from kernel.run_worker import RunRequest

    spec = spec_of(op)
    paths = _project(tmp_path)
    request = RunRequest(
        op=spec.ref, owner=7_000, args={"code": BODIES[hazard] + BELL, "language": "python"}, lane=spec.lane, wall_s=3,
        ctx={"project_root": paths["project_root"], "file_path": paths["file_path"], "cache": "use"}, streaming=False,
    )
    result = pool.submit(request).result(timeout=60)
    expected = EXPECTED[hazard]
    if expected:
        assert result.error["code"] == expected
    else:
        assert result.error is None and result.reply["ok"] is True
    assert call(pool, "t_echo").error is None


def test_future_lab_ops_share_one_execution_per_code_version(pool, tmp_path) -> None:
    """Design note section 7: parse + symmetry_detect/propose + deploy_inspect + learned sources run the program once."""
    import kernel.tests._fake_lab_ops  # noqa: F401 - registers the stand-ins in this process
    from kernel.run_ops import spec_of
    from kernel.run_worker import RunRequest

    log = tmp_path / "exec_log.txt"
    main = tmp_path / "main.py"
    code = f"with open({str(log)!r}, 'a') as handle:\n    handle.write('x')\n" + BELL
    main.write_text(code)
    ctx = {"project_root": str(tmp_path), "file_path": str(main), "cache": "use"}
    parsed = call(pool, "t_run_code", {"code": code}, ctx=ctx)
    assert parsed.reply["error"] is None and parsed.reply["exec_count"] == 1
    for op in ("fake_symmetry_detect", "fake_symmetry_propose", "fake_deploy_inspect", "fake_qec_learned_sources"):
        spec = spec_of(op)
        loaded = pool.submit(RunRequest(
            op=spec.ref, owner=7_100, args={"code": code, "language": "python"}, lane=spec.lane, wall_s=30,
            ctx=ctx, streaming=False,
        )).result(timeout=60)
        assert loaded.error is None and loaded.reply["ok"] is True, (op, loaded.error)
    assert log.read_text() == "x", "a Lab op re-executed a program the loaded-circuit cache already held"


# -- RLIMIT_CPU (armed by the pool for every request) -----------------------------------------------------

SPIN_CODE = "while True:\n    pass\n"


@linux_only
def test_cpu_limit_is_armed_and_kills_a_spinning_program_as_a_cpu_timeout(pool) -> None:
    started = time.monotonic()
    result = call(pool, "t_run_code_run", {"code": SPIN_CODE}, wall_s=60, ctx={"limits": {"cpu_s": 1}})
    assert result.error["code"] == "timeout" and result.error["reason"] == "cpu", result.error
    assert time.monotonic() - started < 15
    assert call(pool, "t_echo_run").error is None


def test_pool_arms_cpu_as_wall_plus_headroom_unless_the_request_carries_one(isolated_pool) -> None:
    from kernel.run_context import CPU_HEADROOM_SECONDS

    armed = isolated_pool()
    probe = request("t_probe", wall_s=20)
    ctx = armed._ctx_with_cpu(probe, armed._wall_for(probe))
    assert ctx["limits"]["cpu_s"] == 20 + CPU_HEADROOM_SECONDS
    assert "cpu_s" not in (probe.ctx.get("limits") or {}), "the caller's ctx must not be mutated"
    explicit = request("t_probe", wall_s=20, ctx={"limits": {"cpu_s": 3}})
    assert armed._ctx_with_cpu(explicit, 20)["limits"]["cpu_s"] == 3


@linux_only
def test_headroom_override_makes_a_default_cpu_limit_reachable(isolated_pool) -> None:
    short = isolated_pool(cpu_headroom_s=-58)  # wall 60 s + (-58) = 2 s of CPU
    result = call(short, "t_run_code_run", {"code": SPIN_CODE}, wall_s=60)
    assert result.error["code"] == "timeout" and result.error["reason"] == "cpu", result.error
