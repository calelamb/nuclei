"""Hardware submission, split across the worker boundary (design note row 9).

The worker runs the user's program and picks the circuit object a provider needs
(:func:`extract_circuit_for_provider`); it cannot hand a live object to the server, so the circuit
is serialized (:func:`serialize_circuit`: Qiskit QPY or Cirq JSON, both text-safe) and the server
rebuilds it (:func:`deserialize_circuit`) for ``provider.submit_job``.  CUDA-Q kernels are Python
callables and cannot leave the worker, so a CUDA-Q submission to hardware is reported as
``hardware_payload_unsupported``.
"""

from __future__ import annotations

import base64
import io

#: Providers whose submit path is a Python circuit object, in the order frameworks are tried.
PROVIDER_FRAMEWORK_ORDER = {
    "ibm": ("qiskit", "cirq", "cudaq"),
    "ionq": ("qiskit", "cirq", "cudaq"),
    "braket": ("qiskit", "cirq", "cudaq"),
    "azure": ("qiskit", "cirq", "cudaq"),
    "quantinuum": ("qiskit", "cirq", "cudaq"),
    "nvidia": ("cudaq", "qiskit", "cirq"),
    "simulator": ("qiskit", "cirq", "cudaq"),
}
DEFAULT_ORDER = ("qiskit", "cirq", "cudaq")


def extract_circuit_for_provider(namespace: dict, provider: str):
    """Find the circuit object a student defined in their code.

    Provider-specific search order so Qiskit code submitted to a Qiskit-native
    provider (IBM, IonQ, Quantinuum, Braket, Azure) finds a QuantumCircuit
    before any Cirq Circuit that may also be defined. Returns None if nothing
    recognizable is defined — caller should surface a friendly error."""
    for kind in PROVIDER_FRAMEWORK_ORDER.get(provider, DEFAULT_ORDER):
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


def serialize_circuit(circuit) -> dict | None:
    """``{"kind", "payload"}`` for a Qiskit or Cirq circuit, or ``None`` when it cannot travel."""
    try:
        from qiskit import QuantumCircuit

        if isinstance(circuit, QuantumCircuit):
            from qiskit import qpy

            buffer = io.BytesIO()
            qpy.dump(circuit, buffer)
            return {"kind": "qpy", "payload": base64.b64encode(buffer.getvalue()).decode("ascii")}
    except ImportError:
        pass
    try:
        import cirq

        if isinstance(circuit, cirq.Circuit):
            return {"kind": "cirq_json", "payload": cirq.to_json(circuit)}
    except ImportError:
        pass
    return None


def deserialize_circuit(wire: dict):
    kind, payload = wire.get("kind"), wire.get("payload", "")
    if kind == "qpy":
        from qiskit import qpy

        return qpy.load(io.BytesIO(base64.b64decode(payload)))[0]
    if kind == "cirq_json":
        import cirq

        return cirq.read_json(json_text=payload)
    raise ValueError(f"unknown circuit payload kind {kind!r}")
