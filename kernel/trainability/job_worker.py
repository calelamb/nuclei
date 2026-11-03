"""Trainability job subprocess.

Launched by :mod:`kernel.trainability.jobs` as ``python -I -c <bootstrap>``.
Reads one JSON job spec from stdin, runs the requested analyses, and streams
JSON lines on the *original* stdout (fd 1 is re-pointed at /dev/null so user
``print`` calls cannot corrupt the stream).

Events (one JSON object per line)::

    {"event": "prepared", "n_qubits", "n_parameters", "observable", "backend"}
    {"event": "progress", "analysis", "fraction", "message"}
    {"event": "partial", "analysis", "result"}
    {"event": "analysis_error", "analysis", "code", "message"}
    {"event": "fatal", "code", "message", "column"?}
    {"event": "done"}

User code is the user's own (same trust model as ``execute``).
"""

from __future__ import annotations

import importlib
import inspect as _inspect
import json
import os
import random
import sys
import threading
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np

from kernel.lab_proc import apply_cpu_limit, start_parent_watch
from kernel.trainability._errors import Cancelled, TrainabilityError, normalize_error
from kernel.trainability._jsonable import to_jsonable
from kernel.trainability._usercode import LoadedCircuit, load_circuit, resolve_observable
from kernel.trainability.backends import get_backend
from kernel.trainability.compiler import MAX_STATEVECTOR_QUBITS
from kernel.trainability.ir import IrError, ParamCircuit
from kernel.trainability.pauli import PauliSum

Emit = Callable[[dict], None]

#: Test seam: import every external analysis function from this module instead.
OVERRIDE_ENV = "NUCLEI_TRAINABILITY_ANALYSES_MODULE"
MAX_PPE_QUBITS = 128
_EXTERNAL = {
    "gradients": ("analyses", "gradient_statistics"),
    "scaling": ("scaling", "scaling_study"),
    "lie": ("lie", "lie_algebra"),
}
_NEEDS_PARAMETERS = ("gradients", "landscape")


@dataclass
class JobData:
    code: str
    language: str | None
    params: dict
    observable: str
    settings: dict
    loaded: LoadedCircuit
    observable_sum: PauliSum

    @property
    def circuit(self) -> ParamCircuit:
        return self.loaded.circuit


def _external(analysis: str) -> Callable:
    module_name, func_name = _EXTERNAL[analysis]
    override = os.environ.get(OVERRIDE_ENV)
    try:
        module = importlib.import_module(override or f"kernel.trainability.{module_name}")
        return getattr(module, func_name)
    except (ImportError, AttributeError) as exc:
        raise TrainabilityError(
            "analysis_unavailable", f"The {analysis} analysis is not available in this kernel: {exc}"
        ) from exc


def call_filtered(fn: Callable, *args: Any, **kwargs: Any) -> Any:
    """Call ``fn`` passing only the keyword arguments its signature accepts."""
    try:
        sig = _inspect.signature(fn)
    except (TypeError, ValueError):
        return fn(*args, **kwargs)
    if any(p.kind is _inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
        return fn(*args, **kwargs)
    return fn(*args, **{k: v for k, v in kwargs.items() if k in sig.parameters})


def _check_width(job: JobData, analysis: str) -> None:
    n, method = job.circuit.n_qubits, job.settings["method"]
    if analysis == "gradients":
        if n > MAX_PPE_QUBITS:
            raise IrError("too_many_qubits", f"{n} qubits exceeds the {MAX_PPE_QUBITS}-qubit limit.")
        if method == "sampling" and n > MAX_STATEVECTOR_QUBITS:
            raise IrError(
                "too_many_qubits",
                f"Sampling needs a statevector; {n} qubits exceeds the limit of {MAX_STATEVECTOR_QUBITS}. "
                "Use method 'ppe' or 'auto'.",
            )
    elif analysis in ("expressibility", "entanglement", "landscape", "quantum_kernel", "variational_train", "classical_baseline", "kernel_alignment_search", "variational_qng") and n > MAX_STATEVECTOR_QUBITS:
        raise IrError(
            "too_many_qubits",
            f"{n} qubits exceeds the statevector limit of {MAX_STATEVECTOR_QUBITS} for {analysis}.",
        )
    if analysis in _NEEDS_PARAMETERS and not job.circuit.parameters:
        raise TrainabilityError("no_parameters", "The circuit has no free parameters.")
    if analysis in ("quantum_kernel", "variational_train", "kernel_alignment_search", "variational_qng") and not job.circuit.parameters:
        raise TrainabilityError("no_parameters", "The circuit has no free parameters.")


def _scaling_observable_spec(job: JobData) -> str:
    """A size-independent observable spec when one exists."""
    if job.observable.strip():
        return job.observable
    declared = job.loaded.namespace.get("nuclei_observable")
    if isinstance(declared, str) and declared.strip():
        return declared
    if declared is not None:
        return job.observable_sum.to_text()
    return "preset:local_z"


def _scaling_builder(job: JobData) -> Callable[[int, int], ParamCircuit]:
    cfg = job.settings["scaling"]
    qp, lp = cfg["qubit_param"], cfg["layer_param"]
    fixed = {k: v for k, v in job.params.items() if k not in (qp, lp)}

    def build(n_qubits: int, n_layers: int) -> ParamCircuit:
        return load_circuit(job.code, {**fixed, qp: n_qubits, lp: n_layers}, job.language).circuit

    return build


def _dispatch_analysis(job: JobData, analysis: str, progress: Callable[[float, str], None], cancel: Callable[[], bool]) -> dict:
    """Dispatch one analysis; raises on failure."""
    s = job.settings
    common = {"progress": progress, "cancel": cancel}
    _check_width(job, analysis)
    if analysis == "gradients":
        return call_filtered(
            _external("gradients"), job.circuit, job.observable_sum,
            samples=s["samples"], seed=s["seed"], init=s["init"],
            method=s["method"], backend=s["backend"],
            channel_noise=s.get("noise"), **common,
        )
    if analysis == "scaling":
        cfg = s["scaling"]
        return call_filtered(
            _external("scaling"), _scaling_builder(job),
            qubits=cfg["qubits"], layers=cfg["layers"],
            observable_spec=_scaling_observable_spec(job),
            samples=s["samples"], seed=s["seed"], init=s["init"],
            method=s["method"], backend=s["backend"], **common,
        )
    if analysis == "lie":
        cfg = s["lie"]
        return call_filtered(
            _external("lie"), job.circuit, observable=job.observable_sum,
            max_dimension=cfg["max_dimension"], time_budget_s=cfg["time_budget_s"], **common,
        )
    if analysis == "expressibility":
        from kernel.trainability.expressibility import expressibility

        cfg = s["expressibility"]
        return expressibility(
            job.circuit, pairs=cfg["pairs"], bins=cfg["bins"], seed=s["seed"], backend=s["backend"], **common
        )
    if analysis == "entanglement":
        from kernel.trainability.expressibility import entangling_capability

        return entangling_capability(
            job.circuit, samples=s["entanglement"]["samples"], seed=s["seed"], backend=s["backend"], **common
        )
    if analysis == "landscape":
        from kernel.trainability.landscape import landscape

        cfg = s["landscape"]
        return landscape(
            job.circuit, job.observable_sum, resolution=cfg["resolution"], span=cfg["span"],
            seed=s["seed"], backend=s["backend"], **common,
        )
    if analysis == "quantum_kernel":
        from kernel.trainability.qml_kernel import quantum_kernel

        qml, kcfg = s["qml"], s["kernel"]
        return quantum_kernel(
            job.circuit, dataset=qml["dataset"], dataset_samples=qml["samples"],
            noise=qml["noise"], train_fraction=qml["train_fraction"],
            ridge_lambda=kcfg["ridge_lambda"], seed=s["seed"], backend=s["backend"],
            channel_noise=s.get("noise"), **common,
        )
    if analysis == "variational_train":
        from kernel.trainability.qml_train import variational_train

        qml, vcfg = s["qml"], s["variational"]
        return variational_train(
            job.circuit, job.observable_sum, dataset=qml["dataset"],
            dataset_samples=qml["samples"], noise=qml["noise"],
            train_fraction=qml["train_fraction"], epochs=vcfg["epochs"],
            learning_rate=vcfg["learning_rate"], data_params=vcfg["data_params"],
            seed=s["seed"], backend=s["backend"],
            optimizer=vcfg.get("optimizer", "adam"),
            gradient_method=vcfg.get("gradient_method", "adjoint"),
            early_stop_patience=vcfg.get("early_stop_patience", 0),
            spsa_a=vcfg.get("spsa_a", 0.05),
            spsa_c=vcfg.get("spsa_c", 0.1),
            channel_noise=s.get("noise"), **common,
        )
    if analysis == "classical_baseline":
        from kernel.trainability.qml_baseline import classical_baseline

        qml, kcfg, bcfg = s["qml"], s["kernel"], s.get("baseline") or {}
        return classical_baseline(
            job.circuit, dataset=qml["dataset"], dataset_samples=qml["samples"],
            noise=qml["noise"], train_fraction=qml["train_fraction"],
            ridge_lambda=kcfg["ridge_lambda"],
            include_linear=bcfg.get("include_linear", True),
            seed=s["seed"], backend=s["backend"],
            channel_noise=s.get("noise"), **common,
        )
    if analysis == "kernel_alignment_search":
        from kernel.trainability.qml_align import kernel_alignment_search

        qml, kcfg, acfg, vcfg = s["qml"], s["kernel"], s.get("align") or {}, s["variational"]
        return kernel_alignment_search(
            job.circuit, dataset=qml["dataset"], dataset_samples=qml["samples"],
            noise=qml["noise"], train_fraction=qml["train_fraction"],
            ridge_lambda=kcfg["ridge_lambda"], data_params=vcfg["data_params"],
            mode=acfg.get("mode", "bandwidth"), steps=acfg.get("steps", 40),
            learning_rate=acfg.get("learning_rate", 0.1),
            spsa_a=acfg.get("spsa_a", 0.05), spsa_c=acfg.get("spsa_c", 0.1),
            seed=s["seed"], backend=s["backend"],
            channel_noise=s.get("noise"), **common,
        )
    if analysis == "variational_qng":
        from kernel.trainability.qml_qng import variational_qng

        qml, vcfg, qcfg = s["qml"], s["variational"], s.get("qng") or {}
        return variational_qng(
            job.circuit, job.observable_sum, dataset=qml["dataset"],
            dataset_samples=qml["samples"], noise=qml["noise"],
            train_fraction=qml["train_fraction"], epochs=vcfg["epochs"],
            learning_rate=vcfg["learning_rate"], data_params=vcfg["data_params"],
            metric_regularization=qcfg.get("metric_regularization", 1e-3),
            metric_every=qcfg.get("metric_every", 1),
            max_metric_params=qcfg.get("max_metric_params", 32),
            seed=s["seed"], backend=s["backend"],
            channel_noise=s.get("noise"), **common,
        )
    raise TrainabilityError("unknown_analysis", f"Unknown analysis '{analysis}'.")


_NOISE_AWARE = ("gradients", "quantum_kernel", "variational_train", "classical_baseline", "kernel_alignment_search", "variational_qng")


def run_analysis(job: JobData, analysis: str, progress: Callable[[float, str], None], cancel: Callable[[], bool]) -> dict:
    """Dispatch one analysis; simulated noise is honoured or noted, never silently dropped."""
    result = _dispatch_analysis(job, analysis, progress, cancel)
    noise_cfg = job.settings.get("noise") or {}
    try:
        if isinstance(noise_cfg, dict):
            shots = int(noise_cfg.get("shots", 0) or 0)
            depol = float(noise_cfg.get("depolarizing_p", 0.0) or 0.0)
            readout = float(noise_cfg.get("readout_flip_p", 0.0) or 0.0)
        else:  # a NoiseSpec-like object from a direct (unnormalized) caller
            shots = int(getattr(noise_cfg, "shots", 0) or 0)
            depol = float(getattr(noise_cfg, "depolarizing_p", 0.0) or 0.0)
            readout = float(getattr(noise_cfg, "readout_flip_p", 0.0) or 0.0)
    except (TypeError, ValueError, AttributeError):
        shots, depol, readout = 0, 0.0, 0.0
    if analysis not in _NOISE_AWARE and (shots or depol or readout):
        if isinstance(result, dict):
            result = dict(result)
            result["channel_noise"] = {"shots": shots, "depolarizing_p": depol, "readout_flip_p": readout}
            notes = list(result.get("notes") or [])
            notes.append("Simulated noise settings were ignored for this analysis (noise applies to gradients, quantum_kernel and variational_train).")
            result["notes"] = notes
    return result


def prepare(spec: dict) -> JobData:
    """Run the user's code and resolve the observable (raises TrainabilityError)."""
    settings = spec["settings"]
    random.seed(settings["seed"])
    np.random.seed(settings["seed"] % (2**32))
    params = dict(spec.get("params") or {})
    try:
        loaded = load_circuit(spec["code"], params, spec.get("language"))
        observable = resolve_observable(spec.get("observable"), loaded)
        get_backend(settings["backend"])
    except TrainabilityError:
        raise
    except ValueError as exc:
        if "backend" in str(exc).lower():
            raise TrainabilityError("backend_unavailable", str(exc)) from exc
        raise normalize_error(exc) from exc
    except Exception as exc:
        raise normalize_error(exc) from exc
    return JobData(
        spec["code"], spec.get("language"), params, spec.get("observable") or "",
        settings, loaded, observable,
    )


def run_job(spec: dict, emit: Emit) -> None:
    """Run every analysis in ``spec``; never raises."""
    try:
        job = prepare(spec)
    except TrainabilityError as exc:
        emit({"event": "fatal", **exc.to_payload()})
        return
    emit({
        "event": "prepared",
        "n_qubits": job.circuit.n_qubits,
        "n_parameters": len(job.circuit.parameters),
        "observable": job.observable_sum.to_text(),
        "backend": get_backend(job.settings["backend"]).name,
    })
    for analysis in spec["analyses"]:
        def progress(fraction: float, message: str, _a: str = analysis) -> None:
            emit({"event": "progress", "analysis": _a, "fraction": float(fraction), "message": str(message)})

        try:
            result = run_analysis(job, analysis, progress, lambda: False)
        except Cancelled:
            break
        except Exception as exc:  # user code or analysis failure: isolate to this analysis
            err = normalize_error(exc)
            emit({"event": "analysis_error", "analysis": analysis, **err.to_payload()})
            continue
        emit({"event": "partial", "analysis": analysis, "result": result})
    emit({"event": "done"})


def _claim_stdout() -> Emit:
    """Take the real stdout for the protocol and silence fd 1 for user code."""
    protocol = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 1)
    os.close(devnull)
    sys.stdout = open(os.devnull, "w", encoding="utf-8")  # noqa: SIM115 - process lifetime
    lock = threading.Lock()

    def emit(event: dict) -> None:
        line = json.dumps(to_jsonable(event), separators=(",", ":"))
        with lock:
            protocol.write(line + "\n")
            protocol.flush()

    return emit


def main() -> int:
    emit = _claim_stdout()
    start_parent_watch()  # die with the kernel (a SIGKILLed parent never runs release_all)
    apply_cpu_limit()
    try:
        spec = json.loads(sys.stdin.readline())
        for extra in reversed(spec.get("sys_path") or []):
            sys.path.insert(0, extra)
        run_job(spec, emit)
    except BaseException as exc:  # last resort: report instead of a silent exit
        emit({"event": "fatal", "code": "worker_error", "message": f"{type(exc).__name__}: {exc}"[:500]})
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
