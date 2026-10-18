"""Exact row grouping for uint64 key matrices (helper for ``symplectic.py``).

``group_rows`` returns ``(first_index, inverse)`` like ``np.unique(..., axis=0)``
but is far faster for large batches: rows are first hashed to one uint64 and
grouped on the hash; the grouping is then *verified* by comparing every row with
its group representative.  A (astronomically unlikely) hash collision falls back
to the exact lexicographic ``np.unique``, so results are always exact.
"""

from __future__ import annotations

import numpy as np

_MULTIPLIERS = np.array(
    [0x9E3779B97F4A7C15, 0xC2B2AE3D27D4EB4F, 0x165667B19E3779F9, 0xD6E8FEB86659FD93,
     0xFF51AFD7ED558CCD, 0xC4CEB9FE1A85EC53, 0x2545F4914F6CDD1D, 0x94D049BB133111EB],
    dtype=np.uint64,
)


def row_hash(keys: np.ndarray) -> np.ndarray:
    """Mix each row of an ``(N, C)`` uint64 matrix into one uint64."""
    n_cols = keys.shape[1]
    h = np.full(keys.shape[0], 0x243F6A8885A308D3, dtype=np.uint64)
    shift = np.uint64(29)
    with np.errstate(over="ignore"):
        for c in range(n_cols):
            h = (h ^ keys[:, c]) * _MULTIPLIERS[c % len(_MULTIPLIERS)]
            h = h ^ (h >> shift)
    return h


def group_rows(keys: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Group identical rows of ``keys`` (N, C) uint64. Returns ``(first_index, inverse)``."""
    n = keys.shape[0]
    if n == 0:
        return np.zeros(0, dtype=np.intp), np.zeros(0, dtype=np.intp)
    if keys.shape[1] == 1:
        _, first, inverse = np.unique(keys[:, 0], return_index=True, return_inverse=True)
        return first, inverse.reshape(-1)
    _, first, inverse = np.unique(row_hash(keys), return_index=True, return_inverse=True)
    inverse = inverse.reshape(-1)
    if np.array_equal(keys, keys[first][inverse]):
        return first, inverse
    _, first, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)  # pragma: no cover
    return first, inverse.reshape(-1)  # pragma: no cover
