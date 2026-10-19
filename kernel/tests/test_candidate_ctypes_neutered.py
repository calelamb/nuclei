"""A discovery candidate must not reach ctypes through numpy's cached reference."""

from __future__ import annotations

import pytest

pytest.importorskip("stim")
pytest.importorskip("numpy")

from kernel.discovery import isolation as iso  # noqa: E402
from kernel.discovery.sandbox import default_request, run_candidate  # noqa: E402

REACH_PROGRAM = """
import sys, stim
import numpy
def build(d, r):
    found = []
    for name, module in list(sys.modules.items()):
        if not (name == 'numpy' or name.startswith('numpy.')) or module is None:
            continue
        for attr, value in vars(module).items():
            if getattr(value, '__name__', None) in ('ctypes', '_ctypes') and hasattr(value, 'CDLL'):
                found.append(name + '.' + attr)
    print('REACHABLE:' + ','.join(found))
    return stim.Circuit('H 0')
"""


@pytest.fixture(autouse=True)
def _fresh_probe(monkeypatch):
    monkeypatch.delenv("NUCLEI_DISCOVERY_ISOLATION", raising=False)
    iso.reset_for_tests()
    yield
    iso.reset_for_tests()


def test_numpy_modules_no_longer_hold_a_usable_ctypes():
    response = run_candidate(
        default_request("stim_circuit", REACH_PROGRAM, "build", [{"args": [3, 3], "kwargs": {}}]),
        wall_seconds=120,
        isolation=iso.detect_isolation(),
    )
    assert "REACHABLE:" in response["stdout"], response
    assert response["stdout"].strip().endswith("REACHABLE:"), response["stdout"]


def test_neuter_replaces_cached_ctypes_with_none_in_numpy_only():
    import ctypes
    import sys
    import types

    from kernel.discovery import candidate_worker as worker

    fake_numpy = types.ModuleType("numpy._fake_internal")
    fake_numpy.ctypes = ctypes
    fake_numpy.keep = 1
    other = types.ModuleType("somelib")
    other.ctypes = ctypes
    sys.modules["numpy._fake_internal"] = fake_numpy
    sys.modules["somelib"] = other
    try:
        worker._neuter_ctypes_references()
        assert fake_numpy.ctypes is None and fake_numpy.keep == 1
        assert other.ctypes is ctypes  # unrelated libraries are left alone
    finally:
        del sys.modules["numpy._fake_internal"], sys.modules["somelib"]
