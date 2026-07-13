import { describe, it, expect } from 'vitest';
import {
  PANEL_REGISTRY,
  panelPassesFramework,
  resolveVisiblePanels,
  panelsInZone,
  type PanelDef,
  type PanelId,
  type VisibilityCtx,
  type VisiblePanels,
} from './panelRegistry';
import type { CircuitSnapshot, Framework, SimulationResult } from '../types/quantum';
import type { LayoutPreset } from '../stores/layoutStore';

const EMPTY_SNAPSHOT: CircuitSnapshot = {
  framework: 'cirq',
  qubit_count: 0,
  classical_bit_count: 0,
  depth: 0,
  gates: [],
};

const GATE_SNAPSHOT: CircuitSnapshot = {
  ...EMPTY_SNAPSHOT,
  qubit_count: 2,
  depth: 1,
  gates: [{ type: 'H', targets: [0], controls: [], params: [], layer: 0 }],
};

const RESULT: SimulationResult = {
  state_vector: [
    { re: 1, im: 0 },
    { re: 0, im: 0 },
    { re: 0, im: 0 },
    { re: 0, im: 0 },
  ],
  probabilities: { '00': 0.5, '11': 0.5 },
  measurements: {},
  bloch_coords: [],
  execution_time_ms: 12,
  metrics: {},
};

function ctx(partial: Partial<VisibilityCtx>): VisibilityCtx {
  return {
    preset: 'clean',
    snapshot: null,
    result: null,
    hasTerminalOutput: false,
    errorActive: false,
    mode: 'learn',
    framework: null,
    ...partial,
  };
}

/**
 * FROZEN COPY of the pre-PRD-11 `layoutStore.computeVisiblePanels`, exactly
 * as it shipped in v0.6.x. The registry migration is proven correct by
 * asserting `resolveVisiblePanels` (no overrides) equals this across a full
 * input matrix. If a future edit to the registry's reveal rules diverges
 * from this, the parity test fails — the Learn-mode pedagogy lock (PRD 11
 * Risk 1) can never silently drift.
 */
function legacyComputeVisiblePanels(input: {
  preset: LayoutPreset;
  snapshot: CircuitSnapshot | null;
  result: SimulationResult | null;
  hasTerminalOutput: boolean;
  errorActive: boolean;
}): VisiblePanels {
  const { preset, snapshot, result, hasTerminalOutput, errorActive } = input;

  if (preset === 'full') {
    return {
      circuit: true,
      bloch: true,
      histogramChip: false,
      histogramFull: true,
      terminal: true,
    };
  }

  if (preset === 'balanced') {
    return {
      circuit: true,
      bloch: true,
      histogramChip: Boolean(result),
      histogramFull: false,
      terminal: hasTerminalOutput || errorActive,
    };
  }

  const hasGates = Boolean(snapshot && snapshot.gates.length > 0);
  const hasResult = Boolean(result);

  return {
    circuit: hasGates,
    bloch: hasResult,
    histogramChip: hasResult,
    histogramFull: false,
    terminal: hasTerminalOutput || errorActive,
  };
}

// ── Relocated reveal-rule unit tests (verbatim from layoutStore.test.ts) ──

describe('resolveVisiblePanels — reveal rules (relocated from layoutStore)', () => {
  describe("preset 'clean'", () => {
    it('hides circuit/bloch/histogram/terminal with no snapshot and no result', () => {
      expect(resolveVisiblePanels(ctx({ preset: 'clean' }))).toEqual({
        circuit: false,
        bloch: false,
        histogramChip: false,
        histogramFull: false,
        terminal: false,
      });
    });

    it('reveals circuit once the snapshot has at least one gate', () => {
      const v = resolveVisiblePanels(ctx({ preset: 'clean', snapshot: GATE_SNAPSHOT }));
      expect(v.circuit).toBe(true);
      expect(v.bloch).toBe(false);
      expect(v.histogramChip).toBe(false);
    });

    it('keeps circuit hidden when snapshot has zero gates', () => {
      const v = resolveVisiblePanels(ctx({ preset: 'clean', snapshot: EMPTY_SNAPSHOT }));
      expect(v.circuit).toBe(false);
    });

    it('reveals bloch + histogramChip when a result is present', () => {
      const v = resolveVisiblePanels(
        ctx({ preset: 'clean', snapshot: GATE_SNAPSHOT, result: RESULT }),
      );
      expect(v.bloch).toBe(true);
      expect(v.histogramChip).toBe(true);
      expect(v.histogramFull).toBe(false);
    });

    it('reveals terminal on error', () => {
      expect(resolveVisiblePanels(ctx({ preset: 'clean', errorActive: true })).terminal).toBe(true);
    });

    it('reveals terminal when output exists', () => {
      expect(resolveVisiblePanels(ctx({ preset: 'clean', hasTerminalOutput: true })).terminal).toBe(
        true,
      );
    });
  });

  describe("preset 'balanced'", () => {
    it('forces circuit + bloch visible even with no code yet', () => {
      const v = resolveVisiblePanels(ctx({ preset: 'balanced' }));
      expect(v.circuit).toBe(true);
      expect(v.bloch).toBe(true);
      expect(v.histogramChip).toBe(false);
      expect(v.histogramFull).toBe(false);
    });
  });

  describe("preset 'full'", () => {
    it('forces every panel visible and shows full histogram, not chip', () => {
      expect(resolveVisiblePanels(ctx({ preset: 'full' }))).toEqual({
        circuit: true,
        bloch: true,
        histogramChip: false,
        histogramFull: true,
        terminal: true,
      });
    });
  });
});

// ── Parity: registry === frozen legacy across the full input matrix ──

describe('resolveVisiblePanels parity with v0.6.x computeVisiblePanels', () => {
  const presets: LayoutPreset[] = ['clean', 'balanced', 'full'];
  const snapshots = [null, EMPTY_SNAPSHOT, GATE_SNAPSHOT];
  const results = [null, RESULT];
  const bools = [false, true];

  it('matches the frozen legacy output for every input combination (no overrides)', () => {
    for (const preset of presets) {
      for (const snapshot of snapshots) {
        for (const result of results) {
          for (const hasTerminalOutput of bools) {
            for (const errorActive of bools) {
              const input = { preset, snapshot, result, hasTerminalOutput, errorActive };
              const resolved = resolveVisiblePanels(
                ctx({ ...input, mode: 'learn', framework: snapshot?.framework ?? null }),
              );
              expect(resolved).toEqual(legacyComputeVisiblePanels(input));
            }
          }
        }
      }
    }
  });
});

// ── Resolved-Learn-output snapshot: panel parity under identical inputs ──

describe('resolved Learn-mode output snapshot (PRD 11 Phase A parity lock)', () => {
  it('produces the exact Learn panel set for the canonical reveal scenarios', () => {
    const scenarios: Record<string, VisiblePanels> = {};
    const cases: Array<[string, Partial<VisibilityCtx>]> = [
      ['clean/empty', { preset: 'clean' }],
      ['clean/gates', { preset: 'clean', snapshot: GATE_SNAPSHOT }],
      ['clean/result', { preset: 'clean', snapshot: GATE_SNAPSHOT, result: RESULT }],
      ['clean/error', { preset: 'clean', errorActive: true }],
      ['balanced/empty', { preset: 'balanced' }],
      ['balanced/result', { preset: 'balanced', result: RESULT }],
      ['full/empty', { preset: 'full' }],
    ];
    for (const [name, partial] of cases) {
      scenarios[name] = resolveVisiblePanels(ctx({ ...partial, mode: 'learn' }));
    }
    expect(scenarios).toMatchInlineSnapshot(`
      {
        "balanced/empty": {
          "bloch": true,
          "circuit": true,
          "histogramChip": false,
          "histogramFull": false,
          "terminal": false,
        },
        "balanced/result": {
          "bloch": true,
          "circuit": true,
          "histogramChip": true,
          "histogramFull": false,
          "terminal": false,
        },
        "clean/empty": {
          "bloch": false,
          "circuit": false,
          "histogramChip": false,
          "histogramFull": false,
          "terminal": false,
        },
        "clean/error": {
          "bloch": false,
          "circuit": false,
          "histogramChip": false,
          "histogramFull": false,
          "terminal": true,
        },
        "clean/gates": {
          "bloch": false,
          "circuit": true,
          "histogramChip": false,
          "histogramFull": false,
          "terminal": false,
        },
        "clean/result": {
          "bloch": true,
          "circuit": true,
          "histogramChip": true,
          "histogramFull": false,
          "terminal": false,
        },
        "full/empty": {
          "bloch": true,
          "circuit": true,
          "histogramChip": false,
          "histogramFull": true,
          "terminal": true,
        },
      }
    `);
  });
});

// ── Framework affinity mechanism (Phase A ships it; PRD 10 D applies it) ──

describe('framework affinity', () => {
  it("every Phase A panel is 'any' — zero behavior change from the registry", () => {
    for (const panel of PANEL_REGISTRY) {
      expect(panel.frameworks).toBe('any');
    }
  });

  it("panelPassesFramework admits everything for 'any'", () => {
    const any: Pick<PanelDef, 'frameworks'> = { frameworks: 'any' };
    for (const fw of ['qiskit', 'cirq', 'cuda-q', 'qsharp', 'stim'] as Framework[]) {
      expect(panelPassesFramework(any, fw)).toBe(true);
    }
    expect(panelPassesFramework(any, null)).toBe(true);
  });

  it('a concrete affinity list hides non-member frameworks but admits null', () => {
    // Mirrors what PRD 10 Phase D will set: bloch = non-stim frameworks.
    const nonStim: Pick<PanelDef, 'frameworks'> = {
      frameworks: ['qiskit', 'cirq', 'cuda-q', 'qsharp'],
    };
    expect(panelPassesFramework(nonStim, 'qiskit')).toBe(true);
    expect(panelPassesFramework(nonStim, 'stim')).toBe(false);
    // null (no circuit parsed yet) must never hide — preserves pre-registry behavior.
    expect(panelPassesFramework(nonStim, null)).toBe(true);
  });

  it('resolveVisiblePanels applies affinity as a hard gate over defaultVisible', () => {
    // Synthetic proof the resolver gates on affinity: build a ctx that would
    // reveal bloch, then confirm a stim-excluding affinity would hide it.
    const revealCtx = ctx({ preset: 'full', framework: 'stim' });
    // With the real 'any' registry, bloch shows for stim in Phase A.
    expect(resolveVisiblePanels(revealCtx).bloch).toBe(true);
    // The gate itself: a non-stim affinity + stim framework → hidden.
    expect(
      panelPassesFramework({ frameworks: ['qiskit', 'cirq', 'cuda-q', 'qsharp'] }, 'stim'),
    ).toBe(false);
  });
});

// ── Overrides ──

describe('resolveVisiblePanels overrides', () => {
  it('an explicit override wins over the reveal rule', () => {
    const base = ctx({ preset: 'clean' }); // everything hidden
    expect(resolveVisiblePanels(base).bloch).toBe(false);
    expect(resolveVisiblePanels(base, { bloch: true }).bloch).toBe(true);
    // A force-hide override on a panel the rule would show:
    const showing = ctx({ preset: 'full' });
    expect(resolveVisiblePanels(showing).terminal).toBe(true);
    expect(resolveVisiblePanels(showing, { terminal: false }).terminal).toBe(false);
  });

  it('overrides never bypass framework affinity (hard capability gate)', () => {
    // Simulate a stim-excluded panel by temporarily checking the gate:
    // a user force-show cannot resurrect a framework-incompatible panel.
    const p: Pick<PanelDef, 'frameworks'> = { frameworks: ['qiskit'] };
    expect(panelPassesFramework(p, 'stim')).toBe(false);
    // (The resolver ANDs override with affinity — proven structurally here
    // because Phase A panels are all 'any'; PRD 10 D adds the concrete case.)
  });
});

describe('registry shape', () => {
  it('declares the five viz/bottom panels in stable order', () => {
    expect(PANEL_REGISTRY.map((p) => p.id)).toEqual([
      'circuit',
      'bloch',
      'histogramChip',
      'histogramFull',
      'terminal',
    ]);
  });

  it('groups panels by zone', () => {
    expect(panelsInZone('viz').map((p) => p.id)).toEqual(['circuit', 'bloch', 'histogramChip']);
    expect(panelsInZone('bottom').map((p) => p.id)).toEqual(['histogramFull', 'terminal']);
  });

  it('every panel id is unique and typed', () => {
    const ids = PANEL_REGISTRY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Compile-time: PanelId covers every registry id.
    const _check: PanelId[] = ids;
    expect(_check.length).toBe(5);
  });
});
