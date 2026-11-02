"""Built-in QML datasets and the data-encoding contract (PRD 14 follow-up).

This module is the dataset-handling layer the Trainability Lab was missing:
supervised QML needs ``(X, y)`` before a kernel or a classifier means
anything.  Datasets are generated with ``numpy`` only (no scikit-learn
dependency), are binary and two-feature by design, and are a pure function
of ``(name, n_samples, noise, seed)`` so a kernel job is reproducible.

Data-encoding contract
----------------------
* Every dataset has ``d = 2`` features, each min-max scaled to ``[0, 2*pi)``
  so a feature can be bound directly to a rotation angle.
* Labels are returned as ``y`` in ``{0, 1}`` and ``y_signed`` in ``{-1, +1}``.
* A *feature map* circuit binds the dataset columns to circuit parameters
  in ``circuit.parameters`` order: the quantum-kernel analysis requires
  exactly ``d`` parameters, and the variational classifier takes its data
  parameters by name (``x``-prefixed by convention, or an explicit list).
"""

from __future__ import annotations

from typing import Any

import numpy as np

from kernel.trainability._analysis_common import AnalysisError

__all__ = ["DATASETS", "dataset_features", "load_dataset", "split_dataset"]

DATASETS = ("moons", "circles", "blobs", "xor")
_TWO_PI = 2.0 * np.pi


def dataset_features(name: str) -> int:
    """Feature count of a built-in dataset (all built-ins are 2-D)."""
    if name not in DATASETS:
        raise AnalysisError(
            "invalid_request",
            f"unknown dataset {name!r}; valid: {', '.join(DATASETS)}",
        )
    return 2


def _scale(raw: np.ndarray) -> np.ndarray:
    lo = raw.min(axis=0)
    span = raw.max(axis=0) - lo
    span = np.where(span > 0, span, 1.0)
    # Map to [0, 2*pi): the raw maximum would otherwise land on exactly
    # 2*pi, which is the same rotation angle as 0 but violates the contract.
    return ((raw - lo) / span * _TWO_PI) % _TWO_PI


def _moons(rng: np.random.Generator, n: int, noise: float) -> tuple[np.ndarray, np.ndarray]:
    n1 = n // 2
    n0 = n - n1
    t0 = rng.uniform(0.0, np.pi, n0)
    t1 = rng.uniform(0.0, np.pi, n1)
    x0 = np.column_stack([np.cos(t0), np.sin(t0)])
    x1 = np.column_stack([1.0 - np.cos(t1), 0.5 - np.sin(t1)])
    raw = np.vstack([x0, x1])
    y = np.concatenate([np.zeros(n0, dtype=int), np.ones(n1, dtype=int)])
    raw = raw + rng.normal(0.0, noise, raw.shape)
    return raw, y


def _circles(rng: np.random.Generator, n: int, noise: float) -> tuple[np.ndarray, np.ndarray]:
    n1 = n // 2
    n0 = n - n1
    a0 = rng.uniform(0.0, _TWO_PI, n0)
    a1 = rng.uniform(0.0, _TWO_PI, n1)
    r0 = 1.0 + rng.normal(0.0, noise, n0)
    r1 = 0.45 + rng.normal(0.0, noise, n1)
    raw = np.vstack([
        np.column_stack([r0 * np.cos(a0), r0 * np.sin(a0)]),
        np.column_stack([r1 * np.cos(a1), r1 * np.sin(a1)]),
    ])
    y = np.concatenate([np.zeros(n0, dtype=int), np.ones(n1, dtype=int)])
    return raw, y


def _blobs(rng: np.random.Generator, n: int, noise: float) -> tuple[np.ndarray, np.ndarray]:
    n1 = n // 2
    n0 = n - n1
    std = 0.25 + noise
    raw = np.vstack([
        rng.normal([-0.7, -0.7], std, (n0, 2)),
        rng.normal([0.7, 0.7], std, (n1, 2)),
    ])
    y = np.concatenate([np.zeros(n0, dtype=int), np.ones(n1, dtype=int)])
    return raw, y


def _xor(rng: np.random.Generator, n: int, noise: float) -> tuple[np.ndarray, np.ndarray]:
    centers = np.array([[-0.7, -0.7], [-0.7, 0.7], [0.7, -0.7], [0.7, 0.7]])
    labels = np.array([0, 1, 1, 0])
    pick = rng.integers(0, 4, n)
    std = 0.18 + noise * 0.5
    raw = centers[pick] + rng.normal(0.0, std, (n, 2))
    return raw, labels[pick]


_GENERATORS = {"moons": _moons, "circles": _circles, "blobs": _blobs, "xor": _xor}


def load_dataset(name: str, n_samples: int, noise: float, seed: int) -> dict[str, Any]:
    """Generate a dataset; identical inputs give bit-identical output."""
    d = dataset_features(name)
    if not isinstance(n_samples, int) or isinstance(n_samples, bool) or n_samples < 4:
        raise AnalysisError("invalid_request", "dataset samples must be an integer >= 4")
    if not (0.0 <= noise <= 1.0):
        raise AnalysisError("invalid_request", "dataset noise must be in [0, 1]")
    rng = np.random.default_rng(seed)
    raw, y = _GENERATORS[name](rng, n_samples, float(noise))
    order = rng.permutation(n_samples)
    raw, y = raw[order], y[order]
    x = _scale(raw)
    return {
        "name": name,
        "n_samples": int(n_samples),
        "n_features": d,
        "noise": float(noise),
        "X": x,
        "y": y.astype(int),
        "y_signed": (2 * y - 1).astype(float),
    }


def split_dataset(
    dataset: dict[str, Any], train_fraction: float, seed: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Stratified deterministic ``(train_idx, test_idx)`` split."""
    if not (0.0 < train_fraction < 1.0):
        raise AnalysisError("invalid_request", "train_fraction must be in (0, 1)")
    y = dataset["y"]
    rng = np.random.default_rng(seed + 7919)
    train: list[int] = []
    test: list[int] = []
    for label in (0, 1):
        idx = np.flatnonzero(y == label)
        idx = idx[rng.permutation(len(idx))]
        cut = int(round(len(idx) * train_fraction))
        cut = min(max(cut, 1), len(idx) - 1) if len(idx) > 1 else len(idx)
        train.extend(idx[:cut].tolist())
        test.extend(idx[cut:].tolist())
    return (
        np.array(sorted(train), dtype=int),
        np.array(sorted(test), dtype=int),
    )
