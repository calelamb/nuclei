"""Registry of the operations a run worker can perform (design note section 2.4).

``@worker_op`` registers a function under a name, a lane (``"preview"``: one reusable worker that
owns the loaded-circuit cache; ``"run"``: a fresh one-shot process) and a default wall-clock limit.
The worker resolves a request's ``op`` here and refuses anything that is not registered, so the
control channel cannot be used to call arbitrary functions.

Two calling conventions:

* runtime ops (``takes_runtime=True``): ``fn(runtime, args) -> (reply, error)`` — the built-in
  editor ops in ``kernel.run_ops_builtin``;
* message ops: ``fn(args) -> reply``; an exception is turned into an error dict by
  ``error_mapper`` — the Lab's synchronous handlers.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass
from typing import Any, Callable

PREVIEW = "preview"
RUN = "run"
LANES = (PREVIEW, RUN)


@dataclass(frozen=True)
class OpSpec:
    name: str
    lane: str
    cached: bool
    wall_s: float
    fn: Callable[..., Any]
    error_mapper: Callable[[BaseException], dict] | None = None
    takes_runtime: bool = False
    ref: str = ""  # "module:function", how a worker finds the op

    def invoke(self, runtime: Any, args: dict) -> tuple[Any, dict | None]:
        if self.takes_runtime:
            return self.fn(runtime, args)
        try:
            return self.fn(args), None
        except Exception as exc:  # noqa: BLE001 - mapped to the op's own error shape
            if self.error_mapper is None:
                raise
            return None, self.error_mapper(exc)


_REGISTRY: dict[str, OpSpec] = {}


def worker_op(
    name: str,
    *,
    lane: str = PREVIEW,
    cached: bool = False,
    wall_s: float = 30.0,
    error_mapper: Callable[[BaseException], dict] | None = None,
    takes_runtime: bool = False,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    if lane not in LANES:
        raise ValueError(f"unknown lane {lane!r}")

    def decorate(fn: Callable[..., Any]) -> Callable[..., Any]:
        spec = OpSpec(
            name=name, lane=lane, cached=cached, wall_s=wall_s, fn=fn, error_mapper=error_mapper,
            takes_runtime=takes_runtime, ref=f"{fn.__module__}:{fn.__name__}",
        )
        _REGISTRY[name] = spec
        fn.op_spec = spec  # type: ignore[attr-defined]
        return fn

    return decorate


def spec_of(fn_or_name: Callable[..., Any] | str) -> OpSpec:
    if isinstance(fn_or_name, str):
        try:
            return _REGISTRY[fn_or_name]
        except KeyError:
            raise KeyError(f"unregistered worker op {fn_or_name!r}") from None
    spec = getattr(fn_or_name, "op_spec", None)
    if spec is None:
        raise KeyError(f"{fn_or_name!r} is not decorated with @worker_op")
    return spec


def resolve(op: str) -> OpSpec:
    """Find an op by name or ``module:function`` ref; unregistered functions are refused."""
    if op in _REGISTRY:
        return _REGISTRY[op]
    module_name, _, attr = op.partition(":")
    if attr and module_name:
        fn = getattr(importlib.import_module(module_name), attr, None)
        spec = getattr(fn, "op_spec", None)
        if spec is not None:
            return spec
    raise KeyError(f"unregistered worker op {op!r}")


def registered_ops() -> dict[str, OpSpec]:
    return dict(_REGISTRY)
