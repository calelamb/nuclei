# Dirac Isolated Agent Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run each model-generated parse or simulation request in a disposable, credential-free worker with enforced and self-tested filesystem, environment, network, subprocess, resource, output, timeout, and cancellation boundaries.

**Architecture:** `createAgentSandboxSession` invokes one Tauri command per request and never calls the long-lived WebSocket kernel. Rust validates a versioned request, requires a qualified OS sandbox and descendant-containment primitive, launches a fresh worker only through that qualified platform backend, treats every worker byte as untrusted, and reaps the worker on every terminal path. The worker applies rlimits before constructing the existing `Executor`, checks the declared framework against its lexical adapter selection for routing correctness, cooperatively emits a capped versioned JSON object, and exits; Rust remains authoritative for raw-byte caps and exact-one-JSON framing, while the common boundary matrix covers every installed framework package regardless of lexical selection. macOS uses Seatbelt with fork/exec denial, Linux requires bubblewrap plus delegated cgroup v2 and seccomp, and Windows/web fail closed.

**Tech Stack:** Tauri 2, Rust 2021, serde, Tokio, macOS `sandbox-exec`, Linux bubblewrap/cgroup v2/seccomp-BPF/rlimit, Python 3.10+, existing quantum adapters, TypeScript 5.9, Vitest 4, pytest.

---

## Locked scope and truthful claims

This plan implements Stage 0 from `docs/superpowers/specs/2026-07-09-dirac-agentic-quantum-runtime-design.md` and supplies the exact `src/services/agentSandboxSession.ts` prerequisite consumed by `docs/superpowers/plans/2026-07-09-dirac-closed-loop-simulator-agent.md`.

- Generated source never enters `kernel/server.py`, its credential-bearing `HardwareManager`, or `createKernelSession`.
- The dedicated environment is `<app-data>/agent-runtime/v1`, not `<app-data>/venv`. Its manifest excludes keyring, provider SDKs, and CUDA-Q. Every framework package that is installed in this runtime must pass the common OS boundary matrix before capability can become available.
- Request source is at most 262,144 UTF-8 bytes. Simulation shots are 1–10,000.
- The worker lexically selects an adapter without execution and rejects an ordinary declared/selected routing mismatch with `framework_mismatch` before loading an adapter or running source. This is a correctness check, not package confinement: comments and dynamic imports can differ from the selected adapter.
- macOS is available only after mandatory Seatbelt probes pass.
- Linux is available only after mandatory bwrap, cgroup v2, rlimit, seccomp, and boundary probes pass.
- Windows and web are unavailable in Stage 0.
- Once every installed framework package has common boundary evidence, `qualifiedFrameworks` controls which of Qiskit, Cirq, and Q# have functional/API exposure. A package lacking common boundary evidence may not remain installed and merely be omitted from `qualifiedFrameworks`; capability fails closed instead. Dynamic cross-import among installed packages is therefore boundary-qualified rather than treated as a lexical-policy bypass. CUDA-Q remains absent from the dedicated runtime.
- A matching `request_id` is correlation only, never an integrity guarantee. Rust caps raw stdout/stderr before decoding, validates UTF-8, one-object JSON framing, protocol version, exact fields, value bounds, and response shape, and uses worker data only as untrusted simulation evidence.
- If environment cleanup, resource isolation, a mandatory probe, or cleanup verification cannot be enforced, capability remains unavailable. No partial-control mode is exposed.

## File map

### Python
- Create `kernel/agent_protocol.py` — strict v1 worker protocol.
- Create `kernel/agent_limits.py` — rlimits and byte-bounded captures.
- Create `kernel/agent_worker.py` — one-request worker.
- Create `kernel/agent-requirements.txt` — dedicated environment allowlist.
- Create `kernel/tests/test_agent_protocol.py`.
- Create `kernel/tests/test_agent_worker.py`.
- Modify `kernel/executor.py` — optional capture factory plus non-executing lexical adapter selection used to catch routing mismatches before execution.
- Modify `kernel/tests/test_executor.py`.
- Modify `kernel/adapters/qsharp_adapter.py` — public disposable-worker mode that keeps one-request QDK work on the caller thread.
- Modify `kernel/tests/test_qsharp_adapter.py` — disposable-worker mode coverage.

### Rust
- Create `src-tauri/src/agent_runtime/mod.rs`.
- Create `src-tauri/src/agent_runtime/protocol.rs`.
- Create `src-tauri/src/agent_runtime/resources.rs`.
- Create `src-tauri/src/agent_runtime/process.rs`.
- Create `src-tauri/src/agent_runtime/macos.rs`.
- Create `src-tauri/src/agent_runtime/linux.rs`.
- Create `src-tauri/src/agent_runtime/unsupported.rs`.
- Create `src-tauri/src/commands/agent_runtime.rs`.
- Create `src-tauri/tests/agent_runtime_contract.rs`.
- Create `src-tauri/tests/agent_runtime_boundary.rs`.
- Modify `src-tauri/src/commands/mod.rs`.
- Modify `src-tauri/src/lib.rs`.
- Modify `src-tauri/Cargo.toml`.
- Modify `src-tauri/tauri.conf.json`.

### Frontend and CI
- Create `src/services/agentSandboxSession.ts`.
- Create `src/services/agentSandboxSession.test.ts`.
- Create `.github/workflows/agent-sandbox-tests.yml`.
- Modify `.github/workflows/release.yml`.

---

### Task 1: Implement the strict Python protocol

**Files:**
- Create: `kernel/agent_protocol.py`
- Create: `kernel/tests/test_agent_protocol.py`

- [ ] **Step 1: Write failing protocol tests**

```python
# kernel/tests/test_agent_protocol.py
import json
import pytest
from kernel.agent_protocol import MAX_CODE_BYTES, ProtocolError, parse_request, response_bytes


def request(**changes):
    value = {
        "protocol_version": 1,
        "request_id": "r-1",
        "action": "simulate",
        "framework": "cirq",
        "language": "python",
        "code": "import cirq\ncircuit = cirq.Circuit()",
        "shots": 128,
    }
    value.update(changes)
    return json.dumps(value).encode()


def test_accepts_exact_v1_request():
    parsed = parse_request(request())
    assert (parsed.framework, parsed.shots) == ("cirq", 128)


@pytest.mark.parametrize("raw", [
    request(protocol_version=2),
    request(extra=True),
    request(framework="cuda-q"),
    request(shots=0),
    request(shots=10_001),
    request(action="parse", shots=1),
    request(framework="qsharp", language="python"),
    b"{not-json",
])
def test_rejects_invalid_protocol(raw):
    with pytest.raises(ProtocolError):
        parse_request(raw)


def test_enforces_256_kib_utf8_source():
    parse_request(request(code="é" * (MAX_CODE_BYTES // 2)))
    with pytest.raises(ProtocolError, match="code_too_large"):
        parse_request(request(code="é" * (MAX_CODE_BYTES // 2 + 1)))


def test_response_is_one_compact_json_line():
    raw = response_bytes("r-1", "ok", None, None, "", "", None)
    assert raw.count(b"\n") == 1 and raw.endswith(b"\n")
    assert json.loads(raw)["protocol_version"] == 1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest kernel/tests/test_agent_protocol.py -v`

Expected: FAIL during collection with `ModuleNotFoundError: No module named 'kernel.agent_protocol'`.

- [ ] **Step 3: Implement the protocol**

```python
# kernel/agent_protocol.py
from __future__ import annotations
import json
import re
from dataclasses import dataclass
from typing import Any, Literal

PROTOCOL_VERSION = 1
MAX_REQUEST_BYTES = 270_000
MAX_CODE_BYTES = 256 * 1024
MAX_SHOTS = 10_000
_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class ProtocolError(ValueError):
    pass


@dataclass(frozen=True)
class AgentRequest:
    request_id: str
    action: Literal["parse", "simulate"]
    framework: Literal["qiskit", "cirq", "qsharp"]
    language: Literal["python", "qsharp"]
    code: str
    shots: int | None


def parse_request(raw: bytes) -> AgentRequest:
    if len(raw) > MAX_REQUEST_BYTES:
        raise ProtocolError("request_too_large")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProtocolError("malformed_json") from exc
    if not isinstance(value, dict):
        raise ProtocolError("request_must_be_object")
    allowed = {"protocol_version", "request_id", "action", "framework", "language", "code", "shots"}
    if set(value) - allowed:
        raise ProtocolError("unknown_field")
    if not {"protocol_version", "request_id", "action", "framework", "language", "code"} <= set(value):
        raise ProtocolError("missing_field")
    if value["protocol_version"] != PROTOCOL_VERSION:
        raise ProtocolError("unsupported_version")
    request_id, action, framework = value["request_id"], value["action"], value["framework"]
    language, code, shots = value["language"], value["code"], value.get("shots")
    if not isinstance(request_id, str) or not _ID.fullmatch(request_id):
        raise ProtocolError("invalid_request_id")
    if action not in {"parse", "simulate"}:
        raise ProtocolError("invalid_action")
    if framework not in {"qiskit", "cirq", "qsharp"}:
        raise ProtocolError("framework_unavailable")
    if language != ("qsharp" if framework == "qsharp" else "python"):
        raise ProtocolError("framework_language_mismatch")
    if not isinstance(code, str):
        raise ProtocolError("invalid_code")
    if len(code.encode("utf-8")) > MAX_CODE_BYTES:
        raise ProtocolError("code_too_large")
    if action == "parse" and shots is not None:
        raise ProtocolError("parse_forbids_shots")
    if action == "simulate" and (type(shots) is not int or not 1 <= shots <= MAX_SHOTS):
        raise ProtocolError("invalid_shots")
    return AgentRequest(request_id, action, framework, language, code, shots)


def response_bytes(
    request_id: str,
    status: Literal["ok", "error"],
    snapshot: dict[str, Any] | None,
    result: dict[str, Any] | None,
    stdout: str,
    stderr: str,
    error: dict[str, Any] | None,
) -> bytes:
    value = {
        "protocol_version": 1, "request_id": request_id, "status": status,
        "snapshot": snapshot, "result": result, "stdout": stdout,
        "stderr": stderr, "error": error,
    }
    return json.dumps(value, separators=(",", ":"), allow_nan=False).encode("utf-8") + b"\n"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest kernel/tests/test_agent_protocol.py -v`

Expected: PASS, including byte-based source and 10,000-shot limits.

- [ ] **Step 5: Commit**

```bash
git add kernel/agent_protocol.py kernel/tests/test_agent_protocol.py
git commit -m "feat: define isolated agent protocol"
```

### Task 2: Implement bounded execution and the disposable worker

**Files:**
- Create: `kernel/agent_limits.py`
- Create: `kernel/agent_worker.py`
- Create: `kernel/tests/test_agent_worker.py`
- Modify: `kernel/executor.py` — bounded capture and public non-executing lexical adapter selection for routing correctness.
- Modify: `kernel/tests/test_executor.py`
- Modify: `kernel/adapters/qsharp_adapter.py`
- Modify: `kernel/tests/test_qsharp_adapter.py`

- [ ] **Step 1: Write failing worker tests with all test helpers defined first**

```python
# kernel/tests/test_agent_worker.py
import json
import os
from pathlib import Path
import subprocess
import sys
import pytest

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "kernel" / "agent_worker.py"


def make_request(code, *, action="parse", framework="cirq", language="python", shots=None):
    value = {
        "protocol_version": 1, "request_id": "test-1", "action": action,
        "framework": framework, "language": language, "code": code,
    }
    if shots is not None:
        value["shots"] = shots
    return value


def run_worker_process(value, timeout=5):
    env = {
        "PATH": os.environ.get("PATH", ""),
        "LANG": "C.UTF-8",
        "PYTHONNOUSERSITE": "1",
        "QDK_PYTHON_TELEMETRY": "none",
    }
    completed = subprocess.run(
        [sys.executable, "-I", str(WORKER), "--test-limits"],
        input=json.dumps(value).encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=env, cwd=ROOT, timeout=timeout, check=False,
    )
    return completed


def run_worker(value, timeout=5):
    completed = run_worker_process(value, timeout)
    assert completed.stdout.count(b"\n") == 1
    return completed, json.loads(completed.stdout)


def test_cooperative_print_flood_returns_one_capped_response():
    completed, response = run_worker(make_request(
        "print('x' * 1_000_000)\nimport cirq\ncircuit = cirq.Circuit()"
    ))
    assert completed.stdout.count(b"\n") == 1
    assert len(response["stdout"].encode()) <= 65_536


def test_raw_fd_write_proves_worker_framing_is_not_authoritative():
    completed = run_worker_process(make_request(
        "import os\nos.write(1, b'INJECTED\\n')\nimport cirq\ncircuit = cirq.Circuit()"
    ))
    assert completed.stdout.startswith(b"INJECTED\n")
    assert completed.stdout.count(b"\n") == 2


def test_adapter_selection_mismatch_does_not_execute_source(tmp_path):
    marker = tmp_path / "executed"
    response = run_worker(make_request(
        f"open({str(marker)!r}, 'w').close()\nfrom qiskit import QuantumCircuit",
        framework="cirq",
    ))[1]
    assert response["error"]["code"] == "framework_mismatch"
    assert not marker.exists()


def test_worker_rejects_malformed_input_without_executor():
    completed = subprocess.run(
        [sys.executable, "-I", str(WORKER), "--test-limits"],
        input=b"{bad", stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8"}, timeout=5,
    )
    response = json.loads(completed.stdout)
    assert response["error"]["code"] == "protocol_error"


def test_worker_blocks_sensitive_import_attempts():
    source = """\
import importlib
for name in ("keyring", "kernel.server", "kernel.hardware",
             "qiskit_ibm_runtime", "braket", "azure.quantum",
             "qiskit_ionq", "pytket", "cudaq"):
    try:
        importlib.import_module(name)
    except ImportError as exc:
        print(f"{name}:{exc}")
import cirq
circuit = cirq.Circuit()
"""
    _, response = run_worker(make_request(source))
    assert "blocked in the disposable agent worker" in response["stdout"]


def test_qsharp_worker_is_fresh_after_normal_exit():
    pytest.importorskip("qdk")
    source = "operation Main() : Result[] { use q = Qubit(); H(q); return [MResetZ(q)]; }"
    first = run_worker(make_request(source, action="simulate", framework="qsharp",
                                   language="qsharp", shots=4), timeout=15)[1]
    second = run_worker(make_request(source, action="simulate", framework="qsharp",
                                    language="qsharp", shots=4), timeout=15)[1]
    assert first["status"] == second["status"] == "ok"
```

```python
# append to kernel/tests/test_executor.py
def test_optional_capture_limit_does_not_change_default_executor():
    bounded = Executor(capture_limit_bytes=16)
    stdout, stderr, error = bounded.run_python(
        "import sys\nprint('x' * 100)\nprint('y' * 100, file=sys.stderr)"
    )
    assert error is None
    assert len(stdout.encode()) <= 16 and len(stderr.encode()) <= 16
    assert Executor().run_python("print('complete')")[0] == "complete\n"


def test_resolve_framework_is_lexical_selection_not_import_confinement():
    code = (
        "# import qiskit\n"
        "import importlib\n"
        "cirq = importlib.import_module('cirq')\n"
    )

    framework = Executor().resolve_framework(code, language="python")

    assert framework == "qiskit"
```

```python
# append to kernel/tests/test_qsharp_adapter.py
def test_disposable_worker_runs_qdk_operation_and_exit_cleanup_on_calling_thread(
    monkeypatch,
):
    from qdk import _interpreter as qdk_interpreter

    monkeypatch.setattr(qsharp_adapter, "_DISPOSABLE_WORKER", False, raising=False)
    disposal_threads: list[int] = []
    monkeypatch.setattr(
        qdk_interpreter,
        "_clear_code_module",
        lambda: disposal_threads.append(threading.get_ident()),
    )
    monkeypatch.setattr(qdk_interpreter, "_default_context", object())
    caller_thread = threading.get_ident()

    qsharp_adapter.configure_disposable_worker()
    operation_thread = qsharp_adapter._on_interpreter_thread(threading.get_ident)
    qsharp_adapter._dispose_qdk_thread_state()

    assert operation_thread == caller_thread
    assert disposal_threads == [caller_thread]
    assert qdk_interpreter._default_context is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest kernel/tests/test_agent_worker.py kernel/tests/test_executor.py::test_optional_capture_limit_does_not_change_default_executor kernel/tests/test_qsharp_adapter.py::test_disposable_worker_runs_qdk_operation_and_exit_cleanup_on_calling_thread -v`

Expected: FAIL because the worker/limits files, `capture_limit_bytes`, and public Q# disposable-worker configuration do not exist.

- [ ] **Step 3: Implement limits and bounded capture**

```python
# kernel/agent_limits.py
import io
import resource
from dataclasses import dataclass


@dataclass(frozen=True)
class WorkerLimits:
    cpu_seconds: int = 10
    address_space_bytes: int = 1_073_741_824
    file_bytes: int = 1_048_576
    open_files: int = 64
    processes: int = 4
    output_bytes: int = 65_536

    @classmethod
    def testing(cls):
        return cls(cpu_seconds=2, address_space_bytes=536_870_912, open_files=32)


class BoundedTextCapture(io.TextIOBase):
    def __init__(self, limit):
        self.limit, self.data, self.truncated = limit, bytearray(), False

    def write(self, text):
        if self.truncated:
            return len(text)
        encoded = text.encode("utf-8", errors="replace")
        remaining = max(0, self.limit - len(self.data))
        self.truncated = len(encoded) > remaining
        prefix = encoded[:remaining].decode("utf-8", errors="ignore")
        self.data.extend(prefix.encode("utf-8"))
        return len(text)

    def getvalue(self):
        return self.data.decode("utf-8")


def apply_worker_limits(value):
    for resource_id, limit in [
        (resource.RLIMIT_CPU, value.cpu_seconds),
        (resource.RLIMIT_AS, value.address_space_bytes),
        (resource.RLIMIT_FSIZE, value.file_bytes),
        (resource.RLIMIT_NOFILE, value.open_files),
        (resource.RLIMIT_NPROC, value.processes),
        (resource.RLIMIT_CORE, 0),
    ]:
        resource.setrlimit(resource_id, (limit, limit))
```

These unit tests verify rlimit configuration calls only. Later macOS/Linux boundary qualification must prove real kernel enforcement. Modify `Executor.__init__` to store `capture_limit_bytes`; add `_new_capture()` returning `io.StringIO()` by default and lazily importing `BoundedTextCapture(limit)` only when configured; replace both `io.StringIO()` constructions in `_run_code` with `_new_capture()`. Add public `resolve_framework(code, language=language)` that lexically selects an adapter without importing or executing source. Its mismatch response prevents ordinary routing errors from executing, but comments and dynamic imports make it unsuitable for package confinement; Task 7 qualifies every installed framework package against the common OS boundary matrix. No server call site passes the capture option.

- [ ] **Step 4: Implement the worker security functions and complete entry point**

```python
# Focused security functions from kernel/agent_worker.py.
from __future__ import annotations
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from kernel.agent_limits import WorkerLimits, apply_worker_limits
from kernel.agent_protocol import ProtocolError, parse_request, response_bytes

MAX_RESPONSE_BYTES = 1_048_576
BLOCKED_IMPORTS = (
    "keyring", "kernel.server", "kernel.hardware", "qiskit_ibm_runtime",
    "braket", "azure.quantum", "qiskit_ionq", "pytket", "cudaq",
)


class BlockedImportFinder:
    def find_spec(self, fullname, path=None, target=None):
        if any(fullname == name or fullname.startswith(name + ".")
               for name in BLOCKED_IMPORTS):
            raise ImportError(
                f"Import of {fullname} is blocked in the disposable agent worker."
            )
        return None


def install_import_blocker():
    for loaded in tuple(sys.modules):
        if any(loaded == name or loaded.startswith(name + ".")
               for name in BLOCKED_IMPORTS):
            del sys.modules[loaded]
    sys.meta_path.insert(0, BlockedImportFinder())


def bounded_response(request_id, status, snapshot, result, stdout, stderr, error):
    candidate = response_bytes(
        request_id, status, snapshot, result, stdout, stderr, error
    )
    if len(candidate) < MAX_RESPONSE_BYTES:
        return candidate
    replacement = response_bytes(request_id, "error", None, None, "", "", {
        "code": "response_too_large",
        "message": "Worker response exceeded the byte limit.",
    })
    assert len(replacement) < MAX_RESPONSE_BYTES
    return replacement

def execute_request(request, limits):
    from kernel.executor import Executor
    executor = Executor(capture_limit_bytes=limits.output_bytes)
    selected = executor.resolve_framework(request.code, language=request.language)
    # Correctness check only; lexical selection cannot confine dynamic imports.
    if selected != request.framework:
        return bounded_response(request.request_id, "error", None, None, "", "", {
            "code": "framework_mismatch",
            "message": "Declared framework and selected adapter differ.",
            "framework": selected,
        })

    if request.language == "python":
        install_import_blocker()
    if request.framework == "qsharp":
        from kernel.adapters.qsharp_adapter import configure_disposable_worker
        configure_disposable_worker()

    if request.action == "parse":
        snapshot, stdout, stderr, error = executor.parse(
            request.code, language=request.language
        )
        result = None
    else:
        result, snapshot, stdout, stderr, error = executor.execute(
            request.code, request.shots, language=request.language
        )
    return bounded_response(
        request.request_id,
        "error" if error else "ok",
        snapshot.to_dict() if snapshot else None,
        result.to_dict() if result else None,
        truncate_utf8(stdout, limits.output_bytes),
        truncate_utf8(stderr, limits.output_bytes),
        error.to_dict() if error else None,
    )

# Cooperative capture is not a framing boundary: generated code can call
# os.write(1, raw_bytes) or mutate Python import hooks. The Rust supervisor MUST
# cap raw stdout bytes, require exactly one JSON response, and enforce the OS sandbox.
```

Complete `kernel/agent_worker.py` around those focused functions as follows: its module docstring states that Python capture/import hooks are cooperative, lexical adapter selection is only a correctness check, and Rust raw-byte/framing validation plus the OS sandbox are authoritative; startup pins OpenBLAS/OMP to one thread and adds the repository root before kernel imports; `truncate_utf8` returns a valid UTF-8 prefix within its byte limit. `main()` parses only `--test-limits`, chooses production or testing limits, applies all rlimits before importing `Executor`, reads at most 270,001 stdin bytes, and initializes the response request ID to `invalid`. It strictly parses one request, delegates valid requests to `execute_request`, converts `ProtocolError` to `protocol_error`, converts every other `BaseException` to a generic `worker_error` containing only the exception type, and creates every response through `bounded_response`. It then writes the selected response bytes once to `sys.stdout.buffer`, flushes, returns zero, and is invoked through `raise SystemExit(main())`. In `kernel/adapters/qsharp_adapter.py`, add public `configure_disposable_worker()` and make both `_on_interpreter_thread` and `_dispose_qdk_thread_state` run directly on the caller after one-request mode is configured; persistent-kernel operation and disposal remain on the dedicated QDK thread.

- [ ] **Step 5: Run worker, executor, and Q# adapter tests**

Run: `python -m pytest kernel/tests/test_agent_worker.py kernel/tests/test_executor.py kernel/tests/test_qsharp_adapter.py -v`

Expected: PASS; cooperative output and the whole serialized response are byte-capped, ordinary adapter-selection mismatches cannot execute source, lexical-bypass behavior is characterized without a security claim, blocked imports fail as defense in depth, Q# operation and disposal preserve caller-thread affinity in public disposable-worker mode, and the ordinary kernel remains uncapped. The adversarial raw-fd test deliberately proves that Python alone cannot guarantee framing; Task 4's Rust supervisor is authoritative for the 1,048,576-byte raw stdout cap and exact-one-JSON validation.

- [ ] **Step 6: Commit**

```bash
git add kernel/agent_limits.py kernel/agent_worker.py kernel/executor.py kernel/adapters/qsharp_adapter.py kernel/tests/test_agent_worker.py kernel/tests/test_executor.py kernel/tests/test_qsharp_adapter.py
git commit -m "feat: add disposable bounded agent worker"
```

### Task 3: Define Rust contracts and dedicated resources

Task 3's implemented contract additionally requires strict typed worker response
payloads, semantic response validation, an OS-visible per-app-data provisioning
lock, fail-closed stale staging/backup cleanup, and an immutable app-owned copy
of the exact requirements bytes supplied to pip. The production
`SystemCommandRunner` is deliberately unavailable and never spawns: a process
group is lifecycle cleanup, not descendant containment because a child can
call `setsid`. Provisioning requires an injected runner whose containment
qualification is explicit; otherwise it returns unavailable before filesystem
mutation. `EnvironmentFilesystem` includes a `set_readonly` operation.

**Files:**
- Create: `kernel/agent-requirements.txt`
- Create: `src-tauri/src/agent_runtime/protocol.rs`
- Create: `src-tauri/src/agent_runtime/resources.rs`
- Create: `src-tauri/src/agent_runtime/mod.rs`
- Create: `src-tauri/src/agent_runtime/unsupported.rs`
- Create: `src-tauri/tests/agent_runtime_contract.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add dependencies**

Run: `cd src-tauri && cargo add tokio --features process,io-util,time,macros,rt-multi-thread,sync && cargo add uuid --features v4 && cargo add sha2 && cargo add hex && cargo add fs2 && cargo add libc --target 'cfg(unix)' && cargo add --dev tempfile`

Expected: dependencies resolve and `Cargo.lock` updates.

Although isolated execution is unavailable on Windows, Tauri's desktop target
still resolves updater/shell dependencies there. Pin `zip = "=4.2.0"` (the
newest 4.x release supporting Rust 1.77; 4.3+ requires 1.82) and
`open = "=5.3.3"` (5.3.4+ uses `std::path::absolute`, unavailable on 1.77) as
Windows-only compatibility constraints. Keep both locked and verify the actual
Windows target with Rust 1.77.2.

- [ ] **Step 2: Write failing public-contract tests without custom helpers**

```rust
// src-tauri/tests/agent_runtime_contract.rs
use app_lib::agent_runtime::protocol::{FrontendRequestV1, WorkerRequestV1};
use app_lib::agent_runtime::resources::{validate_requirements, ResourcePaths};

#[test]
fn frontend_contract_rejects_unknown_fields_cuda_q_and_bounds() {
    for raw in [
        r#"{"protocolVersion":1,"requestId":"r","action":"parse","framework":"cirq","language":"python","code":"","extra":1}"#,
        r#"{"protocolVersion":1,"requestId":"r","action":"parse","framework":"cuda-q","language":"python","code":""}"#,
    ] {
        assert!(serde_json::from_str::<FrontendRequestV1>(raw).is_err());
    }
    let oversized_shots = serde_json::from_str::<FrontendRequestV1>(
        r#"{"protocolVersion":1,"requestId":"r","action":"simulate","framework":"cirq","language":"python","code":"","shots":10001}"#
    ).unwrap();
    assert!(WorkerRequestV1::try_from(oversized_shots).is_err());
}

#[test]
fn worker_request_serializes_snake_case_and_caps_source() {
    let frontend: FrontendRequestV1 = serde_json::from_str(
        r#"{"protocolVersion":1,"requestId":"r","action":"parse","framework":"cirq","language":"python","code":"import cirq"}"#
    ).unwrap();
    let worker = WorkerRequestV1::try_from(frontend).unwrap();
    assert!(serde_json::to_string(&worker).unwrap().contains("\"protocol_version\":1"));
}

#[test]
fn requirements_exclude_credentials_providers_and_cuda_q() {
    let text = include_str!("../../kernel/agent-requirements.txt");
    validate_requirements(text).unwrap();
}

#[test]
fn development_resources_are_canonical_and_complete() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let paths = ResourcePaths::development(root).unwrap();
    assert!(paths.worker.ends_with("kernel/agent_worker.py"));
    assert!(paths.worker.starts_with(&paths.kernel_root));
}
```

- [ ] **Step 3: Run tests to verify failure**

Run: `cd src-tauri && cargo test --test agent_runtime_contract`

Expected: FAIL because the runtime modules and requirements file do not exist.

- [ ] **Step 4: Add the package allowlist**

```text
# kernel/agent-requirements.txt
numpy>=1.26,<3
qiskit>=1.2,<2
qiskit-aer>=0.15,<1
cirq-core>=1.4,<2
qdk>=1.29,<2
```

- [ ] **Step 5: Implement the public Rust protocol**

```rust
// src-tauri/src/agent_runtime/protocol.rs
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Action { Parse, Simulate }
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Framework { Qiskit, Cirq, Qsharp }

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrontendRequestV1 {
    pub protocol_version: u8, pub request_id: String, pub action: Action,
    pub framework: Framework, pub language: String, pub code: String,
    pub shots: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct WorkerRequestV1 {
    pub protocol_version: u8, pub request_id: String, pub action: Action,
    pub framework: Framework, pub language: String, pub code: String,
    pub shots: Option<u32>,
}

impl TryFrom<FrontendRequestV1> for WorkerRequestV1 {
    type Error = String;
    fn try_from(v: FrontendRequestV1) -> Result<Self, Self::Error> {
        let bytes = v.code.as_bytes().len();
        let language = if v.framework == Framework::Qsharp { "qsharp" } else { "python" };
        if v.protocol_version != 1 || v.request_id.is_empty() || v.request_id.len() > 64
            || bytes > 262_144 || v.language != language
            || (v.action == Action::Parse && v.shots.is_some())
            || (v.action == Action::Simulate && !matches!(v.shots, Some(1..=10_000))) {
            return Err("Invalid agent request".into());
        }
        Ok(Self { protocol_version: 1, request_id: v.request_id, action: v.action,
            framework: v.framework, language: v.language, code: v.code, shots: v.shots })
    }
}

#[derive(Debug, Deserialize)] #[serde(deny_unknown_fields)]
pub struct GateV1 {
    #[serde(rename = "type")] pub gate_type: String,
    pub targets: Vec<u32>, pub controls: Vec<u32>, pub params: Vec<f64>, pub layer: u32,
}
#[derive(Debug, Deserialize)] #[serde(deny_unknown_fields)]
pub struct CircuitSnapshotV1 {
    pub framework: Framework, pub qubit_count: u32, pub classical_bit_count: u32,
    pub depth: u32, pub gates: Vec<GateV1>,
}
#[derive(Debug, Deserialize)] #[serde(deny_unknown_fields)]
pub struct ComplexAmplitudeV1 { pub re: f64, pub im: f64 }
#[derive(Debug, Deserialize)] #[serde(deny_unknown_fields)]
pub struct BlochCoordinatesV1 { pub x: f64, pub y: f64, pub z: f64 }
#[derive(Debug, Deserialize)] #[serde(deny_unknown_fields)]
pub struct SimulationResultV1 {
    pub state_vector: Vec<ComplexAmplitudeV1>,
    pub probabilities: std::collections::BTreeMap<String, f64>,
    pub measurements: std::collections::BTreeMap<String, u64>,
    pub bloch_coords: Vec<BlochCoordinatesV1>,
    pub execution_time_ms: f64, pub shot_count: u32,
}
#[derive(Debug, Deserialize)] #[serde(deny_unknown_fields)]
pub struct WorkerErrorV1 {
    pub code: String, pub message: String, pub traceback: Option<String>,
    pub framework: Option<Framework>, pub dependency: Option<String>,
}
#[derive(Debug, Deserialize)] #[serde(rename_all = "lowercase")]
pub enum ResponseStatus { Ok, Error }
pub struct WorkerResponseV1 {
    pub protocol_version: u8, pub request_id: String, pub status: ResponseStatus,
    pub snapshot: Option<CircuitSnapshotV1>, pub result: Option<SimulationResultV1>,
    pub stdout: String, pub stderr: String, pub error: Option<WorkerErrorV1>,
}
```

`WorkerResponseV1` uses a custom strict deserializer so every top-level field is
required even when nullable. It rejects unknown nested fields, non-v1
responses, invalid request IDs, non-finite or out-of-range numeric values,
inconsistent state-vector/Bloch lengths, and contradictory status/error pairs.
`validate(&WorkerRequestV1)` then enforces correlation: response ID and
framework match, parse has no result, successful simulation has snapshot and
result, and returned shots equal requested shots. Parse snapshots permit up to
4,096 qubits/gates; exponential state-vector dimension checks apply only when
a simulation vector is nonempty.
Qiskit/Cirq probability keys have allocated qubit-state width. Q# `Result[]`
may represent repeated measurements or a subset, so its probability width is
independent of allocated qubit count. All probability and measurement keys
must be nonempty binary strings no longer than the explicit 4,096-bit protocol
maximum (well within the 1 MiB response cap). Qiskit measurements may contain
one or more whitespace characters between nonempty binary register segments;
Cirq/Q# keys remain plain binary. Sparse maps are valid because adapters omit
tiny amplitudes: each probability is finite and in `[0,1]`, and a nonempty map
has total `> 0` and at most `1 + tolerance`; it need not sum near one.
Successful Qiskit/Cirq simulation requires a nonempty map, while Q# may return
an empty map when no `Result[]`/dump evidence is available. Measurement totals
cannot exceed requested shots; empty Q# measurements are valid.

- [ ] **Step 6: Implement resource validation and dedicated-environment contract**

```rust
// src-tauri/src/agent_runtime/resources.rs
use std::path::{Path, PathBuf};

pub struct ResourcePaths { pub kernel_root: PathBuf, pub worker: PathBuf, pub requirements: PathBuf }
impl ResourcePaths {
    pub fn development(repo: &Path) -> Result<Self, String>;
    pub fn bundled(resources: &Path) -> Result<Self, String>;
}

const APPROVED_REQUIREMENTS: &str =
    "numpy>=1.26,<3\nqiskit>=1.2,<2\nqiskit-aer>=0.15,<1\ncirq-core>=1.4,<2\nqdk>=1.29,<2\n";
pub fn validate_requirements(text: &str) -> Result<(), String> {
    if text == APPROVED_REQUIREMENTS { Ok(()) }
    else { Err("Agent requirements must exactly match approved constraints".into()) }
}

pub enum RunnerContainment { Unavailable, Contained }
pub trait CommandRunner {
    fn containment(&self) -> RunnerContainment;
    fn run(&self, spec: &CommandSpec) -> Result<CommandOutput, String>;
}
pub struct SystemCommandRunner;
```

Both resource constructors canonicalize the allowed parent, kernel root,
worker, and requirements and reject symlink escapes. `SystemCommandRunner`
returns `Agent isolation is unavailable on this platform` without spawning on
every platform, so production `AgentEnvironment::provision` fails before
mutation. Explicit `provision_with_runner`/`provision_with_filesystem` calls
remain cross-platform for deterministic contained fakes and later qualified
platform runners. Without a real contained runner, capability stays
unavailable.

Add the capability data types to `agent_runtime/mod.rs` now so later platform
tasks implement one stable contract:

```rust
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlResult { pub name: String, pub self_test_passed: bool }
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityReport {
    pub available: bool,
    pub reason: Option<String>,
    pub qualified_frameworks: Vec<String>,
    pub controls: Vec<ControlResult>,
}
#[derive(Clone, Copy)] pub enum QualificationMode { AllowUnavailable, RequireAvailable }
```

Add `AgentEnvironment::provision(app_data, system_python, resources)` in this file:

```rust
pub struct AgentEnvironment { pub root: PathBuf, pub python: PathBuf, pub site_packages: PathBuf }
impl AgentEnvironment {
    pub fn provision(
        app_data: &Path, system_python: &Path, resources: &ResourcePaths,
    ) -> Result<Self, String>;
    pub fn verify(&self) -> Result<(), String>;
}
```

Provisioning creates `<app-data>/agent-runtime`, acquires its OS-visible
exclusive `.provision.lock`, and holds that lock through manifest validation,
stale-state cleanup, staging, promotion, probing, and rollback. Before a
marker-matched root can be reused, both `v1.staging` and `v1.previous` must be
absent or successfully removed. The requirements resource is read once,
validated byte-for-byte, hashed, copied into staging as an app-owned read-only
file, and only that copy is passed to pip.

The venv is created and probed in `v1.staging`; replacement uses explicit
`v1.previous` rollback with every cleanup/restore failure surfaced. Returned
root, Python, and site-packages paths are canonical and contained by the
canonical runtime parent. Every subprocess uses a qualified contained runner;
stderr diagnostics are control-escaped, URL/secret-redacted, and capped. Any
missing containment qualification, lock, cleanup, probe, rollback, or
path-validation error keeps capability unavailable. There is no execution
fallback to system Python or the normal kernel venv.

- [ ] **Step 7: Export modules and run tests**

`mod.rs` exports `protocol`, `resources`, and `unsupported`; `unsupported.rs` returns exactly `Agent isolation is unavailable on this platform`; `lib.rs` exports `pub mod agent_runtime`.

Run: `cd src-tauri && cargo test --test agent_runtime_contract`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add kernel/agent-requirements.txt src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/agent_runtime src-tauri/src/lib.rs src-tauri/tests/agent_runtime_contract.rs
git commit -m "feat: define agent runtime resources"
```

### Task 4: Implement untrusted-byte process supervision

**Files:**
- Create: `src-tauri/src/agent_runtime/process.rs`
- Create: `src-tauri/src/commands/agent_runtime.rs`
- Modify: `src-tauri/src/agent_runtime/protocol.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tests/agent_runtime_contract.rs`

- [ ] **Step 1: Add failing tests using the public `Supervisor` API**

```rust
// append to src-tauri/tests/agent_runtime_contract.rs
use app_lib::agent_runtime::process::{ProcessSpec, ProcessSupervisor, Supervisor, SupervisorLimits};

fn python_spec(script: &str) -> ProcessSpec {
    ProcessSpec {
        executable: std::path::PathBuf::from("/usr/bin/python3"),
        args: vec!["-c".into(), script.into()],
        cwd: std::env::temp_dir(),
        env: std::collections::BTreeMap::new(),
    }
}
fn agent_request(id: &str) -> WorkerRequestV1 { /* valid bounded parse request with request_id=id */ }

#[tokio::test]
async fn raw_bytes_are_capped_before_utf8_or_json_decode() {
    let s = Supervisor::new(SupervisorLimits::testing());
    assert_eq!(s.run(&agent_request("flood"), python_spec("import os; os.write(1,b'x'*5000)"), b"").await.unwrap_err().code, "response_too_large");
    assert_eq!(s.run(&agent_request("utf8"), python_spec("import os; os.write(1,b'\\xff\\n')"), b"").await.unwrap_err().code, "malformed_response");
    assert_eq!(s.run(&agent_request("multi"), python_spec("print('{}'); print('{}')"), b"").await.unwrap_err().code, "malformed_response");
}

#[tokio::test]
async fn timeout_cancel_and_crash_leave_the_next_worker_healthy() {
    let s = std::sync::Arc::new(Supervisor::new(SupervisorLimits::testing()));
    assert_eq!(s.run(&agent_request("timeout"), python_spec("import time; time.sleep(5)"), b"").await.unwrap_err().code, "wall_timeout");
    assert_eq!(s.run(&agent_request("crash"), python_spec("raise SystemExit(2)"), b"").await.unwrap_err().code, "worker_failed");
    let task = {
        let s = s.clone();
        tokio::spawn(async move { s.run(&agent_request("cancel"), python_spec("import time; time.sleep(5)"), b"").await })
    };
    tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    s.cancel("cancel").await.unwrap();
    assert_eq!(task.await.unwrap().unwrap_err().code, "cancelled");
    let valid = r#"{"protocol_version":1,"request_id":"fresh","status":"ok","snapshot":null,"result":null,"stdout":"","stderr":"","error":null}"#;
    assert_eq!(s.run(&agent_request("fresh"), python_spec(&format!("print({valid:?})")), b"").await.unwrap().request_id, "fresh");
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd src-tauri && cargo test --test agent_runtime_contract raw_bytes timeout_cancel -- --nocapture`

Expected: FAIL because `process` does not exist.

- [ ] **Step 3: Implement the public supervisor types**

```rust
// src-tauri/src/agent_runtime/process.rs
use crate::agent_runtime::protocol::{WorkerRequestV1, WorkerResponseV1};
use std::{collections::{BTreeMap, HashMap}, path::PathBuf, sync::{Arc, Mutex}, time::Duration};

pub struct ProcessSpec { pub executable: PathBuf, pub args: Vec<String>, pub cwd: PathBuf, pub env: BTreeMap<String, String> }
#[derive(Clone)] pub struct SupervisorLimits { pub wall: Duration, pub stdout_bytes: usize, pub stderr_bytes: usize }
impl SupervisorLimits {
    pub fn production() -> Self { Self { wall: Duration::from_secs(15), stdout_bytes: 1_048_576, stderr_bytes: 65_536 } }
    pub fn testing() -> Self { Self { wall: Duration::from_millis(100), stdout_bytes: 1024, stderr_bytes: 1024 } }
}
#[derive(Debug)] pub struct RuntimeError { pub code: String, pub message: String }
struct RunToken {
    deadline: tokio::time::Instant,
    state: Mutex<TokenState>,
    cancellation: tokio::sync::Notify,
    completion: tokio::sync::Notify,
}
pub struct RunReservation { /* request ID + token + shared registry, no PID/pgid */ }
pub struct Supervisor { limits: SupervisorLimits, active: Arc<Mutex<HashMap<String, Arc<RunToken>>>> }
impl Supervisor {
    pub fn new(limits: SupervisorLimits) -> Self { Self { limits, active: Mutex::new(HashMap::new()) } }
    pub fn reserve(&self, request_id: &str) -> Result<RunReservation, RuntimeError>;
}
pub trait ProcessSupervisor {
    fn run<'a>(&'a self, request: &'a WorkerRequestV1, spec: ProcessSpec, stdin: &'a [u8])
        -> impl Future<Output = Result<WorkerResponseV1, RuntimeError>> + Send + 'a;
    fn cancel<'a>(&'a self, id: &'a str)
        -> impl Future<Output = Result<(), RuntimeError>> + Send + 'a;
    fn cancel_all(&self) -> impl Future<Output = ()> + Send + '_;
}
```

On qualified Unix platforms, implement `run` with `tokio::process::Command`,
`env_clear`, piped stdio, synchronous reservation in `active` before the
returned future is polled, concurrent
byte-capped stdout/stderr readers, and one absolute deadline covering stdin,
pipe EOF, cancellation, group kill, leader wait, and cleanup. The active map
contains only cancellation/completion tokens; the `run` future and its RAII
guard exclusively own `Child` and the pgid. External cancellation notifies that
owner and waits only until the run deadline. No code signals a pgid after
`child.wait()` has reaped the leader.

On normal framing completion, consume both raw pipes to EOF, kill the group
while an exited leader is still unreaped, then wait exactly once. This clears
same-group descendants even when they closed inherited stdio. At the deadline,
kill the still-live group, abort reader tasks, return a fail-closed timeout, and
perform only bounded background reap. The RAII guard performs the same
synchronous kill/registry cleanup if the run future is dropped. A process group
is lifecycle cleanup, never descendant containment: an escaped `setsid` child
is bounded by reader abortion but only the later platform sandbox/cgroup can
contain it. Windows never spawns.

Readers stop immediately upon observing byte `limit + 1` and notify the run
owner, which kills the group and performs bounded cleanup without draining an
attacker's endless output. Reservation and spawn are separate: neither
capability/resolver awaits nor `Command::spawn` hold the global registry lock.
The token's pending-to-launch transition is synchronized with cancellation, so
a cancellation that wins while resolution is pending prevents spawn.

After bounded cleanup, reject cap overflow, nonzero status, non-UTF-8, anything
except one trailing-newline JSON object or any strict typed
`WorkerResponseV1` deserialization/semantic error. Call
`response.validate(request)` before returning so request ID, framework, action,
required payloads, shots, and any `KernelError.framework` are correlated. Snapshot,
simulation result, and kernel error are typed deny-unknown structures; their
contents are display data only and are never interpreted as commands, paths,
environment, or capabilities.

- [ ] **Step 4: Register Tauri lifecycle commands**

Add the state and its command-facing trait before the command functions:

```rust
pub struct AgentRuntimeState {
    pub supervisor: Supervisor,
    pub capability: tokio::sync::RwLock<CapabilityReport>,
    resolver: Arc<dyn AgentProcessResolver>,
}
pub trait AgentRuntimeCommands {
    async fn execute(
        &self, app: &tauri::AppHandle, request: WorkerRequestV1,
    ) -> Result<WorkerResponseV1, String>;
    async fn capability(&self, app: &tauri::AppHandle) -> CapabilityReport;
}
```

```rust
// src-tauri/src/commands/agent_runtime.rs
use crate::agent_runtime::AgentRuntimeCommands;
#[tauri::command]
pub async fn agent_sandbox_execute(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentRuntimeState>,
    request: FrontendRequestV1,
) -> Result<WorkerResponseV1, String> {
    state.execute(&app, WorkerRequestV1::try_from(request)?).await
}
#[tauri::command]
pub async fn agent_sandbox_cancel(
    state: tauri::State<'_, AgentRuntimeState>, request_id: String,
) -> Result<(), String> { state.supervisor.cancel(&request_id).await.map_err(|e| e.message) }
#[tauri::command]
pub async fn agent_sandbox_capability(
    app: tauri::AppHandle, state: tauri::State<'_, AgentRuntimeState>,
) -> CapabilityReport { state.capability(&app).await }
```

Implement `AgentRuntimeCommands` for `AgentRuntimeState`: in Task 4 the cached
report is initialized unavailable, `execute` rejects unavailable or unqualified
frameworks, and no unsandboxed `ProcessSpec` can be constructed. Platform Tasks
5 and 6 add the authoritative resolver and qualification flow; there is no
fallback spawn path before then. The command-facing trait uses a stable
Rust-1.77-compatible `impl Future + Send` return rather than `async-trait`.
`execute` synchronously reserves before capability or resolver work, races each
await against cancellation/deadline, and passes that same reservation into
launch. Validated `WorkerResponseV1` and nested response types derive `Serialize`
directly, preserving the worker's snake_case wire schema without a duplicate
command-side JSON mapper.
Register state and all commands in `lib.rs`; export the command module. App
shutdown handles `RunEvent::ExitRequested`/`RunEvent::Exit` and blocks on the
bounded `ProcessSupervisor::cancel_all`; individual window destruction does
not cancel workers. Synchronous RAII cancellation remains the drop fallback.
Task 4 adds no CI workflow—mandatory qualification and release workflow changes
belong exclusively to Task 9.

- [ ] **Step 5: Run lifecycle tests**

Run: `cd src-tauri && cargo test --test agent_runtime_contract -- --nocapture`

Expected: PASS; malformed bytes, flood, timeout, crash, cancellation, dropped
run futures, same-group descendants, and escaped-pgid pipe holders are bounded;
endless stdout/stderr floods are killed immediately at `limit + 1`; pending
resolution cancellation causes zero spawns; concurrent cancellation is not
blocked by another resolver/spawn; active/background-reap state is observable,
cleared, and a fresh worker succeeds.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agent_runtime/process.rs src-tauri/src/agent_runtime/protocol.rs src-tauri/src/commands/agent_runtime.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/tests/agent_runtime_contract.rs
git commit -m "feat: supervise untrusted agent workers"
```

### Task 5: Add fail-closed capability and macOS Seatbelt

**Files:**
- Create: `src-tauri/src/agent_runtime/macos.rs`
- Create: `src-tauri/tests/agent_runtime_boundary.rs`
- Modify: `src-tauri/src/agent_runtime/mod.rs`
- Modify: `src-tauri/src/agent_runtime/process.rs`

- [ ] **Step 1: Define the boundary test API and failing macOS test**

```rust
// src-tauri/tests/agent_runtime_boundary.rs
use app_lib::agent_runtime::{CapabilityReport, QualificationMode, qualify_current_host};

#[tokio::test]
async fn current_host_is_qualified_or_truthfully_unavailable() {
    let report: CapabilityReport = qualify_current_host(QualificationMode::AllowUnavailable).await;
    if report.available {
        assert!(report.controls.iter().all(|c| c.self_test_passed));
        assert!(!report.qualified_frameworks.contains(&"cuda-q".into()));
    } else {
        assert!(report.qualified_frameworks.is_empty());
        assert!(report.reason.is_some());
    }
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn macos_required_qualification_passes() {
    let report = qualify_current_host(QualificationMode::RequireAvailable).await;
    assert!(report.available, "{:?}", report.reason);
}
```

`CapabilityReport`, `ControlResult`, and `QualificationMode` were defined in
Task 3. Add the platform dispatch function:

```rust
pub async fn qualify_current_host(mode: QualificationMode) -> CapabilityReport {
    #[cfg(target_os = "macos")]
    let report = <macos::MacBackend as macos::MacosSandbox>::qualify_macos().await;
    #[cfg(target_os = "linux")]
    let report = <linux::LinuxSandbox as linux::LinuxSandboxApi>::qualify_linux().await;
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let report = CapabilityReport {
        available: false,
        reason: Some("Agent isolation is unavailable on this platform".into()),
        qualified_frameworks: vec![],
        controls: vec![],
    };
    if matches!(mode, QualificationMode::RequireAvailable) && !report.available {
        return CapabilityReport {
            reason: Some(format!("Required agent isolation unavailable: {}",
                report.reason.as_deref().unwrap_or("qualification failed"))),
            ..report
        };
    }
    report
}
```

- [ ] **Step 2: Run the macOS test to verify failure**

Run: `cd src-tauri && cargo test --test agent_runtime_boundary macos_required -- --nocapture`

Expected on macOS: FAIL because Seatbelt qualification is absent. Elsewhere: zero selected tests.

- [ ] **Step 3: Implement Seatbelt launch and concrete probes**

Implementation API update: the original `qualify_macos()` API was too implicit
for a security decision. `macos.rs` instead exposes canonical, testable inputs:

```rust
pub struct MacBackend;
pub struct QualificationContext {
    pub app_version: String,
    pub resources: ResourcePaths,
    pub environment: AgentEnvironment,
    pub request_temp_root: PathBuf,
    pub runtime_lock: PathBuf,
    pub project_root: PathBuf,
    pub home_root: PathBuf,
    pub parent_secret_names: BTreeSet<String>,
    pub system_paths: SystemPaths,
}
pub fn build_seatbelt_profile(
    context: &QualificationContext, request_temp: &Path,
) -> Result<String, String>;
pub async fn qualification_cache_key_async(
    context: QualificationContext,
) -> Result<String, String>;
pub struct LockedRuntimeIdentity { /* context + key + shared lease */ }
impl LockedRuntimeIdentity {
    pub async fn from_explicit_environment(
        app_version: &str,
    ) -> Result<Self, String>;
}
pub async fn qualify_current_host_with_context(
    mode: QualificationMode, context: QualificationContext,
) -> CapabilityReport;
```

`AgentRuntimeState` stores one immutable
`{ report, resolver, cache_key, refresh_key, generation }` backend behind a
single lock. Refresh probes run without that lock. A monotonic generation and
identity-key conditional commit ensure only the newest attempt can install or
clear the report/resolver pair; a stale resolver failure can clear only the
exact generation/key it executed and only when no newer refresh is pending or
committed. Resolver failure never allocates a refresh generation. Each resolver
carries its installed generation/key, and execution checks that identity
against the atomically read report. Cached qualification reuse constructs a new
resolver bound to the new generation/key before atomically installing the
refreshed backend; it never mutates the backend generation around a stale
resolver. Resolver launch recomputes a deterministic,
bounded, double-checked Merkle identity covering app version, complete profile,
requirements, and every regular path/type/content entry in the complete
canonical `AgentEnvironment.root` (the allowlisted kernel copy, interpreter,
stdlib, native libraries, and site-packages), plus sandbox-exec. Symlinks,
nonregular entries, traversal overflow, byte overflow, and a changing tree fail
closed.
Hashing runs cooperatively in `spawn_blocking`, checks cancellation and a
10-second deadline during traversal and every 64 KiB read, and is limited to
50,000 entries and 2 GiB. Refresh acquires the runtime generation's shared
app-owned lock before explicit context validation and the first hash, then holds
that same lease continuously through all probes, the final equality hash, and
atomic report/resolver installation. Cached reuse commits under the same lease.
Every launch also hashes while holding a shared lease; updates require the
exclusive lock. At spawn, `RunGuard` takes ownership of the lease and checked
request cleanup. Cancellation, wait failure, cleanup timeout, or future drop
transfers the child, lease, reservation, and cleanup to the background reaper;
the lease is released only after termination is observed and cleanup is
attempted. An updater therefore cannot replace either Python or the generated
kernel while any worker uses that generation.
The directory is a versioned generation; its computed full-tree Merkle key, not
its directory name, is the authoritative content identity. Tree entries must be
owned by the current uid and cannot be group/world writable. A pre-launch
mismatch or cleanup failure revokes only the matching installed generation.
The production context accepts only `AgentEnvironment.root/kernel`, populated
from the fixed agent-kernel file allowlist while the generation is staged. It
never executes the mutable repository or separately packaged application copy.

The threat model does not claim protection from malicious local same-user
tampering: that user can replace the application binaries and bypass these
checks. The lock, permissions, and repeated hash prevent the generated,
sandboxed worker from mutating its runtime and prevent normal application
updates from racing launches.
The no-context host entry point and application command require explicit macOS
qualification paths; they never derive cwd/home implicitly. Linux remains
unavailable until Task 6.

`worker_spec` builds a `(deny default)` inline profile allowing read only for
the dedicated locked generation (including its kernel copy), canonical `/System/Library` and
`/usr/lib`, and canonical entropy/null devices; write only under the unique
request temp; denies `network*` and `process-fork`; and permits exec only for
the canonical agent Python. The production `SystemPaths` constructor accepts no
paths: it canonicalizes exactly `/System/Library`, `/usr/lib`, `/dev/null`,
`/dev/urandom`, and `/usr/bin/sandbox-exec`, verifies directory/file/character
device types and raw-to-canonical identity, and rejects substitutions. Injected
test paths can exercise the pure profile builder but cannot qualify a production
backend. The spec
sets cwd, HOME, and TMPDIR inside request temp and carries exact parent-enforced
CPU, AS, FSIZE, NOFILE, NPROC, and CORE=0 limits. The shared production command
builder applies every limit with checked `setrlimit` calls in `pre_exec` before
launching sandbox-exec. Python applies the same limits again as defense in
depth. A separate provisioning contract remains unavailable until bundled
offline wheels and containment are hash-verified and self-tested.

`qualify_macos` receives canonical project and home roots. A trusted-parent RAII
baseline creates and reads random sentinels, creates/reads/deletes an
outside-write target, then runs the sandbox attacks. Host DAC failures fail
qualification rather than count as Seatbelt evidence. The macOS test serializes
environment mutation, injects fake `ANTHROPIC_API_KEY`, `IBM_QUANTUM_TOKEN`,
and `AWS_SECRET_ACCESS_KEY`, and proves `env_clear` omits their names; production
stores names only and never secret values. Every probe acquires one checked
request-directory guard immediately after directory creation. Canonicalization,
spec/symlink setup, spawn, reader, wait, timeout, and result validation all
finalize through that guard; explicit cleanup errors fail qualification, while
`Drop` is best-effort last resort only.

```python
open(PROJECT_SENTINEL).read()
open(HOME_SENTINEL).read()
import os; print(sorted(os.environ.items()))
import socket; socket.create_connection(("1.1.1.1", 53), 1)
import socket; socket.socket(socket.AF_INET6).connect(("::1", 9))
import socket; socket.socket(socket.AF_UNIX).connect("/tmp/nuclei-agent-test.sock")
import subprocess; subprocess.run(["/usr/bin/id"], check=True)
import os; os.fork()
```

It requires read/network/process failures, exact environment equality,
authoritative output caps, parent-enforced CPU/AS/FSIZE/NOFILE/NPROC/CORE
evidence, and a valid Cirq parse whose worker source confirms the inherited
limits after Python's defense-in-depth application. Every harness starts from
`MacBackend::probe_spec`, which derives from the production worker spec and uses
the same command/pre-exec path. The stdout flood runs through the production
`Supervisor` capped-reader/overflow path rather than a duplicate harness. Any
unexpected success, missing fixture,
missing sandbox-exec/runtime/framework, malformed evidence, profile error,
identity mismatch, or cleanup failure returns unavailable with no frameworks or
controls. The nonignored `RequireAvailable` macOS test requires explicit CI
fixture environment variables and asserts the exact Cirq-only report.
`.github/workflows/build.yml` uses `setup-uv`, `uv python install`, `uv venv`
(without `ensurepip`), and `uv pip sync` to install a managed standalone Python
and venv under one versioned `$RUNNER_TEMP/nuclei-agent-runtime` generation.
It copies exactly the agent-kernel allowlist into that same generation before
qualification. After installation it dereferences the complete common environment
into a sibling staging generation and publishes that tree by rename, then
recomputes interpreter and site-package paths and rejects every remaining
symlink. It syncs the committed universal
`kernel/agent-requirements.lock` with hash verification. GitHub actions use
commit SHAs and Python is pinned to 3.12.11. Before Rust starts, the fixture
asserts canonical `sys.base_prefix`, stdlib, executable, and site-packages paths
all remain under that common environment root. It then exports every explicit
fixture path and runs this test with Rust 1.77.2 on `macos-latest`. This online
CI setup is test setup only and does not satisfy the unavailable production
offline provisioning contract.

- [ ] **Step 4: Run macOS qualification**

Run: `cd src-tauri && cargo test --test agent_runtime_boundary macos_required -- --nocapture`

Expected on a qualifying macOS host: PASS. A host that cannot enforce the profile returns unavailable and fails this required test.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_runtime/macos.rs src-tauri/src/agent_runtime/mod.rs src-tauri/src/agent_runtime/process.rs src-tauri/tests/agent_runtime_boundary.rs
git commit -m "feat: qualify macOS agent Seatbelt"
```

### Task 6: Add Linux bwrap, cgroup, rlimit, and seccomp

**Authoritative implementation note (2026-07-10):** Linux is an
all-or-nothing backend. It accepts only explicit canonical fixture/runtime
paths, a trusted canonical bubblewrap executable, and an explicitly delegated
cgroup v2 subtree with `cpu`, `memory`, and `pids` enabled. Discovery performs
the real bubblewrap user/mount/PID/network namespace self-test, cgroup child
creation/limit/kill/removal probe, and seccomp compilation. Any missing
primitive returns an unavailable report with no controls or frameworks.

Each request holds the locked generation's shared lease through reap and
checked cleanup. Its unique cgroup is configured before spawn and joined from
trusted `pre_exec` code by async-signal-safe `open`/`write` calls, eliminating
the post-spawn placement race. Every terminal path invokes `cgroup.kill`, waits
for `populated 0` with a deadline, removes the child, and surfaces cleanup
failure so the matching backend generation is revoked. Process groups remain
lifecycle helpers only.

Cleanup revocation is synchronous and generation scoped. The installed backend,
Linux containment, and generic `RunGuard` cleanup resources share one bounded
`CleanupFailureSink`; `cgroup.kill`, populated-wait, or removal failure marks
that exact generation unavailable before a failing cleanup resource can drop.
Explicit completion returns the combined termination/finalization/request-dir
error, while cancellation, future drop, and background reap report through the
same sink even when their return value has no caller. A stale generation's sink
cannot revoke a newer backend, and subsequent execution fails before resolver
or spawn.

Cgroup construction is RAII from the successful `mkdir`. The construction
guard owns the partial leaf across every controller write, control-file
validation, CString/argument build, and containment handoff. Setup failure runs
checked kill, populated-zero wait, and removal; setup and cleanup errors are
combined, and failed fallback cleanup reports/revokes from `Drop`. Fault tests
cover every setup stage plus kill, events, populated, and removal cleanup
failures; no unchecked partial-leaf removal remains.

The Linux review hardening requires runtime evidence rather than path-shaped
fixtures. Production discovery verifies `CGROUP2_SUPER_MAGIC`, resolves the
canonical cgroup2 mount from `/proc/self/mountinfo`, requires the delegated root
to be a strict owned/writable domain descendant, and validates writable
membership/subtree controls and enabled cpu/memory/pids controllers. Injected
normal-directory cgroup files remain available only through the non-production
test backend and cannot qualify an installed backend.

Every production spawn is synchronously checked by the trusted parent after the
`pre_exec` join: the exact host bwrap/worker PID must appear in that unique
leaf's `cgroup.procs`, and `cgroup.events` must report populated. The sandbox
does not assert a host cgroup path because its cgroup namespace correctly shows
that leaf as `/`. Qualification applies probe-specific limits through the same
creation, pre-exec placement, supervisor, and cleanup path. Its memory policy
sets `memory.max` below `RLIMIT_AS` and requires `memory.events` oom and
oom_kill deltas; its pids policy sets `pids.max` below `RLIMIT_NPROC`, exercises
allowed thread clones, and requires a `pids.events max` delta; its cpu policy
sets restrictive `cpu.max` below the parent CPU/wall budget and requires
`cpu.stat` throttling deltas before accepting `cgroup_v2`.

Background reaping has both a hard deadline and a wait-error retry budget.
Exhaustion synchronously revokes the matching generation and reaches an
observable bounded terminal state, but retains the unconfirmed child, runtime
lease, request directory, cgroup, and reservation in quarantine. Qualification
tracks the exact random cgroup leaves and request directories it creates and
checks only those paths; concurrent legitimate requests cannot invalidate a
refresh.

The Linux CI job completes uv Python/package installation, then caches both a
host-scoped `cargo fetch --locked --target x86_64-unknown-linux-gnu` (so Cargo
1.77 never parses unused newer-target manifests). It also completes locked
no-run test compilation before fake secrets, proxies, or loader variables are
injected. The hostile qualification step runs `cargo test --locked --offline`,
and no later step can perform network I/O.

The pure-Rust `seccompiler` filter is compiled for the verified host
architecture, serialized into a sealed memfd, and inherited only by bwrap.
Bubblewrap applies it after namespace/mount setup. It denies the socket family
operations, `fork`, `vfork`, `clone3`, `execveat`, and non-`CLONE_THREAD`
`clone`, while parent rlimits and Python limits remain defense in depth.
Production specifications expose only the locked generation, narrowly scoped
loader/library roots, tmpfs `/tmp`, proc, minimal dev, and synthetic home, with
an exact environment allowlist.

Qualification uses the production resolver, specification, and supervisor
paths with trusted-parent random sentinels. It requires concrete denial or
limit evidence for project/home/symlink reads, exact environment, IPv4/IPv6/
Unix sockets, subprocess/fork/setsid/clone/execveat, trusted-parent PID
placement, cgroup escape, independent memory/pids/cpu event deltas,
stdout/stderr caps, descriptor exhaustion, cancellation, malformed protocol,
descriptor closure, cleanup, and valid Cirq parse. The nonignored required test
is activated only by
`NUCLEI_REQUIRE_LINUX_AGENT_ISOLATION=1`; the pinned GitHub job provisions the
fixture and must fail if the hosted runner cannot delegate cgroup v2. Dynamic
provisioning remains unavailable because no independently contained offline
wheel runner exists.

**Files:**
- Create: `src-tauri/src/agent_runtime/linux.rs`
- Modify: `src-tauri/src/agent_runtime/mod.rs`
- Modify: `src-tauri/src/agent_runtime/process.rs`
- Modify: `src-tauri/tests/agent_runtime_boundary.rs`
- Modify: `src-tauri/Cargo.toml`

- [x] **Step 1: Add the pure-Rust seccomp compiler**

Run: `cd src-tauri && cargo add seccompiler --target 'cfg(target_os = "linux")'`

Expected: dependency resolves without requiring a host `libseccomp.so`.

- [x] **Step 2: Add the required Linux test**

```rust
// append to src-tauri/tests/agent_runtime_boundary.rs
#[cfg(target_os = "linux")]
#[tokio::test]
async fn linux_required_qualification_passes() {
    let report = qualify_current_host(QualificationMode::RequireAvailable).await;
    assert!(report.available, "{:?}", report.reason);
    for required in ["bwrap", "network_namespace", "cgroup_v2", "rlimit", "seccomp", "clean_environment"] {
        assert!(report.controls.iter().any(|c| c.name == required && c.self_test_passed));
    }
}
```

- [ ] **Step 3: Run the test to verify failure**

Run: `cd src-tauri && cargo test --test agent_runtime_boundary linux_required -- --nocapture`

Expected on Linux: FAIL because Linux qualification is absent.

- [x] **Step 4: Implement all-or-nothing Linux APIs**

```rust
// src-tauri/src/agent_runtime/linux.rs
pub struct LinuxSandbox {
    pub bwrap: std::path::PathBuf,
    pub cgroup_root: std::path::PathBuf,
}
impl LinuxSandbox {
}
pub trait LinuxSandboxApi: Sized {
    fn discover() -> Result<Self, String>;
    fn process_spec(
        &self, request_id: &str, env: &AgentEnvironment,
        resources: &ResourcePaths, temp: &std::path::Path,
    ) -> Result<ProcessSpec, String>;
    async fn qualify(&self, env: &AgentEnvironment, resources: &ResourcePaths) -> CapabilityReport;
    async fn qualify_linux() -> CapabilityReport;
}
```

`discover` requires executable `bwrap`, successful user/mount/PID/network namespace probe, writable delegated cgroup v2 subtree, and seccomp-BPF support. `process_spec` uses `--unshare-all --unshare-net --die-with-parent --new-session --clearenv`, read-only binds only system runtime libraries and the locked versioned generation containing the agent environment and allowlisted kernel copy; tmpfs `/tmp`; synthetic `/home/agent`; no project/home bind. It creates a unique cgroup with `memory.max=1073741824`, `pids.max=4`, and `cpu.max=100000 100000`, moves the child PID into `cgroup.procs`, and removes the cgroup after reaping. Linux provisioning likewise requires a dedicated delegated cgroup plus network namespace/seccomp containment and app-bundled offline wheels before its runner may report `RunnerContainment::Contained`; otherwise capability remains unavailable without invoking pip.

Compile a seccomp filter passed through `bwrap --seccomp FD` that denies socket operations, `fork`, `vfork`, `clone3`, and `clone` unless `CLONE_THREAD` is set. The worker still applies all rlimits before `Executor`. `qualify` executes fresh workers for: `open(PROJECT_SENTINEL).read()`, `open(HOME_SENTINEL).read()`, exact `os.environ` enumeration, IPv4/IPv6/Unix sockets, `subprocess.run(["/usr/bin/id"])`, `os.fork()`, `while True: pass`, `bytearray(2_000_000_000)`, unbounded `print`, 1,000 `open("/dev/null")` calls, cancellation, malformed JSON, and process clone. Failure to provision or verify any primitive returns unavailable with no frameworks.

- [ ] **Step 5: Run Linux qualification**

The local `AllowUnavailable` boundary suite passes truthfully. The current
host has no explicit locked runtime/delegated-cgroup fixture, so its required
qualification remains unavailable; the pinned CI fixture is the authoritative
available-path run.

Run: `cd src-tauri && cargo test --test agent_runtime_boundary linux_required -- --nocapture`

Expected on a provisioned Linux host: PASS. On a normal host without delegated cgroup/user namespaces/seccomp, this required test fails; `current_host_is_qualified_or_truthfully_unavailable` still passes by proving fail-closed behavior.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/agent_runtime/linux.rs src-tauri/src/agent_runtime/mod.rs src-tauri/src/agent_runtime/process.rs src-tauri/tests/agent_runtime_boundary.rs
git commit -m "feat: qualify Linux agent sandbox"
```

### Task 7: Qualify frameworks, Q# runaway recovery, and packaged resources

**Files:**
- Modify: `src-tauri/tests/agent_runtime_boundary.rs`
- Modify: `src-tauri/src/agent_runtime/mod.rs`
- Create: `src-tauri/src/agent_runtime/qualification.rs`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Add concrete qualification tests through public APIs**

```rust
// append to src-tauri/tests/agent_runtime_boundary.rs
use app_lib::agent_runtime::qualification::{
    evaluate_framework_policy, FrameworkEvidence,
};

#[test]
fn qualified_frameworks_fail_closed_when_installed_package_lacks_boundary_evidence() {
    let policy = evaluate_framework_policy(&[
        FrameworkEvidence {
            package: "qiskit",
            common_boundary_passed: true,
            functional_probe_passed: true,
        },
        FrameworkEvidence {
            package: "cirq",
            common_boundary_passed: false,
            functional_probe_passed: true,
        },
        FrameworkEvidence {
            package: "qsharp",
            common_boundary_passed: true,
            functional_probe_passed: false,
        },
    ]);

    assert!(!policy.available);
    assert!(policy.qualified_frameworks.is_empty());
}

#[test]
fn qualified_frameworks_filter_api_only_after_all_installed_packages_pass_boundaries() {
    let policy = evaluate_framework_policy(&[
        FrameworkEvidence {
            package: "qiskit",
            common_boundary_passed: true,
            functional_probe_passed: true,
        },
        FrameworkEvidence {
            package: "cirq",
            common_boundary_passed: true,
            functional_probe_passed: false,
        },
        FrameworkEvidence {
            package: "qsharp",
            common_boundary_passed: true,
            functional_probe_passed: true,
        },
    ]);

    assert!(policy.available);
    assert_eq!(
        policy.qualified_frameworks,
        vec!["qiskit".to_string(), "qsharp".to_string()],
    );
}

#[test]
fn qualified_frameworks_fail_closed_if_cuda_q_is_installed() {
    let policy = evaluate_framework_policy(&[
        FrameworkEvidence {
            package: "qiskit",
            common_boundary_passed: true,
            functional_probe_passed: true,
        },
        FrameworkEvidence {
            package: "cuda-q",
            common_boundary_passed: true,
            functional_probe_passed: false,
        },
    ]);

    assert!(!policy.available);
    assert!(policy.qualified_frameworks.is_empty());
}

#[tokio::test]
async fn qualified_frameworks_have_functional_and_boundary_evidence() {
    let report = qualify_current_host(QualificationMode::AllowUnavailable).await;
    assert!(!report.qualified_frameworks.contains(&"cuda-q".into()));
    if report.available {
        for framework in &report.qualified_frameworks {
            assert!(["qiskit", "cirq", "qsharp"].contains(&framework.as_str()));
        }
    }
}

#[tokio::test]
async fn packaged_resource_layout_resolves_without_repository_parent() {
    let temp = tempfile::tempdir().unwrap();
    let bundle = temp.path().join("Resources/agent-runtime/kernel");
    std::fs::create_dir_all(&bundle).unwrap();
    for name in ["agent_worker.py", "agent_protocol.py", "agent_limits.py", "executor.py", "agent-requirements.txt"] {
        std::fs::write(bundle.join(name), b"fixture").unwrap();
    }
    let paths = app_lib::agent_runtime::resources::ResourcePaths::bundled(
        &temp.path().join("Resources")
    ).unwrap();
    assert!(paths.worker.starts_with(&bundle));
}
```

- [ ] **Step 2: Run tests to verify missing qualification evidence**

Run: `cd src-tauri && cargo test --test agent_runtime_boundary qualified_frameworks packaged_resource -- --nocapture`

Expected: FAIL until framework evidence and bundle mapping are implemented.

- [ ] **Step 3: Implement all-installed-package boundary policy and individual functional qualification**

Create `qualification.rs` with `FrameworkEvidence { package: &'static str, common_boundary_passed: bool, functional_probe_passed: bool }`, `FrameworkPolicy { available: bool, qualified_frameworks: Vec<String> }`, and pure `evaluate_framework_policy`. Its input enumerates every framework package actually installed in the dedicated runtime. It returns unavailable with an empty framework list if any installed package lacks common boundary evidence or if CUDA-Q is installed. Only after every installed package passes the common boundary matrix does it populate `qualified_frameworks` from packages whose functional probes passed. Thus a boundary-unqualified package cannot be hidden by omitting it from API exposure, while a boundary-qualified package may remain functionally unavailable.

After OS controls qualify, run the common boundary matrix against every installed framework package, then run a Bell parse/simulation in a fresh worker for Qiskit and Cirq and a finite `MResetZ` parse/simulation for Q#. Feed all boundary and functional evidence through `evaluate_framework_policy`; never derive package confinement from the worker's lexical adapter selection. Dynamic cross-import among installed packages is acceptable because every installed package has the same boundary evidence. For Q# specifically, launch an infinite-loop operation, require Rust wall timeout plus the qualified platform containment primitive to terminate every descendant, then launch the finite operation in a new worker and require success. Never use QDK's thread watchdog or a process group alone as recovery. CUDA-Q has no enum variant, must not be installed in the dedicated runtime, and cannot qualify.

Map only these source resources in `tauri.conf.json`: worker, protocol, limits,
executor, adapters, models, and agent requirements under
`agent-runtime/kernel`. Provisioning must copy only that allowlist into the
versioned runtime generation while holding the exclusive generation lock.
Qualification and execution resolve only the generated copy. The packaged
source and normal IDE kernel are never mounted/read-allowed or executed by the
worker sandbox.

- [ ] **Step 4: Run framework and packaging tests**

Run: `cd src-tauri && cargo test --test agent_runtime_boundary qualified_frameworks packaged_resource -- --nocapture`

Expected: PASS; capability fails closed if any installed package lacks common boundary evidence, `qualifiedFrameworks` filters only functional/API exposure after that all-installed check, CUDA-Q is absent, Q# timeout does not poison the fresh worker, and bundle resolution does not depend on a repository parent.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_runtime/mod.rs src-tauri/src/agent_runtime/qualification.rs src-tauri/tauri.conf.json src-tauri/tests/agent_runtime_boundary.rs
git commit -m "test: qualify agent frameworks and resources"
```

### Task 8: Implement the frontend sandbox session with no kernel fallback

**Files:**
- Create: `src/services/agentSandboxSession.ts`
- Create: `src/services/agentSandboxSession.test.ts`

- [ ] **Step 1: Write failing tests with deterministic IDs and complete fixtures**

```typescript
// src/services/agentSandboxSession.test.ts
import { beforeEach, expect, it, vi } from 'vitest';
const invoke = vi.fn();
const createKernelSession = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('./kernelSession', async () => ({
  ...(await vi.importActual<typeof import('./kernelSession')>('./kernelSession')),
  createKernelSession,
}));
import { createAgentSandboxSession } from './agentSandboxSession';

const response = {
  protocol_version: 1, request_id: 'req-1', status: 'ok',
  snapshot: null, result: null, stdout: 'ok', stderr: '', error: null,
};

beforeEach(() => {
  invoke.mockReset();
  createKernelSession.mockReset();
  vi.stubGlobal('crypto', { randomUUID: () => 'req-1' });
});

it('fails closed on web without ordinary kernel fallback', async () => {
  await expect(createAgentSandboxSession('web', vi.fn()))
    .rejects.toThrow('Agent isolation is unavailable on this platform');
  expect(createKernelSession).not.toHaveBeenCalled();
});

it('sends one request and maps the validated response', async () => {
  invoke.mockResolvedValueOnce({ available: true, reason: null, qualifiedFrameworks: ['cirq'] })
    .mockResolvedValueOnce(response);
  const onMessage = vi.fn();
  const session = await createAgentSandboxSession('desktop', onMessage);
  await session.send({ type: 'agent_parse', code: 'import cirq', language: 'python' });
  expect(onMessage).toHaveBeenCalledWith({ type: 'output', text: 'ok' });
  expect(createKernelSession).not.toHaveBeenCalled();
});

it('rejects extra fields and wrong correlation before callbacks', async () => {
  invoke.mockResolvedValueOnce({ available: true, reason: null, qualifiedFrameworks: ['cirq'] })
    .mockResolvedValueOnce({ ...response, request_id: 'attacker', extra: true });
  const onMessage = vi.fn();
  const session = await createAgentSandboxSession('desktop', onMessage);
  await expect(session.send({ type: 'agent_parse', code: 'import cirq', language: 'python' }))
    .rejects.toThrow('Malformed agent worker response');
  expect(onMessage).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/services/agentSandboxSession.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the exact prerequisite contract**

```typescript
// src/services/agentSandboxSession.ts
import { invoke } from '@tauri-apps/api/core';
import type { KernelLanguage, KernelResponse } from '../types/quantum';
import type { PlatformKind } from './kernelSession';

export type AgentSandboxMessage =
  | { type: 'agent_parse'; code: string; language: KernelLanguage }
  | { type: 'agent_execute'; code: string; shots: number; language: KernelLanguage };
export interface AgentSandboxSession {
  send(message: AgentSandboxMessage): void | Promise<void>;
  close(): void;
}

export async function createAgentSandboxSession(
  platform: PlatformKind, onMessage: (message: KernelResponse) => void,
): Promise<AgentSandboxSession> {
  if (platform !== 'desktop') throw new Error('Agent isolation is unavailable on this platform');
  const capability = await invoke<{available: boolean; reason: string | null; qualifiedFrameworks: string[]}>(
    'agent_sandbox_capability'
  );
  if (!capability.available) throw new Error(capability.reason ?? 'Agent isolation is unavailable on this platform');
  let active: string | null = null;
  let closed = false;
  return {
    async send(message) {
      if (closed || active) throw new Error('Agent sandbox session accepts one request');
      if (new TextEncoder().encode(message.code).length > 262_144) throw new Error('Agent source exceeds 256 KiB');
      if (message.type === 'agent_execute' && (message.shots < 1 || message.shots > 10_000)) {
        throw new Error('Agent shots must be between 1 and 10000');
      }
      const requestId = crypto.randomUUID();
      active = requestId;
      const framework = detectFramework(message.code, message.language, capability.qualifiedFrameworks);
      const raw = await invoke<unknown>('agent_sandbox_execute', { request: {
        protocolVersion: 1, requestId,
        action: message.type === 'agent_parse' ? 'parse' : 'simulate',
        framework, language: message.language, code: message.code,
        ...(message.type === 'agent_execute' ? { shots: message.shots } : {}),
      }});
      active = null;
      const value = validateResponse(raw, requestId);
      if (!closed) emitResponse(value, message.type, onMessage);
    },
    close() {
      closed = true;
      if (active) void invoke('agent_sandbox_cancel', { requestId: active });
    },
  };
}
```

Add these functions above `createAgentSandboxSession`:

```typescript
type WorkerResponse = {
  protocol_version: 1;
  request_id: string;
  status: 'ok' | 'error';
  snapshot: Extract<KernelResponse, { type: 'snapshot' }>['data'];
  result: Extract<KernelResponse, { type: 'result' }>['data'];
  stdout: string;
  stderr: string;
  error: { code: string; message: string; traceback?: string } | null;
};

function detectFramework(code: string, language: KernelLanguage, qualified: string[]) {
  const matches = language === 'qsharp'
    ? ['qsharp']
    : [
        /(?:from\s+qiskit\s+import|import\s+qiskit)/m.test(code) ? 'qiskit' : null,
        /(?:from\s+cirq\s+import|import\s+cirq)/m.test(code) ? 'cirq' : null,
      ].filter((value): value is 'qiskit' | 'cirq' => value !== null);
  if (matches.length !== 1 || !qualified.includes(matches[0])) {
    throw new Error('Agent isolation is unavailable for this framework');
  }
  return matches[0];
}

function validateResponse(raw: unknown, requestId: string): WorkerResponse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Malformed agent worker response');
  }
  const value = raw as Record<string, unknown>;
  const keys = ['error', 'protocol_version', 'request_id', 'result', 'snapshot', 'status', 'stderr', 'stdout'];
  if (Object.keys(value).sort().join('|') !== keys.join('|')
      || value.protocol_version !== 1
      || value.request_id !== requestId
      || (value.status !== 'ok' && value.status !== 'error')
      || typeof value.stdout !== 'string'
      || typeof value.stderr !== 'string'
      || (value.error !== null && (typeof value.error !== 'object' || Array.isArray(value.error)))) {
    throw new Error('Malformed agent worker response');
  }
  return value as WorkerResponse;
}

function emitResponse(
  value: WorkerResponse,
  requestType: AgentSandboxMessage['type'],
  emit: (message: KernelResponse) => void,
) {
  if (value.stdout) emit({ type: 'output', text: value.stdout });
  if (value.stderr) emit({ type: 'stderr', text: value.stderr });
  emit({ type: 'snapshot', data: value.snapshot });
  if (value.error) {
    emit({
      type: 'error', code: value.error.code, message: value.error.message,
      traceback: value.error.traceback,
      phase: requestType === 'agent_parse' ? 'parse' : 'execute',
    });
  }
  if (requestType === 'agent_execute') emit({ type: 'result', data: value.result });
}
```

The file does not import `createKernelSession`; response values are emitted only as `KernelResponse` data and are never used as commands, paths, environment, or capabilities.

- [ ] **Step 4: Run tests and the project-reference-aware build**

Run: `npm test -- src/services/agentSandboxSession.test.ts && npm run build`

Expected: PASS; web, unavailable capability, malformed response, wrong ID, cancellation, source/shot limits, and no-fallback tests pass, and the production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/services/agentSandboxSession.ts src/services/agentSandboxSession.test.ts
git commit -m "feat: add isolated agent sandbox session"
```

### Task 9: Make qualification and release packaging mandatory

**Files:**
- Create: `.github/workflows/agent-sandbox-tests.yml`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add qualification CI**

```yaml
# .github/workflows/agent-sandbox-tests.yml
name: Agent Sandbox Tests
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: python -m pip install -r kernel/agent-requirements.txt pytest
      - run: python -m pytest kernel/tests/test_agent_protocol.py kernel/tests/test_agent_worker.py kernel/tests/test_executor.py -v
      - run: cargo test --manifest-path src-tauri/Cargo.toml --test agent_runtime_contract
  boundary-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: python -m pip install -r kernel/agent-requirements.txt
      - run: cargo test --manifest-path src-tauri/Cargo.toml --test agent_runtime_boundary macos_required -- --nocapture
  boundary-linux:
    runs-on: [self-hosted, linux, nuclei-agent-sandbox]
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: command -v bwrap && test -w /sys/fs/cgroup/nuclei-agents
      - run: python -m pip install -r kernel/agent-requirements.txt
      - run: cargo test --manifest-path src-tauri/Cargo.toml --test agent_runtime_boundary linux_required -- --nocapture
```

The self-hosted Linux runner is preconfigured with delegated `/sys/fs/cgroup/nuclei-agents`, user namespaces, bwrap, and seccomp. The explicit `command -v`/`test -w` step and `QualificationMode::RequireAvailable` make missing controls fail the job. Ordinary contract tests continue to verify that unsupported hosts return unavailable.

- [ ] **Step 2: Add release resource verification**

Before `tauri-action` in `.github/workflows/release.yml`, add:

```yaml
      - name: Verify agent resource manifest
        shell: bash
        run: |
          for file in agent_worker.py agent_protocol.py agent_limits.py executor.py agent-requirements.txt; do
            test -f "kernel/$file"
          done
          ! grep -Eiq 'keyring|ibm-runtime|braket|azure-quantum|ionq|quantinuum|cuda' kernel/agent-requirements.txt
          cargo test --manifest-path src-tauri/Cargo.toml --test agent_runtime_boundary packaged_resource -- --nocapture
      - name: Require macOS sandbox qualification
        if: runner.os == 'macOS'
        run: cargo test --manifest-path src-tauri/Cargo.toml --test agent_runtime_boundary macos_required -- --nocapture
      - name: Require Linux sandbox qualification
        if: runner.os == 'Linux'
        run: cargo test --manifest-path src-tauri/Cargo.toml --test agent_runtime_boundary linux_required -- --nocapture
      - name: Verify Windows fails closed
        if: runner.os == 'Windows'
        run: cargo test --manifest-path src-tauri/Cargo.toml --test agent_runtime_contract windows_production_fails_closed_but_contained_injection_remains_testable -- --nocapture
```

Add `windows_is_unavailable` to `agent_runtime_contract.rs`; it calls
`qualify_current_host(AllowUnavailable)` under `#[cfg(target_os = "windows")]`
and asserts `available == false`, empty frameworks, and the exact unsupported
platform reason.

- [ ] **Step 3: Run final verification**

Run: `python -m pytest kernel/tests/ -v`

Expected: PASS.

Run: `cd src-tauri && cargo fmt --check && cargo test --all-targets -- --nocapture`

Expected: PASS on a qualified development host; ordinary unsupported-host tests pass only by asserting unavailable, while `macos_required`/`linux_required` fail when mandatory controls are absent.

Run: `npm test && npm run build && npm run lint`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/agent-sandbox-tests.yml .github/workflows/release.yml
git commit -m "test: require agent sandbox qualification"
```

## Completion checklist

- [ ] Every generated-source request uses a fresh worker and never reaches `server.py`, `HardwareManager`, or `createKernelSession`.
- [ ] Python and Rust both enforce 262,144 UTF-8 source bytes and 1–10,000 shots.
- [ ] Raw worker bytes are capped before UTF-8/JSON decoding; response IDs are correlation only.
- [ ] Project/home reads, environment leakage, IPv4/IPv6/Unix networking, subprocess/fork/clone, timeout, memory, output flood, fd exhaustion, malformed protocol, cancellation, Q# runaway, crash recovery, and fresh-worker recovery have concrete adversarial tests.
- [ ] Dedicated environment paths/imports are verified; any mismatch keeps capability unavailable.
- [ ] macOS and Linux expose only self-tested controls; Windows/web fail closed.
- [ ] Linux qualification CI fails if bwrap, delegated cgroup v2, seccomp, rlimits, or namespaces cannot be provisioned.
- [ ] Qiskit, Cirq, and Q# qualify individually; CUDA-Q remains unavailable.
- [ ] Development and packaged resource resolution are tested without relying on repository-relative production paths.
