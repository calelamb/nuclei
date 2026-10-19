"""Fixtures and helpers for tests that drive the run-worker pool."""

from __future__ import annotations

import dataclasses
import itertools
import threading
from typing import Any

import pytest

from kernel import run_worker
from kernel.run_ops import PREVIEW, RUN
from kernel.run_worker import PoolConfig, RunPool, RunRequest

OPS = "kernel.tests._pool_test_ops:"
_owners = itertools.count(1000)


class CollectingSink:
    def __init__(self) -> None:
        self.chunks: list[tuple[str, str]] = []
        self.dropped = 0
        self._lock = threading.Lock()

    def output(self, stream: str, text: str) -> None:
        with self._lock:
            self.chunks.append((stream, text))

    def truncated(self, dropped_bytes: int) -> None:
        self.dropped = dropped_bytes

    def text(self, stream: str = "stdout") -> str:
        return "".join(t for s, t in self.chunks if s == stream)


def request(op: str, args: dict | None = None, *, lane: str | None = None, wall_s: float = 20.0,
            ctx: dict | None = None, run_id: str | None = None, owner: int | None = None,
            coalesce: str | None = None, streaming: bool = True) -> RunRequest:
    chosen = lane or (RUN if op.endswith("_run") or op in ("t_spin", "t_exit", "t_alloc", "t_flood") else PREVIEW)
    return RunRequest(
        op=OPS + {"t_echo": "echo", "t_echo_run": "echo_run", "t_sleep": "sleep", "t_sleep_run": "sleep_run",
                  "t_spin": "spin", "t_exit": "hard_exit", "t_exit_preview": "hard_exit_preview", "t_alloc": "alloc",
                  "t_flood": "flood", "t_run_code": "run_code", "t_run_code_run": "run_code_run", "t_probe": "probe",
                  "t_msg_op": "msg_op"}[op],
        owner=owner if owner is not None else next(_owners), args=args or {}, ctx=ctx or {}, run_id=run_id,
        lane=chosen, wall_s=wall_s, coalesce=coalesce, streaming=streaming,
    )


def call(pool: RunPool, op: str, args: dict | None = None, *, timeout: float = 60.0, sink: Any = None, **kwargs: Any):
    return pool.submit(request(op, args, **kwargs), sink).result(timeout=timeout)


def make_pool(**overrides: Any) -> RunPool:
    config = dataclasses.replace(PoolConfig.from_env(), **overrides)
    pool = RunPool(config)
    pool.start()
    return pool


@pytest.fixture(scope="module")
def pool():
    instance = make_pool()
    try:
        yield instance
    finally:
        instance.shutdown()


@pytest.fixture
def isolated_pool():
    """Build pools with custom limits; every one is shut down at the end of the test."""
    made: list[RunPool] = []

    def build(**overrides: Any) -> RunPool:
        instance = make_pool(**overrides)
        made.append(instance)
        return instance

    yield build
    for instance in made:
        instance.shutdown()
    run_worker.shutdown_pool()


@pytest.fixture
def inprocess_mode():
    """Run the Lab's message ops (``call_op``) in the test process, so a test can monkeypatch the code they call.

    Production never does this: ``server.main()`` forbids in-process execution of user code.
    """
    run_worker.set_inprocess_ops(True)
    yield
    run_worker.set_inprocess_ops(False)
