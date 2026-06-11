"""
Quantinuum direct provider via pytket-quantinuum.

Highest-fidelity trapped-ion hardware in the public cloud. Students need a
Quantinuum Nexus account to get a token.
"""

import uuid
from datetime import datetime, timezone

from kernel.hardware.base import HardwareProvider, BackendInfo, JobHandle


class QuantinuumProvider(HardwareProvider):
    def __init__(self):
        self._backend_cls = None  # QuantinuumBackend class
        self._api_handler = None  # QuantinuumAPI validated at connect()
        self._token = None
        self._jobs: dict[str, tuple[str, object]] = {}  # job_id -> (device, handle)

    def connect(self, credentials: dict) -> bool:
        try:
            from pytket.extensions.quantinuum import QuantinuumAPI, QuantinuumBackend
            from pytket.extensions.quantinuum.backends.credential_storage import (
                MemoryCredentialStorage,
            )
        except ImportError:
            print(
                "Quantinuum provider requires pytket-quantinuum. "
                "Install with: pip install pytket-quantinuum"
            )
            return False

        token = credentials.get("token", "")
        if not token:
            print("Quantinuum connection requires a Nexus API token.")
            return False

        try:
            # Validate the token NOW with one cheap authenticated call,
            # instead of accepting any non-empty string. Previously a bad
            # token "connected" fine and only failed at submit time — and
            # confusingly, because the token never reached pytket's auth.
            #
            # pytket-quantinuum has no first-class raw-token parameter:
            # it authenticates through a QuantinuumAPI handler backed by
            # its own credential storage (normally filled by the SDK's
            # interactive login). Seeding an in-memory store with the
            # token is the closest programmatic seam the SDK exposes; the
            # device-list call below is what actually proves the token
            # works. If the installed SDK version only supports its own
            # login flow, this fails fast here with the hint printed
            # below rather than pretending to be connected.
            cred_store = MemoryCredentialStorage()
            cred_store.save_tokens(id_token=token, refresh_token=token)
            api_handler = QuantinuumAPI(token_store=cred_store)
            QuantinuumBackend.available_devices(api_handler=api_handler)

            self._backend_cls = QuantinuumBackend
            self._api_handler = api_handler
            self._token = token
            print("Connected to Quantinuum")
            return True
        except Exception as e:
            print(f"Quantinuum connection failed: {e}")
            print(
                "Check the Nexus API token (nexus.quantinuum.com). If your "
                "pytket-quantinuum version only supports its own login flow "
                "(QuantinuumAPI().login() / saved config credentials), "
                "complete that login and retry."
            )
            self._backend_cls = None
            self._api_handler = None
            self._token = None
            return False

    def _make_backend(self, device: str):
        """Construct a backend bound to the api_handler validated at
        connect(), so submits/polls authenticate with the same credentials
        the validation proved. Tests that wire `_backend_cls` directly
        (no handler) fall back to the SDK default."""
        if self._api_handler is not None:
            return self._backend_cls(device_name=device, api_handler=self._api_handler)
        return self._backend_cls(device_name=device)

    def list_backends(self) -> list[BackendInfo]:
        if self._backend_cls is None:
            return []

        # Quantinuum's public device list is small and well-known; hardcode
        # to avoid network calls for each status refresh.
        devices = [
            ("H1-1", 20),
            ("H2-1", 56),
            ("H1-1E", 20),    # emulator
            ("H1-1LE", 20),   # free-tier local emulator
        ]
        out: list[BackendInfo] = []
        for name, qubits in devices:
            out.append(BackendInfo(
                name=name,
                provider="quantinuum",
                qubit_count=qubits,
                connectivity=[],  # all-to-all for ion trap.
                queue_length=0,
                average_error_rate=0.0,
                gate_set=["RZZ", "PhasedX", "ZZ"],
                status="online",
            ))
        return out

    def _convert_to_pytket(self, circuit_obj):
        """Ensure the circuit is a pytket.Circuit the SDK can accept.

        The Quantinuum SDK expects pytket Circuits; a user editing Qiskit or
        Cirq code would previously hit an opaque pytket TypeError on submit.
        This helper auto-detects Qiskit / Cirq circuits and converts them via
        the matching pytket-extensions package, or surfaces a clear install
        hint if the extension isn't available.

        Returns (pytket_circuit, error_message). Exactly one is not None.
        """
        # Already a pytket circuit — nothing to do. We can't cheaply verify
        # the type without importing pytket, so fall through when nothing
        # more specific matches.
        try:
            from qiskit import QuantumCircuit as _QiskitCircuit
        except ImportError:
            _QiskitCircuit = None

        try:
            import cirq as _cirq
        except ImportError:
            _cirq = None

        if _QiskitCircuit is not None and isinstance(circuit_obj, _QiskitCircuit):
            try:
                from pytket.extensions.qiskit import qiskit_to_tk
            except ImportError:
                return None, (
                    "Quantinuum requires pytket-extensions-qiskit to run "
                    "Qiskit circuits. Install with: "
                    "pip install pytket-extensions-qiskit"
                )
            try:
                return qiskit_to_tk(circuit_obj), None
            except Exception as e:
                return None, f"Qiskit → pytket conversion failed: {e}"

        if _cirq is not None and isinstance(circuit_obj, _cirq.Circuit):
            try:
                from pytket.extensions.cirq import cirq_to_tk
            except ImportError:
                return None, (
                    "Quantinuum requires pytket-extensions-cirq to run "
                    "Cirq circuits. Install with: "
                    "pip install pytket-extensions-cirq"
                )
            try:
                return cirq_to_tk(circuit_obj), None
            except Exception as e:
                return None, f"Cirq → pytket conversion failed: {e}"

        # Assume native pytket — let the SDK surface any remaining mismatch.
        return circuit_obj, None

    def submit_job(self, circuit_obj, backend: str, shots: int) -> JobHandle:
        if self._backend_cls is None:
            raise RuntimeError("Quantinuum provider not connected. Call connect() first.")

        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        pytket_circuit, conv_error = self._convert_to_pytket(circuit_obj)
        if conv_error is not None:
            return JobHandle(
                id=job_id,
                provider="quantinuum",
                backend=backend,
                status="failed",
                queue_position=None,
                shots=shots,
                submitted_at=now,
                error=conv_error,
            )

        try:
            qb = self._make_backend(backend)
            compiled = qb.get_compiled_circuit(pytket_circuit)
            handle = qb.process_circuit(compiled, n_shots=shots)
            self._jobs[job_id] = (backend, handle)
            return JobHandle(
                id=job_id,
                provider="quantinuum",
                backend=backend,
                status="queued",
                queue_position=None,
                shots=shots,
                submitted_at=now,
            )
        except Exception as e:
            return JobHandle(
                id=job_id,
                provider="quantinuum",
                backend=backend,
                status="failed",
                queue_position=None,
                shots=shots,
                submitted_at=now,
                error=f"Quantinuum submit failed: {e}",
            )

    def get_results(self, job: JobHandle) -> dict:
        entry = self._jobs.get(job.id)
        if entry is None or self._backend_cls is None:
            return {"error": f"Job {job.id} not found"}
        device, handle = entry
        try:
            qb = self._make_backend(device)
            status = qb.circuit_status(handle).status.name.lower()
            if status == "completed":
                result = qb.get_result(handle)
                counts_map = result.get_counts()
                # pytket counts are keyed by tuples of outcomes; flatten.
                counts = {"".join(str(b) for b in k): int(v) for k, v in counts_map.items()}
                return {"measurements": counts, "status": "complete"}
            if status in ("error", "cancelled"):
                return {"error": f"Circuit status: {status}", "status": "failed"}
            return {"status": "running", "message": f"Circuit status: {status}"}
        except Exception as e:
            return {"error": f"Failed to get results: {e}"}

    def get_queue_position(self, job: JobHandle) -> int:
        entry = self._jobs.get(job.id)
        if entry is None or self._backend_cls is None:
            return -1
        device, handle = entry
        try:
            qb = self._make_backend(device)
            # pytket's CircuitStatus.queue_position is optional; best-effort.
            st = qb.circuit_status(handle)
            queue = getattr(st, "queue_position", None)
            return int(queue) if queue is not None else -1
        except Exception:
            return -1

    def cancel_job(self, job: JobHandle) -> bool:
        entry = self._jobs.get(job.id)
        if entry is None or self._backend_cls is None:
            return True
        device, handle = entry
        try:
            qb = self._make_backend(device)
            qb.cancel(handle)
            return True
        except Exception:
            return False
