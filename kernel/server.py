import asyncio
import json
import platform
import signal
import sys
import os
from importlib import metadata as importlib_metadata

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
            # New session/process group so a timeout can reap the worker AND any
            # children it spawned (fork-bomb containment, since the worker no
            # longer sets RLIMIT_NPROC — see kernel/agent_limits.py).
            start_new_session=True,
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

            # QEC sidecar (protocol v1.2 / PRD 10 Phase A): stim circuits
            # additionally get detector-graph + coordinate data. Additive —
            # non-stim frameworks and older clients see no new messages.
            if snapshot is not None and snapshot.framework == "stim":
                qec_payload, qec_error = await asyncio.to_thread(
                    executor.qec_snapshot_payload
                )
                if qec_payload is not None and qec_error is None:
                    await websocket.send(json.dumps({
                        "type": "qec_snapshot",
                        "data": qec_payload,
                    }))

            if error:
                await websocket.send(json.dumps(error_payload(error, "parse")))

        elif msg_type == "execute":
            shots = msg.get("shots", 1024)

            # Optional protocol v1.1 fields (PRD 09 Phase B) — both
            # additive, omitted by older clients. Validate defensively at
            # this boundary rather than trusting the wire payload: a
            # malformed `params` degrades to "no params" instead of
            # crashing the connection, and a non-numeric `seed` is dropped
            # the same way.
            params = msg.get("params")
            if not isinstance(params, dict):
                params = None

            seed = msg.get("seed")
            if seed is not None:
                try:
                    seed = int(seed)
                except (TypeError, ValueError):
                    seed = None

            # Simulation can take multiple seconds — must not block the loop.
            result, snapshot, stdout, stderr, error = await asyncio.to_thread(
                executor.execute, code, shots, language=language, params=params, seed=seed
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

            # QEC sidecar (protocol v1.2 / PRD 10 Phase A) — see the parse
            # handler. Sent between snapshot and result so clients that
            # await `result` as the exchange terminator see it in-stream.
            if snapshot is not None and snapshot.framework == "stim" and error is None:
                qec_payload, qec_error = await asyncio.to_thread(
                    executor.qec_snapshot_payload
                )
                if qec_payload is not None and qec_error is None:
                    await websocket.send(json.dumps({
                        "type": "qec_snapshot",
                        "data": qec_payload,
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

        elif msg_type == "transpile":
            # Transpiler Explorer (dev tools Phase 1): run a Qiskit preset
            # PassManager for a target and stream back before/after snapshots,
            # metric deltas, and pass-by-pass data. Additive — unknown to
            # older clients, and Qiskit-only (the only introspectable compiler).
            #
            # Validate the target defensively at this boundary: a malformed
            # basis_gates / coupling_map / optimization_level degrades to the
            # unconstrained default rather than crashing the connection.
            basis_gates = msg.get("basis_gates")
            if not (isinstance(basis_gates, list) and all(isinstance(g, str) for g in basis_gates)):
                basis_gates = None

            coupling_map = msg.get("coupling_map")
            if isinstance(coupling_map, list) and all(
                isinstance(edge, (list, tuple))
                and len(edge) == 2
                and all(isinstance(q, int) for q in edge)
                for edge in coupling_map
            ):
                coupling_map = [[int(a), int(b)] for a, b in coupling_map]
            else:
                coupling_map = None

            optimization_level = msg.get("optimization_level", 1)
            if not isinstance(optimization_level, int) or optimization_level not in (0, 1, 2, 3):
                optimization_level = 1

            # Transpilation can run many passes — offload so heartbeats flow.
            payload, stdout, stderr, error = await asyncio.to_thread(
                executor.transpile_explore,
                code,
                basis_gates=basis_gates,
                coupling_map=coupling_map,
                optimization_level=optimization_level,
                language=language,
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

            if error:
                await websocket.send(json.dumps(error_payload(error, "transpile")))
                await websocket.send(json.dumps({
                    "type": "transpile_result",
                    "data": None,
                }))
            else:
                await websocket.send(json.dumps({
                    "type": "transpile_result",
                    "data": payload,
                }))

        elif msg_type == "debug_trace":
            # Quantum Debugger (dev tools Phase 3): compute the per-gate state
            # trajectory in one call so the frontend scrubber shows the state at
            # each step instantly. Additive; Qiskit/Cirq only. Off-thread — a
            # long trajectory must not block heartbeats.
            payload, stdout, stderr, error = await asyncio.to_thread(
                executor.debug_trace, code, language=language
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

            if error:
                await websocket.send(json.dumps(error_payload(error, "debug")))
                await websocket.send(json.dumps({
                    "type": "debug_trace_result",
                    "data": None,
                }))
            else:
                await websocket.send(json.dumps({
                    "type": "debug_trace_result",
                    "data": payload,
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

        elif msg_type == "qec_snapshot":
            # Protocol v1.2 (PRD 10 Phase A): (re)compute the QEC sidecar,
            # optionally at a caller-chosen DEM edge cap ("render anyway").
            # With `code` it is stateless; without, it reuses the last stim
            # circuit this connection parsed or executed.
            max_edges = msg.get("max_edges")
            if max_edges is not None:
                try:
                    max_edges = int(max_edges)
                except (TypeError, ValueError):
                    max_edges = None
            qec_code = msg.get("code") if isinstance(msg.get("code"), str) else None
            qec_payload, qec_error = await asyncio.to_thread(
                lambda: executor.qec_snapshot_payload(
                    code=qec_code, language=language, max_edges=max_edges
                )
            )
            if qec_error is not None:
                await websocket.send(json.dumps(error_payload(qec_error, "qec_snapshot")))
            else:
                await websocket.send(json.dumps({
                    "type": "qec_snapshot",
                    "data": qec_payload,
                }))

        elif msg_type == "qec_materialize":
            # Protocol v1.2 (PRD 10 Phase C): run a campaign's Python entry
            # source and collect its labeled circuits via the
            # nuclei_circuits(noise) contract.
            from kernel.qec.materialize import materialize_circuits

            noise = msg.get("noise")
            circuits, mat_stdout, mat_stderr, mat_error = await asyncio.to_thread(
                materialize_circuits, executor, code, noise
            )
            if mat_stdout:
                await websocket.send(json.dumps({"type": "output", "text": mat_stdout}))
            if mat_stderr:
                await websocket.send(json.dumps({"type": "stderr", "text": mat_stderr}))
            if mat_error is not None:
                await websocket.send(json.dumps(error_payload(mat_error, "qec_materialize")))
            else:
                await websocket.send(json.dumps({
                    "type": "qec_circuits",
                    "circuits": circuits,
                }))

        elif msg_type == "qec_estimate":
            # Protocol v1.2 (PRD 10 Phase F): Azure Quantum Resource Estimator
            # over Q# source or OpenQASM 3. Off-thread (estimation can take
            # several seconds); the estimator itself runs on the pinned qdk
            # interpreter thread inside estimate_resources.
            from kernel.qec.estimate import estimate_resources

            est_language = msg.get("language", "qsharp")
            est_options = msg.get("options")
            if not isinstance(est_options, dict):
                est_options = None
            payload, est_error = await asyncio.to_thread(
                estimate_resources, code, est_language, est_options
            )
            if est_error is not None:
                await websocket.send(json.dumps(error_payload(est_error, "qec_estimate")))
            else:
                await websocket.send(json.dumps({
                    "type": "qec_estimate_result",
                    "data": payload,
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
