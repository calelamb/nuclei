"""Azure Quantum Resource Estimator wrapper (PRD 10 Phase F, `qec_estimate`).

Wraps the estimator shipped in the `qdk` package: `qsharp.estimate` for Q#
source (compiled + run against its entry expression) and
`qdk.openqasm.estimate` for OpenQASM 3 exported from a qiskit circuit. Both
return the same rich EstimatorResult JSON; we surface the headline numbers a
panel leads with and pass the full document through for the collapsible detail
and JSON export.

The estimator uses the same process-global, thread-pinned qdk interpreter the
Q# adapter drives, so every call goes through `_on_interpreter_thread` — never
a bare cross-thread interpreter touch.
"""

from __future__ import annotations

from kernel.models.errors import KernelError

# Curated presets the panel offers (names the estimator accepts verbatim).
QUBIT_PARAM_PRESETS = (
    "qubit_gate_ns_e3",
    "qubit_gate_ns_e4",
    "qubit_gate_us_e3",
    "qubit_gate_us_e4",
    "qubit_maj_ns_e4",
    "qubit_maj_ns_e6",
)
QEC_SCHEMES = ("surface_code", "floquet_code")

ESTIMATE_TIMEOUT_SECONDS = 90


def _build_params(options: dict | None) -> dict | None:
    """Translate the panel's {qubit_params, qec_scheme, error_budget} into the
    estimator's params dict. Returns None (estimator defaults) when empty."""
    if not options:
        return None
    params: dict = {}
    qp = options.get("qubit_params")
    if isinstance(qp, str) and qp in QUBIT_PARAM_PRESETS:
        params["qubitParams"] = {"name": qp}
    scheme = options.get("qec_scheme")
    if isinstance(scheme, str) and scheme in QEC_SCHEMES:
        params["qecScheme"] = {"name": scheme}
    budget = options.get("error_budget")
    if isinstance(budget, (int, float)) and 0 < float(budget) < 1:
        params["errorBudget"] = float(budget)
    return params or None


def _summarize(data: dict) -> dict:
    """Reduce the estimator's rich JSON to headline numbers + formatted
    strings, keeping the full document for the collapsible detail/export."""
    pc = data.get("physicalCounts", {}) if isinstance(data, dict) else {}
    breakdown = pc.get("breakdown", {}) if isinstance(pc, dict) else {}
    logical = data.get("logicalQubit", {}) if isinstance(data, dict) else {}
    job = data.get("jobParams", {}) if isinstance(data, dict) else {}
    return {
        "physical_qubits": pc.get("physicalQubits"),
        "runtime_ns": pc.get("runtime"),
        "rqops": pc.get("rqops"),
        "code_distance": logical.get("codeDistance"),
        "logical_error_rate": logical.get("logicalErrorRate"),
        "num_tfactories": breakdown.get("numTfactories"),
        "physical_qubits_algorithm": breakdown.get("physicalQubitsForAlgorithm"),
        "physical_qubits_tfactories": breakdown.get("physicalQubitsForTfactories"),
        "qubit_params": (job.get("qubitParams") or {}).get("name"),
        "qec_scheme": (job.get("qecScheme") or {}).get("name"),
        # Human-readable strings the estimator pre-formats.
        "formatted": data.get("physicalCountsFormatted", {}) if isinstance(data, dict) else {},
        # The complete document, for the collapsible detail + JSON export.
        "full": data,
    }


def _qiskit_code_to_qasm3(code: str) -> tuple[str | None, KernelError | None]:
    """Execute qiskit code, take the last QuantumCircuit, and export OpenQASM 3
    (measurements stripped — the estimator costs the unitary). Returns
    (qasm, error). Reuses the same exec model as parse/execute; the user is
    estimating their own code."""
    try:
        from qiskit import QuantumCircuit
        import qiskit.qasm3 as qasm3
    except ImportError as exc:
        return None, KernelError(
            code="missing_dependency",
            message="Qiskit is not installed, so its circuits cannot be resource-estimated.",
            framework="qiskit",
            dependency=exc.name or "qiskit",
        )
    namespace: dict = {"__builtins__": __builtins__}
    try:
        exec(code, namespace)  # noqa: S102 — user's own circuit, same as execute
    except Exception as exc:
        first = str(exc).strip().splitlines()[-1] if str(exc).strip() else type(exc).__name__
        return None, KernelError(code="execution_error", message=first, framework="qiskit")
    circuits = [v for v in namespace.values() if isinstance(v, QuantumCircuit)]
    if not circuits:
        return None, KernelError(
            code="no_circuit",
            message="No Qiskit QuantumCircuit found to estimate.",
            framework="qiskit",
        )
    circuit = circuits[-1].copy()
    try:
        circuit.remove_final_measurements(inplace=True)
    except Exception:
        pass
    try:
        return qasm3.dumps(circuit), None
    except Exception as exc:
        first = str(exc).strip().splitlines()[-1] if str(exc).strip() else type(exc).__name__
        return None, KernelError(code="qec_estimate_error", message=f"OpenQASM 3 export failed: {first}", framework="qiskit")


def estimate_resources(
    source: str, language: str, options: dict | None = None
) -> tuple[dict | None, KernelError | None]:
    """Run the Resource Estimator on `source`.

    `language` is 'qsharp' (compiled + estimated against its entry expression),
    'qasm3' (OpenQASM 3 directly), or 'qiskit' (Python code → QASM 3 → estimate).
    Returns (payload, error); a kernel without qdk degrades to
    `missing_dependency`.
    """
    import json

    # Qiskit path: convert to OpenQASM 3 first, then estimate as qasm3.
    if language == "qiskit":
        qasm, conv_error = _qiskit_code_to_qasm3(source)
        if conv_error is not None:
            return None, conv_error
        source = qasm or ""
        language = "qasm3"

    try:
        from kernel.adapters.qsharp_adapter import (
            QSHARP_AVAILABLE,
            _on_interpreter_thread,
            _resolve_entry,
            qsharp,
        )
    except ImportError:
        return None, KernelError(
            code="missing_dependency",
            message="Microsoft QDK is not installed, so resource estimation is unavailable.",
            framework="qsharp",
            dependency="qdk",
        )

    if not QSHARP_AVAILABLE or qsharp is None:
        return None, KernelError(
            code="missing_dependency",
            message="Microsoft QDK is not installed, so resource estimation is unavailable.",
            framework="qsharp",
            dependency="qdk",
        )

    params = _build_params(options)

    if language == "qsharp":
        entry = _resolve_entry(source)
        if entry is None:
            return None, KernelError(
                code="no_circuit",
                message=(
                    "No runnable entry operation found. Resource estimation needs a "
                    "zero-parameter entry (an operation named Main, or the only/last "
                    "zero-arg operation)."
                ),
                framework="qsharp",
            )

        def run():
            qsharp.eval(source)
            return qsharp.estimate(entry, params) if params else qsharp.estimate(entry)

    elif language == "qasm3":

        def run():
            import qdk.openqasm as oq

            return oq.estimate(source, params) if params else oq.estimate(source)

    else:
        return None, KernelError(
            code="qec_estimate_invalid",
            message=f"Resource estimation supports 'qsharp' and 'qasm3' sources, got {language!r}.",
        )

    try:
        result = _on_interpreter_thread(run, timeout=ESTIMATE_TIMEOUT_SECONDS)
    except Exception as exc:  # QSharpError, timeout, estimator failure
        first = str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__
        return None, KernelError(
            code="qec_estimate_error", message=first, framework="qsharp"
        )

    try:
        data = json.loads(result.json)
    except Exception:
        try:
            data = json.loads(str(result))
        except Exception:
            data = {}
    if not isinstance(data, dict) or "physicalCounts" not in data:
        return None, KernelError(
            code="qec_estimate_error",
            message="The estimator returned no physical-resource counts for this program.",
            framework="qsharp",
        )
    return _summarize(data), None
