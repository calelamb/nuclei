import asyncio
import json
import sys
import os

# Add project root to path so kernel package is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Opt out of Microsoft qdk's Azure Application Insights telemetry for the
# whole kernel process — must precede any qdk import, including user code
# running `import qdk` through run_python. setdefault keeps an explicit
# user override. (Also set in kernel/adapters/qsharp_adapter.py for
# embedders that use the adapter without this server.)
os.environ.setdefault("QDK_PYTHON_TELEMETRY", "none")

import websockets
from kernel.executor import ADAPTER_SPECS, Executor
from kernel.hardware.manager import HardwareManager
from kernel.models import KernelError

DEFAULT_PORT = 9742
PORT_FALLBACK_RANGE = 20  # Try DEFAULT_PORT .. DEFAULT_PORT + 19
MAX_MESSAGE_SIZE = 1_048_576  # 1 MiB — blocks gigantic code payloads
PING_INTERVAL = 30
PING_TIMEOUT = 20

# Disposable agent worker: model-generated code that Dirac runs autonomously in
# its verify/repair loop executes in a fresh subprocess (kernel/agent_worker.py)
# with resource limits + an import denylist, isolated from provider credentials
# and the user's editor state. -I runs the interpreter in isolated mode.
_AGENT_WORKER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_worker.py")
_AGENT_WORKER_WALL_SECONDS = 25  # > the worker's 10s RLIMIT_CPU; catches wall hangs


async def run_agent_worker(request: dict) -> dict:
    """Execute one agent request in a disposable worker subprocess.

    Returns the worker's parsed JSON response (a dict with status/snapshot/
    result/stdout/stderr/error), or a synthesized error response if the worker
    times out, crashes, or emits unparseable output. Never raises.
    """
    request_id = request.get("request_id", "invalid")
    payload = json.dumps(request, separators=(",", ":"), allow_nan=False).encode("utf-8")

    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-I", _AGENT_WORKER_PATH,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except OSError as exc:
        return _agent_error(request_id, "worker_spawn_failed", str(exc))

    try:
        stdout, _ = await asyncio.wait_for(
            proc.communicate(input=payload), timeout=_AGENT_WORKER_WALL_SECONDS
        )
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()
        return _agent_error(request_id, "worker_timeout", "Agent worker exceeded its time budget.")

    if not stdout:
        return _agent_error(request_id, "worker_no_output", "Agent worker produced no response.")

    try:
        response = json.loads(stdout.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return _agent_error(request_id, "worker_bad_output", "Agent worker response was not valid JSON.")

    if not isinstance(response, dict):
        return _agent_error(request_id, "worker_bad_output", "Agent worker response was not an object.")
    return response


def _agent_error(request_id: str, code: str, message: str) -> dict:
    return {
        "protocol_version": 1,
        "request_id": request_id,
        "status": "error",
        "snapshot": None,
        "result": None,
        "stdout": "",
        "stderr": "",
        "error": {"code": code, "message": message},
    }

# Hardware manager is shared — it holds provider credentials and job handles,
# which are inherently multi-connection state.
hardware_manager = HardwareManager()
hardware_manager.connect_provider("simulator", {})


def _extract_circuit_for_provider(namespace: dict, provider: str):
    """Find the circuit object a student defined in their code.

    Provider-specific search order so Qiskit code submitted to a Qiskit-native
    provider (IBM, IonQ, Quantinuum, Braket, Azure) finds a QuantumCircuit
    before any Cirq Circuit that may also be defined. Returns None if nothing
    recognizable is defined — caller should surface a friendly error."""
    # Provider → preferred framework(s) order
    order_map = {
        "ibm": ("qiskit", "cirq", "cudaq"),
        "ionq": ("qiskit", "cirq", "cudaq"),
        "braket": ("qiskit", "cirq", "cudaq"),
        "azure": ("qiskit", "cirq", "cudaq"),
        "quantinuum": ("qiskit", "cirq", "cudaq"),
        "nvidia": ("cudaq", "qiskit", "cirq"),
        "simulator": ("qiskit", "cirq", "cudaq"),
    }
    order = order_map.get(provider, ("qiskit", "cirq", "cudaq"))

    for kind in order:
        if kind == "qiskit":
            try:
                from qiskit import QuantumCircuit
                for v in namespace.values():
                    if isinstance(v, QuantumCircuit):
                        return v
            except ImportError:
                pass
        elif kind == "cirq":
            try:
                import cirq
                for v in namespace.values():
                    if isinstance(v, cirq.Circuit):
                        return v
            except ImportError:
                pass
        elif kind == "cudaq":
            try:
                import cudaq  # noqa: F401
                # CUDA-Q kernels are functions decorated with @cudaq.kernel —
                # detect by having an __kernel_name__ attribute the decorator
                # attaches (fall back to any callable named 'kernel').
                for v in namespace.values():
                    if callable(v) and (
                        hasattr(v, "__kernel_name__") or getattr(v, "__name__", "") in ("kernel", "circuit")
                    ):
                        return v
            except ImportError:
                pass
    return None


# The Q# spec's detect pattern is the single source of truth for "does this
# source look like Q#?" — reused here so hardware submissions from older
# clients (which omit the `language` field) still route correctly.
_QSHARP_SPEC = next(spec for spec in ADAPTER_SPECS if spec.framework == "qsharp")

# Providers whose submit path can accept a Q# program: the local simulator
# re-runs raw source through the executor, Azure Quantum accepts compiled QIR.
_QSHARP_HARDWARE_PROVIDERS = {"simulator", "azure"}


def _prepare_hardware_payload(
    code: str, provider: str, backend: str, language: str | None
) -> object:
    """Build the payload `hardware_manager.submit_job` receives for `code`.

    Four routes:
    - Q# → non-Azure hardware: rejected with a friendly RuntimeError — those
      provider SDKs take Python circuit objects, not Q# source or QIR.
    - Q# → Azure Quantum: compiled to QIR via QsharpAdapter.compile_qir.
      Quantinuum targets get the Adaptive_RI profile (they support
      mid-circuit measurement + classical feedback); everything else Base.
    - Local simulator: raw source passes through unchanged (Q# or Python
      alike) — the simulator re-runs it through the executor pipeline,
      which already handles every framework.
    - Python → real hardware: exec + extract a concrete circuit object,
      exactly as before.
    """
    is_qsharp = (
        language == "qsharp" or _QSHARP_SPEC.detect_pattern.search(code) is not None
    )

    if is_qsharp:
        if provider not in _QSHARP_HARDWARE_PROVIDERS:
            raise RuntimeError(
                "Q# programs can currently run on the Local Simulator and "
                "Azure Quantum targets. Switch the provider to Azure Quantum, "
                "or rewrite the circuit in Qiskit to use " + provider + "."
            )
        if provider == "simulator":
            return code
        profile = "adaptive_ri" if "quantinuum" in backend.lower() else "base"
        # Lazy import: the adapter module is import-safe without qdk, but
        # there is no reason to load it for Python submissions.
        from kernel.adapters.qsharp_adapter import QsharpAdapter

        try:
            return QsharpAdapter().compile_qir(code, profile)
        except ImportError as exc:
            raise RuntimeError(
                "Microsoft QDK (qdk) is not installed in the kernel "
                "environment, so Q# cannot be compiled for hardware. "
                "Install it from the setup wizard."
            ) from exc

    if provider == "simulator":
        return code

    namespace = {"__builtins__": __builtins__}
    exec(code, namespace)
    circuit_obj = _extract_circuit_for_provider(namespace, provider)
    if circuit_obj is None:
        raise RuntimeError(
            "No circuit object found in the code. "
            "Your code must define a Qiskit QuantumCircuit, Cirq Circuit, or CUDA-Q kernel."
        )
    return circuit_obj


def error_payload(error: KernelError, phase: str) -> dict:
    payload = {
        "type": "error",
        "message": error.message,
        "code": error.code,
        "phase": phase,
    }
    if error.traceback:
        payload["traceback"] = error.traceback
    if error.framework:
        payload["framework"] = error.framework
    if error.dependency:
        payload["dependency"] = error.dependency
    return payload


async def handle_message(websocket):
    # Per-connection executor — prevents parse/execute state bleeding across
    # concurrent WS clients (e.g. reconnect races).
    executor = Executor()

    async for raw in websocket:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            await websocket.send(json.dumps({
                "type": "error",
                "message": "Invalid JSON",
            }))
            continue

        msg_type = msg.get("type")
        code = msg.get("code", "")

        # Optional language hint ("qsharp" / "python") from the frontend;
        # omitted by older clients, in which case detection stays regex-based.
        language = msg.get("language")

        if msg_type == "parse":
            # Offload blocking parse to a thread so the event loop stays
            # responsive to heartbeats and other messages.
            snapshot, stdout, stderr, error = await asyncio.to_thread(
                executor.parse, code, language=language
            )

            if stdout:
                await websocket.send(json.dumps({
                    "type": "output",
                    "text": stdout,
                }))

            if stderr:
                await websocket.send(json.dumps({
                    "type": "stderr",
                    "text": stderr,
                }))

            await websocket.send(json.dumps({
                "type": "snapshot",
                "data": snapshot.to_dict() if snapshot else None,
            }))

            if error:
                await websocket.send(json.dumps(error_payload(error, "parse")))

        elif msg_type == "execute":
            shots = msg.get("shots", 1024)
            # Simulation can take multiple seconds — must not block the loop.
            result, snapshot, stdout, stderr, error = await asyncio.to_thread(
                executor.execute, code, shots, language=language
            )

            if stdout:
                await websocket.send(json.dumps({
                    "type": "output",
                    "text": stdout,
                }))

            if stderr:
                await websocket.send(json.dumps({
                    "type": "stderr",
                    "text": stderr,
                }))

            if snapshot or (error and error.code in {"unsupported_framework", "missing_dependency", "no_circuit", "execution_error", "adapter_error"}):
                await websocket.send(json.dumps({
                    "type": "snapshot",
                    "data": snapshot.to_dict() if snapshot else None,
                }))

            if error:
                # Send error before result:None so the frontend can display it
                # without a flash of "success with no data".
                await websocket.send(json.dumps(error_payload(error, "execute")))
                await websocket.send(json.dumps({
                    "type": "result",
                    "data": None,
                }))
            else:
                await websocket.send(json.dumps({
                    "type": "result",
                    "data": result.to_dict() if result else None,
                }))

        elif msg_type == "run_python":
            stdout, stderr, error = await asyncio.to_thread(executor.run_python, code)

            if stdout:
                await websocket.send(json.dumps({
                    "type": "output",
                    "text": stdout,
                }))

            if stderr:
                await websocket.send(json.dumps({
                    "type": "stderr",
                    "text": stderr,
                }))

            if error:
                # Send error before python_result so the frontend doesn't flash
                # a "success" state with a dump of stdout.
                await websocket.send(json.dumps(error_payload(error, "python")))

            await websocket.send(json.dumps({
                "type": "python_result",
                "success": error is None,
            }))

        elif msg_type == "hardware_connect":
            provider = msg.get("provider", "")
            credentials = msg.get("credentials", {})
            try:
                # connect_provider persists credentials to the OS keyring on
                # success so the next kernel start auto-reconnects without
                # the user re-entering a token. The frontend can discard
                # the in-memory copy as soon as the ack arrives.
                success = hardware_manager.connect_provider(provider, credentials)
                await websocket.send(json.dumps({
                    "type": "hardware_connected",
                    "provider": provider,
                    "success": success,
                }))
            except Exception as e:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Hardware connect failed: {e}",
                }))

        elif msg_type == "hardware_set_credentials":
            # Store credentials + attempt a connection in one step. Identical
            # to `hardware_connect` today — a separate message type is kept
            # so future work can e.g. persist-without-connect for deferred
            # activation without breaking existing clients.
            provider = msg.get("provider", "")
            credentials = msg.get("credentials", {})
            try:
                success = hardware_manager.connect_provider(provider, credentials)
                await websocket.send(json.dumps({
                    "type": "hardware_connected",
                    "provider": provider,
                    "success": success,
                }))
            except Exception as e:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Hardware set-credentials failed: {e}",
                }))

        elif msg_type == "hardware_clear_credentials":
            provider = msg.get("provider", "")
            try:
                hardware_manager.disconnect_provider(provider)
                await websocket.send(json.dumps({
                    "type": "hardware_connected",
                    "provider": provider,
                    "success": False,
                }))
            except Exception as e:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Hardware clear-credentials failed: {e}",
                }))

        elif msg_type == "hardware_connected_providers":
            # Read the keyring index so the frontend can reconcile its
            # "connected providers" UI after a reload without re-probing.
            try:
                providers = list(hardware_manager._connected)
                await websocket.send(json.dumps({
                    "type": "hardware_connected_providers",
                    "providers": providers,
                }))
            except Exception as e:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Failed to list connected providers: {e}",
                }))

        elif msg_type == "hardware_list_jobs":
            # Frontend asks this on WebSocket (re)connect to rehydrate
            # JobTracker from the persistent job store. Jobs that were
            # running when the kernel last died come back as `stale`.
            try:
                handles = hardware_manager.list_jobs()
                await websocket.send(json.dumps({
                    "type": "hardware_jobs",
                    "jobs": [h.to_dict() for h in handles],
                }))
            except Exception as e:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Failed to list jobs: {e}",
                }))

        elif msg_type == "hardware_list_backends":
            provider = msg.get("provider", None)
            try:
                backends = hardware_manager.list_backends(provider)
                await websocket.send(json.dumps({
                    "type": "hardware_backends",
                    "backends": [b.to_dict() for b in backends],
                }))
            except Exception as e:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Failed to list backends: {e}",
                }))

        elif msg_type == "hardware_submit":
            provider = msg.get("provider", "simulator")
            backend = msg.get("backend", "sim_qasm")
            shots = msg.get("shots", 1024)
            code = msg.get("code", "")
            try:
                # Routing (simulator passthrough, Q# → QIR for Azure, exec +
                # extract for Python on real hardware) lives in
                # _prepare_hardware_payload so it's unit-testable.
                # Off-thread because QIR compilation can take seconds and
                # would otherwise freeze the event loop for every client.
                payload = await asyncio.to_thread(
                    _prepare_hardware_payload, code, provider, backend, language
                )
                handle = hardware_manager.submit_job(provider, payload, backend, shots)
                await websocket.send(json.dumps({
                    "type": "hardware_job_submitted",
                    "job": handle.to_dict(),
                }))
            except Exception as e:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Hardware submit failed: {e}",
                }))

        elif msg_type == "hardware_status":
            job_id = msg.get("job_id", "")
            try:
                handle = hardware_manager.get_job_status(job_id)
                await websocket.send(json.dumps({
                    "type": "hardware_job_update",
                    "job": handle.to_dict(),
                }))
            except KeyError:
                # Stale job id — typically the kernel restarted mid-session,
                # losing its in-memory job registry. Tell the frontend the
                # job is no longer tracked in a friendly way so JobTracker
                # can mark it stale rather than surfacing a raw traceback.
                await websocket.send(json.dumps({
                    "type": "hardware_job_update",
                    "job": {
                        "id": job_id,
                        "provider": "unknown",
                        "backend": "unknown",
                        "status": "stale",
                        "queue_position": None,
                        "shots": 0,
                        "submitted_at": "",
                        "error": (
                            "This job is no longer tracked by the kernel "
                            "(the kernel may have restarted). Re-submit to run it again."
                        ),
                    },
                }))
            except Exception as e:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Job status lookup failed: {e}",
                }))

        elif msg_type == "hardware_results":
            job_id = msg.get("job_id", "")
            try:
                data = hardware_manager.get_results(job_id)
                await websocket.send(json.dumps({
                    "type": "hardware_result",
                    "job_id": job_id,
                    "data": data,
                }))
            except KeyError:
                await websocket.send(json.dumps({
                    "type": "hardware_result",
                    "job_id": job_id,
                    "data": {
                        "error": (
                            "Results for this job are no longer available "
                            "(the kernel may have restarted since it was submitted)."
                        ),
                        "status": "stale",
                    },
                }))
            except Exception as e:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Failed to get results: {e}",
                }))

        elif msg_type == "hardware_cancel":
            job_id = msg.get("job_id", "")
            try:
                ok = hardware_manager.cancel_job(job_id)
                await websocket.send(json.dumps({
                    "type": "hardware_job_cancelled",
                    "job_id": job_id,
                    "success": ok,
                }))
            except Exception as e:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Cancel failed: {e}",
                }))

        elif msg_type == "hardware_dismiss":
            # Bookkeeping only: drops the job record from the registry and
            # the persistent store. Never cancels provider-side work — use
            # hardware_cancel for that.
            job_id = msg.get("job_id", "")
            try:
                ok = hardware_manager.dismiss_job(job_id)
                await websocket.send(json.dumps({
                    "type": "hardware_job_dismissed",
                    "job_id": job_id,
                    "success": ok,
                }))
            except Exception as e:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Dismiss failed: {e}",
                }))

        elif msg_type == "agent_execute":
            # Dirac agent execution: run model-generated code in the disposable
            # worker subprocess (isolated from credentials + editor state) and
            # return a correlated result the frontend orchestrator awaits by
            # request_id. Field names match kernel/agent_protocol.py.
            request = {
                "protocol_version": 1,
                "request_id": str(msg.get("request_id", "invalid")),
                "action": msg.get("action"),
                "framework": msg.get("framework"),
                "language": msg.get("language"),
                "code": code,
            }
            if "shots" in msg:
                request["shots"] = msg.get("shots")
            for field in ("basis_gates", "coupling_map", "optimization_level"):
                if field in msg:
                    request[field] = msg.get(field)
            worker_response = await run_agent_worker(request)
            await websocket.send(json.dumps({
                "type": "agent_result",
                "request_id": worker_response.get("request_id", request["request_id"]),
                "status": worker_response.get("status", "error"),
                "snapshot": worker_response.get("snapshot"),
                "result": worker_response.get("result"),
                "stdout": worker_response.get("stdout", ""),
                "stderr": worker_response.get("stderr", ""),
                "error": worker_response.get("error"),
            }))

        else:
            await websocket.send(json.dumps({
                "type": "error",
                "message": f"Unknown message type: {msg_type}",
            }))


async def _try_serve(port: int):
    return await websockets.serve(
        handle_message,
        "localhost",
        port,
        max_size=MAX_MESSAGE_SIZE,
        ping_interval=PING_INTERVAL,
        ping_timeout=PING_TIMEOUT,
    )


async def main():
    last_error: Exception | None = None
    for offset in range(PORT_FALLBACK_RANGE):
        port = DEFAULT_PORT + offset
        try:
            server = await _try_serve(port)
        except OSError as e:
            last_error = e
            continue

        # Print chosen port on its own line so the Rust side can parse it if needed.
        print(f"Nuclei kernel ready on ws://localhost:{port}", flush=True)
        async with server:
            await asyncio.Future()  # Run forever
        return

    raise RuntimeError(
        f"Could not bind kernel on ports {DEFAULT_PORT}-{DEFAULT_PORT + PORT_FALLBACK_RANGE - 1}"
    ) from last_error


if __name__ == "__main__":
    asyncio.run(main())
