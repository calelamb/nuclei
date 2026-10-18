"""Small circuit builders shared by the trainability job tests."""

from __future__ import annotations

from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef


def build(n: int, spec: list[tuple], params: list[str] | None = None) -> ParamCircuit:
    """spec items: (name, qubits) or (name, qubits, angle_or_param_name)."""
    gates = []
    for i, item in enumerate(spec):
        name, qubits, *rest = item
        angles = tuple(ParamRef(a) if isinstance(a, str) else a for a in rest)
        gates.append(IrGate(name, tuple(qubits), angles, i))
    return ParamCircuit(n, gates, params or [], "native", [])


def deep_random(n: int, layers: int) -> ParamCircuit:
    """RY-RZ-RY rotations on every qubit then a CZ ring, repeated."""
    spec: list[tuple] = []
    params: list[str] = []
    for layer in range(layers):
        for q in range(n):
            for axis in ("RY", "RZ", "RY"):
                name = f"t{len(params)}"
                params.append(name)
                spec.append((axis, (q,), name))
        for q in range(n):
            if n > 1:
                spec.append(("CZ", (q, (q + 1) % n)))
    return build(n, spec, params)


def ghz(n: int) -> ParamCircuit:
    return build(n, [("H", (0,))] + [("CX", (q, q + 1)) for q in range(n - 1)])


# ------------------------------------------------------------------ fakes

import asyncio  # noqa: E402
import contextlib  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import textwrap  # noqa: E402
import time  # noqa: E402
from pathlib import Path  # noqa: E402

FAKE_MODULE = "fake_trn_analyses"
FAKE_SOURCE = textwrap.dedent('''
    import time

    HANG_SEED = 777
    BOOM_SEED = 888


    def gradient_statistics(circuit, observable, *, samples, seed, init, method, backend, progress, cancel):
        progress(0.5, "half way")
        if seed == HANG_SEED:
            time.sleep(600)
        if seed == BOOM_SEED:
            raise RuntimeError("boom in gradients")
        return {"samples": samples, "init": init, "method": method, "backend": backend,
                "n_qubits": circuit.n_qubits, "observable": observable.to_text(), "per_parameter": []}


    def scaling_study(build, *, qubits, layers, observable_spec, samples, seed, init, method, backend,
                      progress, cancel):
        points = []
        for n in qubits:
            for layer in layers:
                circuit = build(n, layer)
                points.append({"n_qubits": circuit.n_qubits, "n_layers": layer,
                               "n_params": len(circuit.parameters)})
        return {"points": points, "fits": [], "observable_spec": observable_spec}


    def lie_algebra(circuit, *, observable, max_dimension, time_budget_s, progress, cancel):
        return {"status": "complete", "dimension": 3, "max_dimension": max_dimension,
                "time_budget_s": time_budget_s}
''')

QISKIT_CODE = (
    "from qiskit import QuantumCircuit\n"
    "from qiskit.circuit import Parameter\n"
    "n = int(params.get('n_qubits', 2))\n"
    "layers = int(params.get('n_layers', 1))\n"
    "qc = QuantumCircuit(n)\n"
    "for layer in range(layers):\n"
    "    for q in range(n):\n"
    "        qc.ry(Parameter(f'a{layer}_{q}'), q)\n"
    "    for q in range(n - 1):\n"
    "        qc.cz(q, q + 1)\n"
)


def write_fake_analyses(directory: Path) -> Path:
    path = directory / f"{FAKE_MODULE}.py"
    path.write_text(FAKE_SOURCE, encoding="utf-8")
    return path


class StreamingWS:
    """Drives ``server._handle_connection`` like a live websocket."""

    def __init__(self) -> None:
        self._incoming: asyncio.Queue = asyncio.Queue()
        self.sent: list[dict] = []
        self._activity = asyncio.Event()

    def push(self, message: dict) -> None:
        self._incoming.put_nowait(json.dumps(message))

    def close(self) -> None:
        self._incoming.put_nowait(None)

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self._incoming.get()
        if item is None:
            raise StopAsyncIteration
        return item

    async def send(self, raw: str) -> None:
        self.sent.append(json.loads(raw))
        self._activity.set()

    def types(self) -> list[str]:
        return [m.get("type") for m in self.sent]

    async def wait_for(self, predicate, timeout: float = 180.0) -> list[dict]:
        deadline = time.monotonic() + timeout
        while True:
            match = [m for m in self.sent if predicate(m)]
            if match:
                return match
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"no message matched within {timeout}s; got {self.types()}")
            self._activity.clear()
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self._activity.wait(), timeout=min(remaining, 0.25))

    async def wait_type(self, msg_type: str, timeout: float = 180.0) -> dict:
        return (await self.wait_for(lambda m: m.get("type") == msg_type, timeout))[0]


@contextlib.asynccontextmanager
async def connection():
    """Open a fake connection; closing it runs the server's owner release."""
    from kernel import server

    ws = StreamingWS()
    task = asyncio.create_task(server._handle_connection(ws))
    try:
        yield ws
    finally:
        ws.close()
        await asyncio.wait_for(task, timeout=120)


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def wait_gone(pids: list[int], timeout: float = 60.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not any(pid_alive(p) for p in pids):
            return True
        time.sleep(0.05)
    return False
