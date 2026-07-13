import { describe, it, expect } from 'vitest';
import repetition from './__fixtures__/repetition_d3.json';
import surface from './__fixtures__/surface_d3.json';
import type { CircuitSnapshot } from '../../types/quantum';
import type { QecSnapshot, QecDecodeSampleResult } from '../../types/qec';
import {
  latticeLayout,
  detectorGraphLayout,
  decodeOverlay,
  measureQubits,
  activeQubitsAtTick,
  classifyTimelineGates,
  detectorTrackByTick,
} from './qecGeometry';

const repSnap = repetition.snapshot as CircuitSnapshot;
const repQec = repetition.qec as QecSnapshot;
const repDecode = repetition.decode as QecDecodeSampleResult;
const surfSnap = surface.snapshot as CircuitSnapshot;
const surfQec = surface.qec as QecSnapshot;

describe('latticeLayout', () => {
  it('hides gracefully when the circuit has no qubit coordinates (repetition code)', () => {
    const layout = latticeLayout(repQec, repSnap);
    expect(layout.hasCoordinates).toBe(false);
    expect(layout.qubits).toEqual([]);
  });

  it('lays out qubits normalized to [0,1] and classifies data vs measure (surface code)', () => {
    const layout = latticeLayout(surfQec, surfSnap);
    expect(layout.hasCoordinates).toBe(true);
    expect(layout.qubits.length).toBe(17); // the coordinate-bearing qubits
    for (const q of layout.qubits) {
      expect(q.x).toBeGreaterThanOrEqual(0);
      expect(q.x).toBeLessThanOrEqual(1);
      expect(q.y).toBeGreaterThanOrEqual(0);
      expect(q.y).toBeLessThanOrEqual(1);
    }
    // Both kinds are present (data + measure/ancilla qubits).
    const kinds = new Set(layout.qubits.map((q) => q.kind));
    expect(kinds.has('data')).toBe(true);
    expect(kinds.has('measure')).toBe(true);
    // Measure qubits carry a basis; every measure in this Z-memory is Z.
    const measures = layout.qubits.filter((q) => q.kind === 'measure');
    expect(measures.length).toBeGreaterThan(0);
    expect(measures.every((q) => q.basis === 'Z')).toBe(true);
  });

  it('normalizes so the extreme qubits sit at the [0,1] bounds', () => {
    const layout = latticeLayout(surfQec, surfSnap);
    expect(Math.min(...layout.qubits.map((q) => q.x))).toBeCloseTo(0, 10);
    expect(Math.max(...layout.qubits.map((q) => q.x))).toBeCloseTo(1, 10);
  });
});

describe('measureQubits / activeQubitsAtTick', () => {
  it('finds the measured (ancilla) qubits from the gate list', () => {
    const m = measureQubits(repSnap.gates);
    expect(m.size).toBeGreaterThan(0);
    // The repetition d=3 code measures its 2 ancillas each round + final data.
    expect([...m].every((q) => q >= 0)).toBe(true);
  });

  it('reports qubits active at a given tick (moment)', () => {
    // Tick 0 in a generated circuit is the initial reset layer.
    const active0 = activeQubitsAtTick(repSnap.gates, 0);
    expect(active0.size).toBeGreaterThan(0);
    // A tick beyond the circuit is empty.
    const beyond = activeQubitsAtTick(repSnap.gates, 9999);
    expect(beyond.size).toBe(0);
  });
});

describe('detectorGraphLayout', () => {
  it('uses detector coordinates when present (both fixtures have them)', () => {
    const layout = detectorGraphLayout(repQec);
    expect(layout.hasCoordinates).toBe(true);
    expect(layout.nodes.length).toBe(repQec.num_detectors);
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(1);
    }
  });

  it('emits pairwise edges plus boundary edges to the virtual node (b = -1)', () => {
    const layout = detectorGraphLayout(repQec);
    const pairwise = layout.edges.filter((e) => e.b !== -1);
    const boundary = layout.edges.filter((e) => e.b === -1);
    expect(pairwise.length).toBe(repQec.dem!.edge_count);
    expect(boundary.length).toBe(repQec.dem!.boundary_edge_count);
    expect(layout.boundary.y).toBeGreaterThan(0.9); // below the graph
    // Every edge carries its error probability.
    expect(layout.edges.every((e) => e.p > 0 && e.p < 1)).toBe(true);
  });

  it('falls back to a deterministic circle layout when detectors lack coords', () => {
    const noCoords: QecSnapshot = {
      ...repQec,
      coords: { ...repQec.coords, detectors: repQec.coords.detectors.map(() => null) },
    };
    const a = detectorGraphLayout(noCoords);
    const b = detectorGraphLayout(noCoords);
    expect(a.hasCoordinates).toBe(false);
    expect(a.nodes).toEqual(b.nodes); // deterministic
    expect(a.nodes.length).toBe(repQec.num_detectors);
  });

  it('produces an empty edge set when there is no DEM', () => {
    const noDem: QecSnapshot = { ...repQec, dem: null, dem_error: 'no detector error model' };
    const layout = detectorGraphLayout(noDem);
    expect(layout.edges).toEqual([]);
    expect(layout.nodes.length).toBe(repQec.num_detectors);
  });
});

describe('decodeOverlay', () => {
  it('surfaces fired detectors and the decoder matching from a decode sample', () => {
    const overlay = decodeOverlay(repDecode);
    expect([...overlay.firedDetectors].sort((a, b) => a - b)).toEqual(repDecode.syndrome);
    expect(overlay.matchedEdges.length).toBe(repDecode.matched_edges.length);
    // In this fixture the prediction matches the actual flip → no logical error.
    expect(overlay.logicalError).toBe(false);
  });

  it('flags a logical error when prediction disagrees with the actual flip', () => {
    const missed: QecDecodeSampleResult = {
      ...repDecode,
      predicted_observable_flips: [1],
      actual_observable_flips: [0],
    };
    expect(decodeOverlay(missed).logicalError).toBe(true);
  });

  it('maps a boundary match (d2 null) to b = -1', () => {
    const boundaryMatch: QecDecodeSampleResult = {
      ...repDecode,
      matched_edges: [{ d1: 2, d2: null }],
    };
    expect(decodeOverlay(boundaryMatch).matchedEdges).toEqual([{ a: 2, b: -1 }]);
  });
});

describe('timeline classification', () => {
  it('classifies noise ops with their kind + probability', () => {
    const gates = classifyTimelineGates(repSnap.gates);
    const noise = gates.filter((g) => g.isNoise);
    expect(noise.length).toBeGreaterThan(0);
    for (const g of noise) {
      expect(g.noiseKind).toBeTruthy();
      expect(g.probability).toBeGreaterThan(0);
      expect(g.type.startsWith('NOISE:')).toBe(true);
    }
  });

  it('groups DETECTOR/OBSERVABLE markers into a per-tick bottom track', () => {
    const track = detectorTrackByTick(repSnap.gates);
    expect(track.size).toBeGreaterThan(0);
    const allMarkers = [...track.values()].flat();
    expect(allMarkers.some((g) => g.isDetector)).toBe(true);
    expect(allMarkers.some((g) => g.isObservable)).toBe(true);
    // Every marker sits at the tick that keys it.
    for (const [tick, markers] of track) {
      expect(markers.every((m) => m.layer === tick)).toBe(true);
    }
  });
});
