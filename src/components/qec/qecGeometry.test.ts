import { describe, it, expect } from 'vitest';
import repetition from './__fixtures__/repetition_d3.json';
import surface from './__fixtures__/surface_d3.json';
import type { CircuitSnapshot } from '../../types/quantum';
import type { QecSnapshot, QecDecodeSampleResult } from '../../types/qec';
import {
  latticeLayout,
  detectorGraphLayout,
  detectorNodeIndex,
  edgeHeatColor,
  decodeOverlay,
  measureQubits,
  activeQubitsAtTick,
  classifyTimelineGates,
  timelineLabel,
  activeTimelineQubits,
  detectorTrackByTick,
  tickMomentCount,
  fitGraphBox,
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
    // Stim's rotated surface code has equal numbers of X-type (ancilla controls CNOTs)
    // and Z-type (ancilla is the CNOT target) checks; none may be left unknown.
    const measures = layout.qubits.filter((q) => q.kind === 'measure');
    expect(measures.length).toBe(8);
    expect(measures.filter((q) => q.basis === 'X').map((q) => q.index).sort((a, b) => a - b)).toEqual([2, 11, 16, 25]);
    expect(measures.filter((q) => q.basis === 'Z').map((q) => q.index).sort((a, b) => a - b)).toEqual([9, 13, 14, 18]);
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

describe('detectorNodeIndex', () => {
  it('maps every detector to its position in O(1), including the boundary (-1)', () => {
    const layout = detectorGraphLayout(surfQec);
    const index = detectorNodeIndex(layout);
    expect(index.size).toBe(layout.nodes.length + 1);
    for (const node of layout.nodes) {
      expect(index.get(node.detector)).toEqual({ x: node.x, y: node.y });
    }
    expect(index.get(-1)).toEqual(layout.boundary);
  });
});

describe('edgeHeatColor', () => {
  it('interpolates cool → teal → hot across [0,1]', () => {
    expect(edgeHeatColor(0)).toEqual([78, 106, 130]);
    expect(edgeHeatColor(0.5)).toEqual([0, 180, 216]);
    expect(edgeHeatColor(1)).toEqual([244, 120, 60]);
  });

  it('clamps out-of-range t and stays within valid RGB', () => {
    for (const t of [-1, 0, 0.25, 0.75, 1, 2]) {
      const [r, g, b] = edgeHeatColor(t);
      for (const c of [r, g, b]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
        expect(Number.isInteger(c)).toBe(true);
      }
    }
    expect(edgeHeatColor(-1)).toEqual(edgeHeatColor(0));
    expect(edgeHeatColor(2)).toEqual(edgeHeatColor(1));
  });
});

describe('timeline legibility (qec-24)', () => {
  it('uses Stim mnemonics instead of truncated names', () => {
    expect(timelineLabel('CNOT')).toBe('CX');
    expect(timelineLabel('Measure')).toBe('M');
    expect(timelineLabel('Reset')).toBe('R');
    expect(timelineLabel('MR')).toBe('MR');
    expect(timelineLabel('H')).toBe('H');
    expect(timelineLabel('SQRT_XX_DAG')).toBe('SQRT');
  });

  it('lists only qubits that have operations', () => {
    const used = activeTimelineQubits(surfSnap.gates);
    expect(used.length).toBeGreaterThan(0);
    expect(used.length).toBeLessThanOrEqual(surfSnap.qubit_count);
    expect(used).toEqual([...used].sort((a, b) => a - b));
    expect(activeTimelineQubits([{ type: 'H', targets: [5], controls: [], params: [], layer: 0 }])).toEqual([5]);
  });
});

describe('tickMomentCount', () => {
  it('counts one moment per layer including the final one (surface d3: 7 TICKs, layers 0..7)', () => {
    const count = tickMomentCount(surfQec.num_ticks, surfSnap.gates);
    expect(count).toBe(8);
    const maxLayer = Math.max(...surfSnap.gates.map((g) => g.layer));
    expect(count).toBeGreaterThan(maxLayer);
  });

  it('never drops below the highest drawn layer and is at least 1', () => {
    expect(tickMomentCount(0, [])).toBe(1);
    expect(tickMomentCount(2, [{ layer: 9 } as never])).toBe(10);
  });
});

describe('detectorGraphLayout rounds and scale', () => {
  it('never draws two detectors of different rounds on the same spot', () => {
    const layout = detectorGraphLayout(surfQec);
    const seen = new Set(layout.nodes.map((n) => `${n.x.toFixed(4)},${n.y.toFixed(4)}`));
    expect(seen.size).toBe(layout.nodes.length);
  });

  it('keeps detectors of different rounds clearly apart, not merely at distinct coordinates', () => {
    const layout = detectorGraphLayout(surfQec);
    const scale = Math.max(layout.aspect, 1);
    let closest = Infinity;
    for (const a of layout.nodes) {
      for (const b of layout.nodes) {
        if (a.detector >= b.detector) continue;
        closest = Math.min(closest, Math.hypot((a.x - b.x) * layout.aspect, a.y - b.y) / scale);
      }
    }
    expect(closest).toBeGreaterThan(0.08);
  });

  it('marks edges between the same site in different rounds as time-like', () => {
    const layout = detectorGraphLayout(surfQec);
    const timelike = layout.edges.filter((e) => e.timelike);
    expect(timelike.length).toBeGreaterThan(0);
    const byId = new Map(layout.nodes.map((n) => [n.detector, n]));
    for (const e of timelike) expect(byId.get(e.a)!.t).not.toBe(byId.get(e.b)!.t);
  });

  it('keeps every node and the boundary inside the unit box', () => {
    const layout = detectorGraphLayout(surfQec);
    for (const n of [...layout.nodes, layout.boundary]) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(1);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(1);
    }
    expect(layout.aspect).toBeGreaterThan(0);
  });
});

describe('fitGraphBox', () => {
  it('uses one scale for x and y whatever the panel shape', () => {
    for (const [w, h] of [[800, 300], [300, 800], [500, 500]] as const) {
      const { X, Y, boxW, boxH } = fitGraphBox(1.5, w, h, 16);
      expect(boxW / boxH).toBeCloseTo(1.5, 6);
      expect(X(1) - X(0)).toBeCloseTo(boxW, 6);
      expect(Y(1) - Y(0)).toBeCloseTo(boxH, 6);
      expect(X(0) + X(1)).toBeCloseTo(w, 6); // centred
      expect(Y(0) + Y(1)).toBeCloseTo(h, 6);
    }
  });
});
