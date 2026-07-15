"""Detector Error Model extraction for the `qec_snapshot` payload (PRD 10 D1).

Builds the sidecar structure the frontend's QEC panels consume: qubit and
detector coordinates plus a detector *graph* — pairwise edges, boundary
edges, and an honest count of hyperedges that don't fit a matching graph.

Design decisions (deliberate, documented for the docs page):

- DEM extraction uses ``decompose_errors=True`` so correlated errors are
  split into the matchable components decoders like PyMatching actually
  use. Circuits whose errors can't be decomposed (non-matchable codes)
  fall back to the undecomposed model and report ``hyperedges_count > 0``
  instead of failing — honesty over pretense.
- Parallel edges (several error mechanisms flipping the same detector
  pair) are merged into one edge with the standard XOR combination
  ``p = p1(1-p2) + p2(1-p1)`` — the same rule PyMatching applies when
  loading a DEM. The graph view wants one weighted edge, not a multiset.
- Payload caps are enforced HERE, kernel-side (PRD 10 constraint 6):
  above ``max_edges`` total edges the payload carries summary counts only
  and ``"truncated": true``. The frontend's "render anyway" re-requests
  with a higher cap. Never silent.
"""

from __future__ import annotations

MAX_DEM_EDGES = 5_000


def _xor_combine(p_old: float, p_new: float) -> float:
    """Probability that an odd number of the two mechanisms fire."""
    return p_old * (1.0 - p_new) + p_new * (1.0 - p_old)


def extract_detector_graph(dem, max_edges: int = MAX_DEM_EDGES) -> dict:
    """Reduce a stim.DetectorErrorModel to the qec_snapshot `dem` payload.

    Parses the flattened DEM's *text* form (``str(dem.flattened())``) instead
    of walking the live object target-by-target. Stim emits the text natively
    in a single pass; parsing it in Python avoids the tens of thousands of
    per-target FFI crossings (``is_separator`` / ``val`` / ``is_*_id``) that
    dominated this path — ~2.6x faster on a distance-11 surface code, with
    byte-identical output. See ``tests/test_stim_adapter.py`` for the
    equivalence guard against the old object-walking form.

    Text format per error line (``decompose_errors=True`` splits correlated
    errors on ``^``)::

        error(0.0121) D0 D5
        error(0.0239) D0 D76 ^ D1 L0
    """
    edges: dict[tuple[int, int], tuple[float, frozenset[int]]] = {}
    boundary: dict[int, tuple[float, frozenset[int]]] = {}
    hyperedges = 0

    def _add(store: dict, key, p: float, obs: frozenset[int]) -> None:
        cur = store.get(key)
        if cur is None:
            store[key] = (p, obs)
        else:
            store[key] = (_xor_combine(cur[0], p), cur[1] | obs)

    for line in str(dem.flattened()).splitlines():
        if not line.startswith("error("):
            continue
        close = line.index(")")
        p = float(line[6:close])
        rest = line[close + 2:]  # skip the ") " after the probability
        # Each `^`-separated component is one matchable graph element.
        components = rest.split(" ^ ") if " ^ " in rest else (rest,)
        for comp in components:
            dets: list[int] = []
            obs: set[int] | None = None
            for tok in comp.split():
                head = tok[0]
                if head == "D":
                    dets.append(int(tok[1:]))
                elif head == "L":
                    if obs is None:
                        obs = set()
                    obs.add(int(tok[1:]))
            obs_fs = frozenset(obs) if obs else frozenset()
            n = len(dets)
            if n == 2:
                key = (dets[0], dets[1]) if dets[0] <= dets[1] else (dets[1], dets[0])
                _add(edges, key, p, obs_fs)
            elif n == 1:
                _add(boundary, dets[0], p, obs_fs)
            elif n > 2:
                hyperedges += 1
            # 0 detectors (pure observable flip) has no graph element.

    total = len(edges) + len(boundary)
    payload: dict = {
        "nodes": dem.num_detectors,
        "edge_count": len(edges),
        "boundary_edge_count": len(boundary),
        "hyperedges_count": hyperedges,
        "truncated": total > max_edges,
    }
    if total > max_edges:
        payload["edges"] = []
        payload["boundary_edges"] = []
    else:
        payload["edges"] = [
            {"d1": d1, "d2": d2, "obs": sorted(obs), "p": round(p, 12)}
            for (d1, d2), (p, obs) in sorted(edges.items())
        ]
        payload["boundary_edges"] = [
            {"d": d, "obs": sorted(obs), "p": round(p, 12)}
            for d, (p, obs) in sorted(boundary.items())
        ]
    return payload


def _coordinate_lists(circuit) -> dict:
    """Aligned coordinate arrays: index i = qubit/detector i, null when unset.

    Stim reports coordinates sparsely; the payload pads to fixed-length
    arrays so the frontend can index without a lookup table. Qubit coords
    keep their first two components (x, y); detector coords keep three
    (x, y, t) padded with 0.0 — matching stim's own convention where the
    trailing coordinate is the round/time axis.
    """
    qubit_coords: list[list[float] | None] = [None] * circuit.num_qubits
    for index, coords in circuit.get_final_qubit_coordinates().items():
        if 0 <= index < circuit.num_qubits and coords:
            xy = [float(c) for c in coords[:2]]
            while len(xy) < 2:
                xy.append(0.0)
            qubit_coords[index] = xy

    detector_coords: list[list[float] | None] = [None] * circuit.num_detectors
    for index, coords in circuit.get_detector_coordinates().items():
        if 0 <= index < circuit.num_detectors and coords:
            xyt = [float(c) for c in coords[:3]]
            while len(xyt) < 3:
                xyt.append(0.0)
            detector_coords[index] = xyt

    return {"qubits": qubit_coords, "detectors": detector_coords}


def build_qec_payload(circuit, max_edges: int = MAX_DEM_EDGES) -> dict:
    """Build the full `qec_snapshot` data payload for a stim.Circuit.

    Never raises for circuits stim itself accepts: DEM decomposition
    failures fall back to the undecomposed model, and a circuit with no
    detectors at all yields an empty graph rather than an error.
    """
    dem = None
    dem_error: str | None = None
    try:
        dem = circuit.detector_error_model(decompose_errors=True)
    except ValueError:
        # Non-matchable error structure (e.g. color codes): report the
        # undecomposed model honestly — hyperedges_count > 0 tells the
        # graph view to render the pairwise projection + a badge.
        try:
            dem = circuit.detector_error_model()
        except ValueError as exc:
            # No DEM at all — e.g. an observable that isn't deterministic
            # under noiseless execution (a plain circuit that measures a
            # superposition). Circuit stats still render; the graph view
            # shows the reason instead of an empty box.
            dem_error = str(exc).strip().splitlines()[0] if str(exc).strip() else (
                "stim could not build a detector error model for this circuit."
            )

    dem_graph = extract_detector_graph(dem, max_edges=max_edges) if dem is not None else None

    payload = {
        "num_qubits": circuit.num_qubits,
        "num_detectors": circuit.num_detectors,
        "num_observables": circuit.num_observables,
        "num_ticks": circuit.num_ticks,
        "coords": _coordinate_lists(circuit),
        "dem": dem_graph,
        # Filled by qec_decode_sample (PRD 10 Phase B) — placeholder so the
        # payload shape is stable from day one.
        "sample_decode": None,
    }
    if dem_error is not None:
        payload["dem_error"] = dem_error
    # When the graph is truncated (too many edges to serialize), forward the
    # flattened DEM *text* so the frontend can parse + render it client-side
    # (the WASM parser) — no kernel-side edge cap. Only sent on truncation, so
    # the common case pays nothing.
    if dem is not None and dem_graph is not None and dem_graph.get("truncated"):
        payload["dem_text"] = str(dem.flattened())
    return payload
