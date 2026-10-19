"""Analysis failures keep their stable wire codes through normalize_error."""

from __future__ import annotations

from kernel.trainability._analysis_common import AnalysisError
from kernel.trainability._errors import normalize_error
from kernel.trainability.pauliprop import PpeNotApplicable


def test_analysis_error_keeps_code() -> None:
    err = normalize_error(AnalysisError("ppe_required", "needs the PPE above 20 qubits"))
    assert (err.code, err.message) == ("ppe_required", "needs the PPE above 20 qubits")


def test_ppe_not_applicable_keeps_code() -> None:
    err = normalize_error(PpeNotApplicable("shared parameter θ"))
    assert err.code == "ppe_not_applicable"


def test_unknown_exception_is_analysis_failed() -> None:
    assert normalize_error(RuntimeError("boom")).code == "analysis_failed"
