from __future__ import annotations

import numpy as np
import pytest

from kernel.tests._trainability_job_helpers import build, deep_random
from kernel.trainability._errors import Cancelled
from kernel.trainability.ir import IrError
from kernel.trainability.landscape import landscape, orthonormal_directions
from kernel.trainability.pauli import parse_observable


def test_directions_are_orthonormal():
    d1, d2 = orthonormal_directions(np.random.default_rng(0), 7)
    assert d1 @ d1 == pytest.approx(1.0)
    assert d2 @ d2 == pytest.approx(1.0)
    assert d1 @ d2 == pytest.approx(0.0, abs=1e-12)


def test_shape_axis_and_center_value():
    circ = deep_random(2, 1)
    obs = parse_observable("Z0 + 0.5*Z1", 2)
    out = landscape(circ, obs, resolution=11, span=1.0, seed=4)
    assert out["resolution"] == 11
    assert len(out["axis"]) == 11 and out["axis"][0] == -1.0 and out["axis"][-1] == 1.0
    values = np.array(out["values"])
    assert values.shape == (11, 11)
    assert out["min"] == values.min() and out["max"] == values.max()
    # The grid midpoint is the centre of the slice.
    assert values[5, 5] == pytest.approx(out["center_value"])
    assert len(out["center"]) == len(circ.parameters)


def test_one_parameter_slice_is_analytic_and_row_major():
    circ = build(1, [("RY", (0,), "t")], ["t"])
    obs = parse_observable("Z0", 1)
    out = landscape(circ, obs, resolution=9, span=np.pi, seed=1, center=[0.3])
    d1 = np.sign(np.array(out["values"])[4, 8] - np.array(out["values"])[4, 0])  # slope direction
    assert d1 != 0
    values = np.array(out["values"])
    axis = np.array(out["axis"])
    # Only one direction exists: every row (fixed y) is identical, and each
    # row traces cos(center + x * d1) with d1 = +-1 (RY(t)|0> gives <Z> = cos t).
    assert np.allclose(values, values[0][None, :])
    match_plus = np.cos(0.3 + axis)
    match_minus = np.cos(0.3 - axis)
    assert np.allclose(values[0], match_plus) or np.allclose(values[0], match_minus)
    assert out["center_value"] == pytest.approx(np.cos(0.3))


def test_y_is_the_outer_axis():
    circ = build(2, [("RY", (0,), "a"), ("RY", (1,), "b")], ["a", "b"])
    obs = parse_observable("Z0", 2)
    out = landscape(circ, obs, resolution=5, span=1.0, seed=2, center="zero")
    values = np.array(out["values"])
    # <Z0> = cos(a): it varies along the axis that moves a. Recompute directly.
    from kernel.trainability.landscape import orthonormal_directions as od

    rng = np.random.default_rng(2)
    d1, d2 = od(rng, 2)
    axis = np.array(out["axis"])
    expect = np.array([[np.cos(x * d1[0] + y * d2[0]) for x in axis] for y in axis])
    assert np.allclose(values, expect)


def test_deterministic_and_errors():
    circ = deep_random(2, 1)
    obs = parse_observable("Z0", 2)
    a = landscape(circ, obs, resolution=5, seed=9)
    b = landscape(circ, obs, resolution=5, seed=9)
    assert a["values"] == b["values"] and a["center"] == b["center"]
    with pytest.raises(Cancelled):
        landscape(circ, obs, resolution=5, cancel=lambda: True)
    with pytest.raises(IrError):
        landscape(circ, obs, resolution=5, center=[0.0])
    with pytest.raises(IrError):
        landscape(build(21, [("H", (0,))]), parse_observable("Z0", 21), resolution=3)
