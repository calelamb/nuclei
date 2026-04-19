"""Shared fixtures for hardware-provider tests.

Providers lazy-import their SDK modules inside methods rather than at the top of
the file, which means we can stand up unit tests without installing any of
`qiskit-ibm-runtime`, `qiskit-ionq`, `amazon-braket-sdk`, `azure-quantum`, or
`pytket-quantinuum`. Each test uses `install_fake_sdk` to inject a mock into
`sys.modules`; the provider's method calls then see the mock instead of a real
SDK (or an ImportError).

Tests MUST NOT make real network calls. Every SDK call is mocked.
"""

from __future__ import annotations

import builtins
import sys
import types
from typing import Iterable
from unittest.mock import MagicMock

import pytest

import kernel.hardware.credential_store as _credential_store


@pytest.fixture(autouse=True)
def _isolate_credential_store(monkeypatch):
    """Force the in-memory fallback for every hardware test so no test
    accidentally hits the developer's real OS keyring (which might have
    production credentials saved from a prior session).

    Each test starts with an empty store."""
    monkeypatch.setattr(_credential_store, "_keyring_available", lambda: False)
    _credential_store.reset_memory_fallback_for_tests()
    yield
    _credential_store.reset_memory_fallback_for_tests()


@pytest.fixture(autouse=True)
def _isolate_job_store(monkeypatch, tmp_path):
    """Redirect the default job-store path to a tmp dir so no test
    touches the dev's ~/.nuclei/jobs.json."""
    monkeypatch.setenv("NUCLEI_DATA_DIR", str(tmp_path))


@pytest.fixture
def install_fake_sdk(monkeypatch):
    """Install fake modules into `sys.modules` so provider SDK imports resolve.

    Usage:
        install_fake_sdk("qiskit_ibm_runtime", QiskitRuntimeService=FakeService)

    The first positional argument is the top-level module name; any keyword
    arguments become attributes on the resulting module. Nested submodules
    (`braket.aws`) are supported — the fixture wires up parent packages
    automatically so `from braket.aws import AwsDevice` works.

    The fixture returns the installed root module so callers can mutate it
    further inside the test body.
    """

    installed: list[str] = []

    def _install(module_name: str, **attrs) -> types.ModuleType:
        parts = module_name.split(".")
        # Build each prefix as a module so `from pkg.subpkg import x` resolves.
        cumulative = ""
        parent: types.ModuleType | None = None
        for part in parts:
            cumulative = f"{cumulative}.{part}" if cumulative else part
            if cumulative not in sys.modules:
                fresh = types.ModuleType(cumulative)
                monkeypatch.setitem(sys.modules, cumulative, fresh)
                installed.append(cumulative)
                if parent is not None:
                    setattr(parent, part, fresh)
            parent = sys.modules[cumulative]
        module = sys.modules[module_name]
        for key, value in attrs.items():
            setattr(module, key, value)
        return module

    yield _install

    # monkeypatch.setitem handles rollback; nothing to undo here.


@pytest.fixture
def block_sdk_import(monkeypatch):
    """Make `import <module>` raise ImportError for the given names.

    Use this to exercise the "missing dependency" connect() path. Wraps
    `builtins.__import__` so any `import` statement inside the provider's
    method resolves via our shim.
    """

    real_import = builtins.__import__
    blocked: set[str] = set()

    def _block(*names: str) -> None:
        for name in names:
            blocked.add(name)

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        top = name.split(".")[0]
        if name in blocked or top in blocked:
            raise ImportError(f"No module named '{name}'")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    return _block


@pytest.fixture
def sample_circuit() -> MagicMock:
    """Opaque circuit-like object to pass through provider.submit_job.

    Providers generally hand it straight to the SDK; the SDK is mocked so the
    concrete type doesn't matter here. Tests that need a real framework
    circuit use pytest.importorskip in their own file.
    """
    return MagicMock(name="circuit")


def make_mock_sdk_job(
    *,
    status_name: str = "DONE",
    counts: dict[str, int] | None = None,
    job_id: str = "sdk-job-42",
    queue_position: int | None = None,
) -> MagicMock:
    """Build a mock SDK job object matching the shape most providers expect.

    Providers call `.status()`, `.result()`, `.queue_info()` or `.queue_position()`,
    and `.cancel()` on their SDK job objects. This gives them all of those with
    sensible defaults; tests override specific attributes as needed.
    """
    job = MagicMock(name="sdk_job")
    job.id = job_id
    status_obj = MagicMock()
    status_obj.name = status_name
    job.status.return_value = status_obj

    # Build a fake SamplerV2-style result: result()[0].data.<creg>.get_counts()
    pub_result = MagicMock()
    data = MagicMock()
    creg = MagicMock()
    creg.get_counts.return_value = counts or {"00": 512, "11": 512}
    data.__iter__ = lambda self: iter(["c"])
    # Dynamic attribute access for pub_result.data.c
    setattr(data, "c", creg)
    pub_result.data = data
    job.result.return_value = [pub_result]

    queue_info = MagicMock()
    queue_info.position = queue_position
    job.queue_info.return_value = queue_info if queue_position is not None else None

    job.queue_position.return_value = queue_position if queue_position is not None else -1
    job.cancel.return_value = None
    return job


def assert_handle_failed(handle, *, expected_error_contains: Iterable[str] = ()) -> None:
    """Assert a JobHandle describes a failed submission with a useful error.

    We require `status == 'failed'` AND `error` populated; the PRD calls this
    out specifically — generic `submit failed` strings are not acceptable.
    """
    assert handle.status == "failed", f"expected status=failed, got {handle.status}"
    assert handle.error, "expected a human-readable error message on the handle"
    for fragment in expected_error_contains:
        assert fragment.lower() in handle.error.lower(), (
            f"expected error to contain {fragment!r}, got {handle.error!r}"
        )
