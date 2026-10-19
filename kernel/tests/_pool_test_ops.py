"""Worker ops used only by the run-pool tests (imported by workers via their ``module:function`` ref)."""

from __future__ import annotations

import os
import sys
import time
from typing import Any

from kernel.run_ops import PREVIEW, RUN, worker_op


def _snapshot(runtime: Any) -> dict:
    return {"pid": os.getpid(), "cwd": os.getcwd(), "served": runtime.served if runtime else None}


@worker_op("t_echo", lane=PREVIEW, takes_runtime=True)
def echo(runtime, args):
    if args.get("say"):
        print(args["say"])
    if args.get("err"):
        print(args["err"], file=sys.stderr)
    return {**_snapshot(runtime), "args": args, "path": list(sys.path), "env": sorted(os.environ)}, None


@worker_op("t_echo_run", lane=RUN, takes_runtime=True)
def echo_run(runtime, args):
    return _snapshot(runtime), None


@worker_op("t_sleep", lane=PREVIEW, takes_runtime=True)
def sleep(runtime, args):
    time.sleep(float(args.get("seconds", 1)))
    return _snapshot(runtime), None


@worker_op("t_sleep_run", lane=RUN, takes_runtime=True)
def sleep_run(runtime, args):
    time.sleep(float(args.get("seconds", 1)))
    return _snapshot(runtime), None


@worker_op("t_spin", lane=RUN, takes_runtime=True)
def spin(runtime, args):
    while True:
        pass


@worker_op("t_exit", lane=RUN, takes_runtime=True)
def hard_exit(runtime, args):
    os._exit(int(args.get("code", 3)))


@worker_op("t_exit_preview", lane=PREVIEW, takes_runtime=True)
def hard_exit_preview(runtime, args):
    os._exit(int(args.get("code", 3)))


@worker_op("t_alloc", lane=RUN, takes_runtime=True)
def alloc(runtime, args):
    import numpy as np

    block = np.ones(int(args.get("mb", 64)) * 1024 * 1024 // 8)
    time.sleep(float(args.get("hold", 5)))
    return {"sum": float(block[:10].sum())}, None


@worker_op("t_flood", lane=RUN, takes_runtime=True)
def flood(runtime, args):
    for i in range(int(args.get("lines", 100_000))):
        print("line", i)
    return {}, None


@worker_op("t_run_code", lane=PREVIEW, takes_runtime=True)
def run_code(runtime, args):
    program = runtime.load_program(args["code"])
    ns = {k: v for k, v in program.namespace.items() if k.startswith("out_") and isinstance(v, (str, int, float, bool, list, dict, type(None)))}
    return {"error": program.error, "ns": ns, "cache": runtime.stats.cache, "exec_count": runtime.stats.exec_count,
            "deps": len(program.deps), "pid": os.getpid()}, None


@worker_op("t_run_code_run", lane=RUN, takes_runtime=True)
def run_code_run(runtime, args):
    program = runtime.load_program(args["code"])
    ns = {k: v for k, v in program.namespace.items() if k.startswith("out_") and isinstance(v, (str, int, float, bool, list, dict, type(None)))}
    return {"error": program.error, "ns": ns, "figures": len(program.figures)}, None


@worker_op("t_probe", lane=PREVIEW, takes_runtime=True)
def probe(runtime, args):
    import builtins
    import logging

    import numpy as np

    return {
        "env_x": os.environ.get("RB_TEST_X"), "printoptions": np.get_printoptions()["precision"],
        "log_handlers": len(logging.root.handlers), "builtin_flag": hasattr(builtins, "rb_flag"),
        "modules": sorted(m for m in sys.modules if m.startswith("rb_")), "cwd": os.getcwd(), "pid": os.getpid(),
        "threads": __import__("threading").active_count(),
    }, None


@worker_op("t_msg_op", lane=PREVIEW, cached=True, wall_s=20.0, error_mapper=lambda exc: {"code": "mapped", "message": str(exc)})
def msg_op(msg):
    if msg.get("boom"):
        raise ValueError("boom")
    return {"ok": True, "echo": msg.get("value")}
