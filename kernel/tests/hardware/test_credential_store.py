"""Tests for credential_store — isolated to the in-memory fallback via
conftest's `_isolate_credential_store` autouse fixture."""

from __future__ import annotations

import pytest

import kernel.hardware.credential_store as cs


def test_save_and_load_roundtrip():
    cs.save("ibm", {"token": "secret-123", "instance": "ibm-q/open/main"})
    loaded = cs.load("ibm")
    assert loaded == {"token": "secret-123", "instance": "ibm-q/open/main"}


def test_load_unknown_provider_returns_none():
    assert cs.load("does-not-exist") is None


def test_overwrite_replaces_prior_credentials():
    cs.save("ionq", {"token": "old"})
    cs.save("ionq", {"token": "new"})
    assert cs.load("ionq") == {"token": "new"}
    # Index doesn't duplicate
    assert cs.list_providers().count("ionq") == 1


def test_clear_removes_entry_and_index_member():
    cs.save("azure", {"subscription_id": "sub-x"})
    assert "azure" in cs.list_providers()
    cs.clear("azure")
    assert cs.load("azure") is None
    assert "azure" not in cs.list_providers()


def test_clear_nonexistent_is_noop():
    # Must not raise even if the provider was never saved.
    cs.clear("never-saved")
    assert cs.list_providers() == []


def test_list_providers_reflects_save_order():
    cs.save("ibm", {"token": "a"})
    cs.save("ionq", {"token": "b"})
    cs.save("braket", {"access_key_id": "c", "secret_access_key": "d"})
    assert cs.list_providers() == ["ibm", "ionq", "braket"]


def test_corrupt_index_entry_falls_back_to_empty(monkeypatch):
    # If the index gets munged (e.g. keyring returning non-JSON), we should
    # read as empty rather than crash — worst case the user reconnects.
    monkeypatch.setattr(cs, "_get_raw", lambda key: "this is not json")
    assert cs._load_index() == []
    assert cs.list_providers() == []


def test_disable_flag_makes_save_and_load_noop(monkeypatch):
    monkeypatch.setenv("NUCLEI_DISABLE_CRED_STORE", "1")
    cs.save("ibm", {"token": "x"})
    assert cs.load("ibm") is None
    assert cs.list_providers() == []
