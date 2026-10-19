from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path

from kernel.trainability import provenance
from kernel.trainability.provenance import (
    analyses_fingerprint,
    build_provenance,
    code_sha256,
    kernel_versions,
)


def test_code_hash_is_sha256_of_utf8():
    assert code_sha256("abc") == hashlib.sha256(b"abc").hexdigest()
    assert code_sha256("é") != code_sha256("e")


def test_fingerprint_matches_manual_digest_in_sorted_order():
    package = Path(provenance.__file__).parent
    digest = hashlib.sha256()
    for path in sorted(package.glob("*.py")):
        digest.update(path.read_bytes())
    assert analyses_fingerprint() == digest.hexdigest()
    assert re.fullmatch(r"[0-9a-f]{64}", analyses_fingerprint())


def test_kernel_versions_shape():
    versions = kernel_versions()
    assert versions["nuclei_protocol"] == "1.3"
    assert re.fullmatch(r"\d+\.\d+\.\d+.*", versions["python"])
    assert set(versions) == {"nuclei_protocol", "python", "numpy", "stim", "qiskit", "cirq"}
    assert versions["numpy"]


def test_missing_distribution_is_null(monkeypatch):
    def fake(names):
        return None

    monkeypatch.setattr(provenance, "_version", fake)
    provenance._versions.cache_clear()
    try:
        assert kernel_versions()["stim"] is None
    finally:
        provenance._versions.cache_clear()


def test_build_provenance_document():
    when = datetime(2026, 10, 18, 12, 0, 0, tzinfo=timezone.utc)
    doc = build_provenance(
        code="print(1)", observable="Z0", settings={"samples": 200, "seed": 0}, backend="numpy", created_at=when
    )
    assert doc["code_sha256"] == code_sha256("print(1)")
    assert doc["observable"] == "Z0"
    assert doc["settings"] == {"samples": 200, "seed": 0}
    assert doc["backend"] == "numpy"
    assert doc["created_at"] == "2026-10-18T12:00:00Z"
    assert doc["analyses_fingerprint"] == analyses_fingerprint()
    assert doc["kernel"]["nuclei_protocol"] == "1.3"


def test_provenance_records_request_params_for_reproducibility():
    prov = build_provenance(code="x", observable="Z0", settings={}, backend="numpy",
                            params={"n_qubits": 4, "theta": 0.5})
    assert prov["params"] == {"n_qubits": 4, "theta": 0.5}
    assert build_provenance(code="x", observable="Z0", settings={}, backend="numpy")["params"] == {}
