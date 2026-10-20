import asyncio
import json
import logging
import platform
import signal
import sys
import os
from importlib import metadata as importlib_metadata

# Make the `kernel` package importable and keep Nuclei's own modules from leaking into a researcher's
# imports. Launched as `python <kernel_dir>/server.py` the script's directory is sys.path[0], which
# would make `models`, `adapters` or `auth` importable as top-level names; launched as
# `python -m kernel.server` it is the cwd. Strip it either way and put the repo root first (design
# note section 2.15). Run workers build their own sys.path from scratch under `-I`.
_KERNEL_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_KERNEL_DIR)
sys.path[:] = [p for p in sys.path if os.path.realpath(p or os.getcwd()) != _KERNEL_DIR]
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

# Opt out of Microsoft qdk's Azure Application Insights telemetry for the
# whole kernel process — must precede any qdk import, including user code
# running `import qdk` through run_python. setdefault keeps an explicit
# user override. (Also set in kernel/adapters/qsharp_adapter.py for
# embedders that use the adapter without this server.)
os.environ.setdefault("QDK_PYTHON_TELEMETRY", "none")

# The explicit asyncio implementation (websockets >= 13.0). Bare
# ``websockets.serve`` is the *legacy* server before 14.0, whose
# ``process_request(path, headers)`` hook has a different signature: on the
# pinned 13.x the auth hook crashed every handshake with HTTP 500.
from websockets.asyncio.server import serve as ws_serve
from kernel import auth, framework_detect, run_context, run_worker
from kernel.executor import Executor, ruff_base_cmd
from kernel.hardware.manager import HardwareManager
from kernel.models.errors import error_payload
from kernel.run_hardware import extract_circuit_for_provider as _extract_circuit_for_provider
from kernel.run_routes import ROUTED_TYPES, RunRoutes

logger = logging.getLogger(__name__)

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
            # New session/process group so a timeout can reap the worker AND any
            # children it spawned (fork-bomb containment, since the worker no
            # longer sets RLIMIT_NPROC — see kernel/agent_limits.py).
            start_new_session=True,
            # Never hand the kernel token to model-generated code.
            env=auth.scrubbed_environment(),
        )
    except OSError as exc:
        return _agent_error(request_id, "worker_spawn_failed", str(exc))

    try:
        stdout, _ = await asyncio.wait_for(
            proc.communicate(input=payload), timeout=_AGENT_WORKER_WALL_SECONDS
        )
    except asyncio.TimeoutError:
        _kill_process_group(proc)
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


def _kill_process_group(proc) -> None:
    """SIGKILL the worker's whole process group (it was started in its own
    session), reaping any children a runaway request spawned. Falls back to
    killing just the process if the group can't be resolved."""
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except ProcessLookupError:
            pass


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

# QEC campaign manager (protocol v1.2 / PRD 10 Phase B) — one campaign at a
# time per kernel; lazily constructed so the kernel imports cleanly without
# the QEC toolchain installed.
_campaign_manager = None


def get_campaign_manager():
    global _campaign_manager
    if _campaign_manager is None:
        from kernel.qec.campaign import CampaignManager

        _campaign_manager = CampaignManager()
    return _campaign_manager


# `framework_detect.looks_like_qsharp` is the single source of truth for "does this
# source look like Q#?" — reused here so hardware submissions from older
# clients (which omit the `language` field) still route correctly.

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
    is_qsharp = language == "qsharp" or framework_detect.looks_like_qsharp(code)

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

    # The kernel server never gets here: `hardware_submit` runs the program in a run worker
    # (`RunRoutes.prepare_python_circuit`). This stays for embedders and unit tests, and the tripwire
    # makes a server-process caller fail loudly.
    run_context.assert_inprocess_exec_allowed("_prepare_hardware_payload")
    namespace = {"__builtins__": __builtins__}
    exec(code, namespace)
    circuit_obj = _extract_circuit_for_provider(namespace, provider)
    if circuit_obj is None:
        raise RuntimeError(
            "No circuit object found in the code. "
            "Your code must define a Qiskit QuantumCircuit, Cirq Circuit, or CUDA-Q kernel."
        )
    return circuit_obj


# ───────── environment (protocol v1.1 / PRD 09 Phase B) ─────────
#
# Reports interpreter + platform + installed-framework versions, used by
# the experiment runner (PRD 09 Phase C) to stamp manifests and generally
# useful for bug reports. Each canonical key tries its candidate PyPI
# distribution names in order — this is deliberately NOT just the adapters'
# import-name dependency tuples, because a distribution's import name and
# PyPI name diverge in practice (e.g. `import cirq` is provided by the
# `cirq-core` distribution in a minimal install with no `cirq` metapackage;
# the Q# runtime is the `qdk` package with a `qsharp` compatibility shim
# also installed under some setups). Verified empirically against the
# kernel venv at implementation time rather than assumed.
_ENVIRONMENT_PACKAGE_CANDIDATES: dict[str, tuple[str, ...]] = {
    "qiskit": ("qiskit",),
    "qiskit_aer": ("qiskit_aer", "qiskit-aer"),
    "cirq": ("cirq", "cirq-core"),
    "cudaq": ("cudaq", "cuda-quantum"),
    "qsharp": ("qdk", "qsharp"),
    # QEC toolchain (protocol v1.2 / PRD 10) — campaign manifests stamp
    # these versions; absent keys mean "not installed", as everywhere.
    "stim": ("stim",),
    "sinter": ("sinter",),
    "pymatching": ("pymatching",),
    "fusion_blossom": ("fusion-blossom", "fusion_blossom"),
}


def _collect_package_versions() -> dict[str, str]:
    """Best-effort installed-version lookup — never raises.

    Omits any canonical package whose candidate distributions are all
    absent (or whose metadata lookup fails for any other reason).
    """
    versions: dict[str, str] = {}
    for key, candidates in _ENVIRONMENT_PACKAGE_CANDIDATES.items():
        for candidate in candidates:
            try:
                versions[key] = importlib_metadata.version(candidate)
                break
            except Exception:
                continue
    return versions


def _build_environment_payload() -> dict:
    """Build the `environment` response payload. Never raises."""
    try:
        python_version = platform.python_version()
    except Exception:
        python_version = "unknown"
    try:
        platform_str = platform.platform()
    except Exception:
        platform_str = "unknown"
    return {
        "python": python_version,
        "platform": platform_str,
        "packages": _collect_package_versions(),
    }


async def handle_message(websocket):
    from kernel.lab_context import owner_for_connection

    # Per-connection executor (handed to the Lab handlers) — prevents state bleeding across
    # concurrent WS clients (e.g. reconnect races). It never runs user code in this process.
    executor = Executor()
    routes = RunRoutes(websocket, owner_for_connection(websocket), asyncio.get_running_loop())
    try:
        await _message_loop(websocket, executor, routes)
    finally:
        await routes.aclose(connection_closed=getattr(websocket, "close_code", None) is not None)


async def _hardware_payload(routes: RunRoutes, msg: dict, code: str, provider: str, backend: str, language, shots):
    """What ``hardware_manager.submit_job`` receives, with user code only ever running in a worker.

    - local simulator: the program runs on the run lane (any language) and the finished run is
      handed over (``PrecomputedRun``), instead of blocking the event loop in-process;
    - Python for a real device: a worker runs the program and returns the circuit it defines;
    - Q# for Azure Quantum (compiled to QIR, no Python exec): ``_prepare_hardware_payload``, off-thread.
    """
    is_qsharp = language == "qsharp" or framework_detect.looks_like_qsharp(code)
    if provider == "simulator":
        return await routes.simulate_for_hardware(msg, code, shots if isinstance(shots, int) else 1024, language)
    if is_qsharp:
        return await asyncio.to_thread(_prepare_hardware_payload, code, provider, backend, language)
    return await routes.prepare_python_circuit(msg, code, provider, language)


async def _message_loop(websocket, executor: Executor, routes: RunRoutes):
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

        if msg_type in ROUTED_TYPES:
            # Everything that executes user code goes through the warm run-worker pool
            # (kernel/run_routes.py): the server process never runs it, a runaway program cannot
            # wedge this connection, and the loop keeps reading (run_cancel, newer parses).
            await routes.dispatch(msg_type, msg)

        elif msg_type == "lint":
            # Editor diagnostics via ruff (dev tools Phase 4). Additive;
            # Python-only. Off-thread (subprocess) so typing stays responsive.
            diagnostics, error = await asyncio.to_thread(
                executor.lint, code, language=language
            )
            if error:
                await websocket.send(json.dumps(error_payload(error, "lint")))
            lint_frame = {"type": "lint_result", "diagnostics": diagnostics, "available": True}
            if language != "qsharp" and ruff_base_cmd() is None:
                lint_frame.update(available=False, reason="The linter (ruff) is not installed in this kernel's environment.")
            await websocket.send(json.dumps(lint_frame))

        elif msg_type == "format":
            # Format the buffer via ruff (dev tools Phase 4). Additive;
            # Python-only.
            formatted, error = await asyncio.to_thread(
                executor.format_code, code, language=language
            )
            if error:
                await websocket.send(json.dumps(error_payload(error, "format")))
                await websocket.send(json.dumps({
                    "type": "format_result",
                    "formatted": None,
                }))
            else:
                await websocket.send(json.dumps({
                    "type": "format_result",
                    "formatted": formatted,
                }))

        elif msg_type == "environment":
            # Cheap (importlib.metadata lookups only) — no need to offload
            # to a thread. Never raises: see _build_environment_payload.
            payload = _build_environment_payload()
            await websocket.send(json.dumps({
                "type": "environment",
                "python": payload["python"],
                "platform": payload["platform"],
                "packages": payload["packages"],
            }))

        elif msg_type == "qec_generate":
            # Protocol v1.2 (PRD 10 Phase A): generate a built-in QEC
            # circuit (stim's generator set) and return its text. The
            # frontend writes it into a real project file — never a hidden
            # circuit.
            gen_code = msg.get("code", "")
            distance = msg.get("distance")
            rounds = msg.get("rounds")
            noise = msg.get("noise")
            if not isinstance(noise, dict):
                noise = None
            try:
                from kernel.qec.generate import QecGenerateError, generate_circuit

                try:
                    circuit_text = await asyncio.to_thread(
                        generate_circuit, gen_code, distance, rounds, noise
                    )
                except QecGenerateError as e:
                    await websocket.send(json.dumps({
                        "type": "error",
                        "message": str(e),
                        "code": "qec_generate_invalid",
                        "phase": "qec_generate",
                    }))
                    continue
                await websocket.send(json.dumps({
                    "type": "qec_generated",
                    "code": gen_code,
                    "distance": distance,
                    "rounds": rounds,
                    "circuit_text": circuit_text,
                }))
            except ImportError:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": "Stim is not installed, so QEC circuits cannot be generated in this environment.",
                    "code": "missing_dependency",
                    "phase": "qec_generate",
                    "framework": "stim",
                    "dependency": "stim",
                }))

        elif msg_type == "qec_campaign_start":
            # Protocol v1.2 (PRD 10 Phase B): launch a sinter Monte Carlo
            # campaign. Ack immediately; qec_campaign_progress (throttled)
            # and qec_campaign_result stream back from the collect thread.
            collect_options = msg.get("collect")
            if not isinstance(collect_options, dict):
                collect_options = {}

            async def _send_json(payload: dict) -> None:
                try:
                    await websocket.send(json.dumps(payload))
                except Exception:
                    # Connection gone mid-campaign — the campaign finishes
                    # (or is cancelled) on its own; nothing to notify.
                    pass

            started, campaign_error = get_campaign_manager().start(
                campaign_id=msg.get("campaign_id"),
                tasks_payload=msg.get("tasks"),
                max_shots=collect_options.get("max_shots"),
                max_errors=collect_options.get("max_errors"),
                workers=msg.get("workers", "auto"),
                existing_stats_csv=msg.get("existing_stats_csv"),
                progress_interval_s=msg.get("progress_interval_s"),
                loop=asyncio.get_running_loop(),
                send_json=_send_json,
            )
            if campaign_error is not None:
                await websocket.send(json.dumps(error_payload(campaign_error, "qec_campaign")))
            else:
                await websocket.send(json.dumps(started))

        elif msg_type == "qec_campaign_cancel":
            accepted = get_campaign_manager().cancel(msg.get("campaign_id"))
            # Ack synchronously; the partial qec_campaign_result follows
            # from the collect thread once sinter's workers wind down.
            await websocket.send(json.dumps({
                "type": "qec_campaign_cancelled",
                "campaign_id": msg.get("campaign_id"),
                "accepted": accepted,
            }))

        elif msg_type == "qec_decode_sample":
            from kernel.qec.campaign import decode_sample

            decoded, decode_error = await asyncio.to_thread(
                decode_sample,
                msg.get("circuit_text", ""),
                msg.get("decoder", "pymatching"),
                msg.get("seed"),
            )
            if decode_error is not None:
                await websocket.send(json.dumps(error_payload(decode_error, "qec_decode_sample")))
            else:
                await websocket.send(json.dumps({
                    "type": "qec_decode_sample",
                    **decoded,
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
                payload = await _hardware_payload(routes, msg, code, provider, backend, language, shots)
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
            reply = {
                "type": "agent_result",
                "request_id": worker_response.get("request_id", request["request_id"]),
                "status": worker_response.get("status", "error"),
                "snapshot": worker_response.get("snapshot"),
                "result": worker_response.get("result"),
                "stdout": worker_response.get("stdout", ""),
                "stderr": worker_response.get("stderr", ""),
                "error": worker_response.get("error"),
            }
            if worker_response.get("snapshot_error"):
                reply["snapshot_error"] = worker_response["snapshot_error"]
            await websocket.send(json.dumps(reply))

        elif isinstance(msg_type, str) and msg_type.startswith(_LAB_MESSAGE_PREFIXES):
            # Protocol v1.3 (PRD 14): Trainability Lab + Discovery Engine.
            # Each package owns its handlers and job managers; this branch
            # only routes and hands over a thread-safe sender.
            await _route_lab_message(msg, executor, websocket)

        else:
            await websocket.send(json.dumps({
                "type": "error",
                "message": f"Unknown message type: {msg_type}",
            }))


_LAB_MESSAGE_PREFIXES = ("trainability_", "discovery_")


def _lab_context(executor: Executor, websocket) -> "LabContext":
    from kernel.lab_context import LabContext, owner_for_connection

    async def _send_json(payload: dict) -> None:
        try:
            text = json.dumps(payload)
        except (TypeError, ValueError) as exc:
            # A payload that cannot be serialised is a kernel bug; the client must hear about it
            # instead of waiting forever for a reply that was silently dropped.
            logger.error("Lab payload %r is not JSON-serialisable: %s", _payload_type(payload), exc)
            text = json.dumps(_serialization_error(payload, exc))
        try:
            await websocket.send(text)
        except Exception:
            # Connection gone mid-job; the job winds down on its own.
            pass

    return LabContext(
        executor=executor,
        send_json=_send_json,
        loop=asyncio.get_running_loop(),
        owner=owner_for_connection(websocket),
    )


def _payload_type(payload) -> str:
    return str(payload.get("type")) if isinstance(payload, dict) else type(payload).__name__


def _lab_phase(msg_type) -> str:
    return "trainability" if isinstance(msg_type, str) and msg_type.startswith("trainability_") else "discovery"


def _lab_error(phase: str, code: str, message: str, msg: dict | None = None) -> dict:
    """A Lab error envelope carrying the ids (job/run/candidate/request) of the request that caused it."""
    from kernel.lab_protocol import with_request_id

    payload: dict = {"type": "error", "phase": phase, "code": code, "message": message}
    for key in ("job_id", "run_id", "candidate_id"):
        value = (msg or {}).get(key)
        if isinstance(value, str) and value:
            payload[key] = value[:200]
    return with_request_id(payload, msg)


def _serialization_error(payload, exc: BaseException) -> dict:
    ids = payload if isinstance(payload, dict) else {}
    phase = ids.get("phase") if isinstance(ids.get("phase"), str) else _lab_phase(ids.get("type"))
    return _lab_error(phase, "serialization_failed",
                      f"The kernel could not serialise its '{_payload_type(payload)}' reply: {type(exc).__name__}: {exc}"[:500],
                      ids)


async def _route_lab_message(msg: dict, executor: Executor, websocket) -> None:
    msg_type = msg.get("type")
    phase = _lab_phase(msg_type)
    ctx = _lab_context(executor, websocket)
    try:
        if phase == "trainability":
            from kernel.trainability.handlers import handle as handle_trainability
            await handle_trainability(msg, ctx)
        else:
            from kernel.discovery.handlers import handle as handle_discovery
            await handle_discovery(msg, ctx)
    except Exception as exc:  # noqa: BLE001 - last resort: one bad Lab message must never close the socket
        logger.exception("Lab handler for %s failed", msg_type)
        await ctx.send_json(_lab_error(phase, f"{phase}_internal", f"{type(exc).__name__}: {exc}"[:500], msg))


async def _handle_connection(websocket):
    try:
        await handle_message(websocket)
    finally:
        # Cancel any Lab jobs this connection owns so a closed window never
        # leaves a gradient sweep or discovery evaluation burning CPU.
        from kernel.lab_context import owner_for_connection, release_owner
        release_owner(owner_for_connection(websocket))
        if run_worker.pool_started():
            run_worker.get_pool().release_owner(owner_for_connection(websocket))


async def _try_serve(port: int, auth_config: auth.KernelAuthConfig):
    return await ws_serve(
        auth.secure_handler(
            _handle_connection, auth_config, max_size_after_auth=MAX_MESSAGE_SIZE
        ),
        "localhost",
        port,
        process_request=auth.make_process_request(auth_config),
        max_size=auth.PRE_AUTH_MAX_SIZE,  # raised to MAX_MESSAGE_SIZE after auth
        ping_interval=PING_INTERVAL,
        ping_timeout=PING_TIMEOUT,
    )


def _publish_runtime_file(
    auth_config: auth.KernelAuthConfig, port: int, runtime_dir=None
):
    """Write the runtime file for local scripts; a failure only costs them
    discovery, so log it clearly and keep serving the desktop app."""
    try:
        return auth.write_runtime_file(auth_config, port, runtime_dir)
    except OSError as e:
        print(
            f"Nuclei kernel could not write its runtime file ({e}); local "
            "scripts will need the token supplied another way.",
            file=sys.stderr,
            flush=True,
        )
        return None


async def main():
    # Fail closed: raises AuthConfigError unless a token (or the explicit
    # insecure-dev flag) is configured.
    try:
        auth_config = auth.config_from_env()
    except auth.AuthConfigError as e:
        print(f"Nuclei kernel refused to start: {e}", file=sys.stderr, flush=True)
        raise SystemExit(2) from e

    # User code never runs in this process: it runs in the run-worker pool. The tripwire turns a
    # missed path into a loud InProcessExecForbidden instead of a silent in-process exec.
    run_context.forbid_inprocess_exec()
    # Matplotlib must never open a window for user code (audit R-12); workers also get this.
    os.environ.setdefault("MPLBACKEND", "Agg")

    # The desktop app hardcodes the canonical port; when it owns the launch it
    # must not silently fall back to a neighbouring port.
    strict_port = os.environ.get(auth.STRICT_PORT_ENV) == "1"
    attempts = 1 if strict_port else PORT_FALLBACK_RANGE

    last_error: Exception | None = None
    for offset in range(attempts):
        port = DEFAULT_PORT + offset
        try:
            server = await _try_serve(port, auth_config)
        except OSError as e:
            last_error = e
            continue

        _publish_runtime_file(auth_config, port)

        # Print chosen port on its own line so the Rust side can parse it if needed.
        print(f"Nuclei kernel ready on ws://localhost:{port}", flush=True)
        # Warm the run workers only after the ready line, so the import cost never eats into the
        # shell's startup timeout; the first parse waits for them exactly as an in-process import did.
        run_worker.get_pool().start()
        try:
            async with server:
                await asyncio.Future()  # Run forever
        finally:
            run_worker.shutdown_pool()
        return

    raise RuntimeError(
        f"Could not bind kernel on ports {DEFAULT_PORT}-{DEFAULT_PORT + PORT_FALLBACK_RANGE - 1}"
    ) from last_error


if __name__ == "__main__":
    asyncio.run(main())
