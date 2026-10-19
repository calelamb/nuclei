"""The conjecture ledger (``conjectures.json`` and ``.md``): pure, deterministic helpers.

The kernel's Markdown is canonical; a frontend may render its own copy.
Refuted and inconclusive conjectures are kept, because a negative result is a
result. Nothing here ever says "proven": supported means "held on N held-out
circuits up to n = X".
"""

from __future__ import annotations

import hashlib
import platform
from pathlib import Path
from typing import Any

import numpy as np

from kernel.discovery.conjecture.spec import prediction_text

ENGINE_VERSION = "1.0"
PROTOCOL_VERSION = "1.3"
LEDGER_SCHEMA_VERSION = 1
_TRAINABILITY_MODULES = (
    "pauliprop", "ppe_core", "scaling", "lie", "lie_core", "analyses", "pauli", "ir", "gates",
    "_circuit_walk", "symplectic", "_symplectic_gates", "_ppe_compile",
)
_DISCOVERY_MODULES = ("features.py", "cost.py")
_cached_fingerprint: str | None = None


def evaluator_fingerprint(*, refresh: bool = False) -> str:
    """sha256 over ``conjecture/*.py`` and the trainability/feature modules the tester uses."""
    global _cached_fingerprint
    if _cached_fingerprint is not None and not refresh:
        return _cached_fingerprint
    here = Path(__file__).resolve().parent
    kernel = here.parents[1]
    files = sorted(here.glob("*.py")) + [kernel / "trainability" / f"{m}.py" for m in _TRAINABILITY_MODULES] \
        + [kernel / "discovery" / m for m in _DISCOVERY_MODULES]
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.relative_to(kernel).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes() if path.exists() else b"")
        digest.update(b"\0")
    _cached_fingerprint = digest.hexdigest()
    return _cached_fingerprint


def kernel_versions() -> dict[str, str]:
    return {"engine": ENGINE_VERSION, "protocol": PROTOCOL_VERSION, "python": platform.python_version(),
            "numpy": np.__version__}


def _compact_evidence(item: dict[str, Any]) -> dict[str, Any]:
    fit = item.get("fit") or {}
    exp = fit.get("exponential") or {}
    return {
        "variant_id": item["variant_id"], "family_params": item["family_params"], "features": item["features"],
        "regenerate": item["regenerate"],
        "points": [{k: p.get(k) for k in ("n_qubits", "variance", "interval", "method", "status", "error")}
                   for p in item["points"]],
        "fit": {"verdict": fit.get("verdict"), "beta": exp.get("beta"), "beta_ci95": exp.get("beta_ci95"),
                "preferred": fit.get("preferred"), "summary": fit.get("summary")} if fit else None,
        "dla": item.get("dla"), "quantity": item["quantity"], "outcome": item["outcome"], "meets": item["meets"],
        "reason": item["reason"],
    }


def build_entry(
    result: dict[str, Any], *, fingerprint: str | None = None, versions: dict[str, str] | None = None,
) -> dict[str, Any]:
    """The ``conjectures.json`` entry for one tested conjecture (pure; fingerprint injectable)."""
    conj = result["conjecture"]
    return {
        "id": conj["id"], "statement": conj["statement"], "feature_predicate": conj["feature_predicate"],
        "prediction": conj["prediction"], "test_family": conj["test_family"], "n_range": conj["n_range"],
        "circuits_requested": conj["circuits"], "points_requested": conj["points"],
        "verdict": result["verdict"], "summary": result["summary"], "reasons": result["reasons"],
        "partial": result["partial"], "tally": result["tally"], "n_circuits_tested": result["n_circuits_tested"],
        "n_values": result["n_values"], "n_max_tested": result["n_max_tested"], "seed": result["seed"],
        "resampling": result["resampling"],
        "evidence": [_compact_evidence(e) for e in result["evidence"]],
        "counterexamples": result["counterexamples"],
        "evaluator_fingerprint": fingerprint or evaluator_fingerprint(),
        "kernel_versions": versions or kernel_versions(), "timings": result["timings"],
    }


def build_ledger(entries: list[dict[str, Any]], *, run_id: str, prompt_hash: str | None = None,
                 generated_at: str | None = None) -> dict[str, Any]:
    return {"schema_version": LEDGER_SCHEMA_VERSION, "run_id": run_id, "prompt_hash": prompt_hash,
            "generated_at": generated_at, "entries": list(entries)}


def add_entry(ledger: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    """New ledger with ``entry`` appended (replacing an entry with the same id); the input is untouched."""
    kept = [e for e in ledger["entries"] if e["id"] != entry["id"]]
    return {**ledger, "entries": [*kept, entry]}


# ------------------------------------------------------------------ markdown
def _num(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"{value:.3g}" if isinstance(value, (int, float)) else str(value)


def _observed(quantity: dict[str, Any]) -> str:
    obs = quantity.get("observed")
    if isinstance(obs, list):
        return f"[{_num(obs[0])}, {_num(obs[1]) if obs[1] is not None else 'inf'}]"
    return _num(obs)


def _evidence_table(evidence: list[dict[str, Any]]) -> list[str]:
    lines = ["| Circuit | Layers | Pattern | Observed | Outcome |", "|---|---|---|---|---|"]
    for e in evidence:
        feats = e["features"]
        lines.append(f"| {e['variant_id']} | {_num(feats.get('n_layers'))} | {feats.get('entangler_pattern')} | "
                     f"{_observed(e['quantity'])} | {e['outcome']} |")
    return lines


def _entry_markdown(entry: dict[str, Any]) -> list[str]:
    lines = [f"## {entry['id']}: {entry['verdict']}", "", f"> {entry['statement']}", "",
             f"- Prediction: `{prediction_text(entry['prediction'])}`",
             f"- Qubit range tested: {entry['n_range'][0]} to {entry['n_max_tested']} "
             f"({', '.join(map(str, entry['n_values']))})",
             f"- Circuits: {entry['n_circuits_tested']} tested of {entry['circuits_requested']} requested "
             f"(meets {entry['tally']['meets']}, violates {entry['tally']['violates']}, "
             f"indeterminate {entry['tally']['indeterminate']})",
             f"- Seed: {entry['seed']}", "", entry["summary"], ""]
    if entry["evidence"]:
        lines += ["### Evidence", "", *_evidence_table(entry["evidence"]), ""]
    for ce in entry["counterexamples"]:
        lines += [f"### Counterexample {ce['variant_id']}", "",
                  f"- Observed: {_observed(ce['quantity'])}",
                  f"- Family parameters: layers {ce['family_params']['layers']}, "
                  f"axis order {','.join(ce['family_params']['axis_order_per_layer'])}, "
                  f"brick start {ce['family_params']['brick_start']}",
                  f"- Regenerate with seed {ce['regenerate']['seed']}, variant {ce['regenerate']['variant']}",
                  f"- IR: {len(ce['ir']['gates'])} gates on {ce['ir_n_qubits']} qubits (in `conjectures.json`)", ""]
    lines += [f"Evaluator fingerprint: `{entry['evaluator_fingerprint'][:16]}`", ""]
    return lines


def render_markdown(ledger: dict[str, Any]) -> str:
    """Deterministic Markdown of the ledger (no timings, stable ordering)."""
    entries = ledger["entries"]
    lines = ["# Conjecture ledger", "", f"Run: {ledger['run_id']}"]
    if ledger.get("prompt_hash"):
        lines.append(f"Prompt hash: `{ledger['prompt_hash']}`")
    if ledger.get("generated_at"):
        lines.append(f"Generated: {ledger['generated_at']}")
    lines += ["", "Supported means the prediction held on held-out circuits within their 95% intervals. "
              "It is evidence, not a guarantee. Refuted and inconclusive conjectures are kept.", "",
              "| Conjecture | Verdict | Circuits | Max n |", "|---|---|---|---|"]
    lines += [f"| {e['id']} | {e['verdict']} | {e['n_circuits_tested']} | {e['n_max_tested']} |" for e in entries]
    lines.append("")
    for entry in entries:
        lines += _entry_markdown(entry)
    return "\n".join(lines).rstrip() + "\n"
