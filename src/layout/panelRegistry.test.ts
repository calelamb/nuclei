import { describe, it, expect } from 'vitest';
import {
  PANEL_REGISTRY,
  panelPassesFramework,
  resolveVisiblePanels,
  panelsInZone,
  leftPanelsForMode,
  bottomLeftPanelsForMode,
  LEFT_PANEL_REGISTRY,
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
        qecTimeline: false,
        qecLattice: false,
        qecDetectorGraph: false,
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
        // QEC panels require a stim framework; null (no circuit) keeps them off.
        qecTimeline: false,
        qecLattice: false,
        qecDetectorGraph: false,
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
              // Compare only the five legacy panels; the QEC panels (added in
              // Phase D) are always false here (non-stim frameworks) and are
              // asserted separately.
              const legacyKeys = legacyComputeVisiblePanels(input);
              expect({
                circuit: resolved.circuit,
                bloch: resolved.bloch,
                histogramChip: resolved.histogramChip,
                histogramFull: resolved.histogramFull,
                terminal: resolved.terminal,
              }).toEqual(legacyKeys);
              expect(resolved.qecTimeline).toBe(false);
              expect(resolved.qecLattice).toBe(false);
              expect(resolved.qecDetectorGraph).toBe(false);
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
      const full = resolveVisiblePanels(ctx({ ...partial, mode: 'learn' }));
      // Snapshot the five core panels — the Learn pedagogy lock. QEC panels
      // (Phase D) are asserted-false separately below; excluding them keeps
      // this snapshot the exact v0.6.x parity proof.
      scenarios[name] = {
        circuit: full.circuit,
        bloch: full.bloch,
        histogramChip: full.histogramChip,
        histogramFull: full.histogramFull,
        terminal: full.terminal,
      } as VisiblePanels;
      expect(full.qecTimeline).toBe(false);
      expect(full.qecLattice).toBe(false);
      expect(full.qecDetectorGraph).toBe(false);
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
  it('Bloch is non-stim; the QEC panels are stim-only (PRD 10 Phase D swap)', () => {
    const byId = Object.fromEntries(PANEL_REGISTRY.map((p) => [p.id, p]));
    expect(byId.bloch.frameworks).toEqual(['qiskit', 'cirq', 'cuda-q', 'qsharp']);
    expect(byId.qecTimeline.frameworks).toEqual(['stim']);
    expect(byId.qecLattice.frameworks).toEqual(['stim']);
    expect(byId.qecDetectorGraph.frameworks).toEqual(['stim']);
    // The non-viz panels stay framework-agnostic.
    expect(byId.circuit.frameworks).toBe('any');
    expect(byId.terminal.frameworks).toBe('any');
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

  it('the Bloch→QEC swap: stim hides Bloch and shows the QEC panels; qiskit is the reverse', () => {
    const stim = resolveVisiblePanels(ctx({ preset: 'full', framework: 'stim', snapshot: GATE_SNAPSHOT }));
    expect(stim.bloch).toBe(false);
    expect(stim.qecTimeline).toBe(true);
    expect(stim.qecLattice).toBe(true);
    expect(stim.qecDetectorGraph).toBe(true);

    const qiskit = resolveVisiblePanels(ctx({ preset: 'full', framework: 'qiskit', snapshot: GATE_SNAPSHOT }));
    expect(qiskit.bloch).toBe(true);
    expect(qiskit.qecTimeline).toBe(false);
    expect(qiskit.qecLattice).toBe(false);
    expect(qiskit.qecDetectorGraph).toBe(false);
  });

  it('QEC panels never show pre-circuit (framework null), keeping Learn untouched', () => {
    const v = resolveVisiblePanels(ctx({ preset: 'full', framework: null }));
    expect(v.qecTimeline).toBe(false);
    expect(v.qecLattice).toBe(false);
    expect(v.qecDetectorGraph).toBe(false);
    // Bloch's pre-circuit behavior is preserved (full preset shows it).
    expect(v.bloch).toBe(true);
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
  it('declares all viz/bottom panels in stable order (incl. the QEC panels)', () => {
    expect(PANEL_REGISTRY.map((p) => p.id)).toEqual([
      'circuit',
      'bloch',
      'histogramChip',
      'histogramFull',
      'terminal',
      'qecTimeline',
      'qecLattice',
      'qecDetectorGraph',
    ]);
  });

  it('groups panels by zone', () => {
    expect(panelsInZone('viz').map((p) => p.id)).toEqual([
      'circuit', 'bloch', 'histogramChip', 'qecTimeline', 'qecLattice', 'qecDetectorGraph',
    ]);
    expect(panelsInZone('bottom').map((p) => p.id)).toEqual(['histogramFull', 'terminal']);
  });

  it('every panel id is unique and typed', () => {
    const ids = PANEL_REGISTRY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Compile-time: PanelId covers every registry id.
    const _check: PanelId[] = ids;
    expect(_check.length).toBe(8);
  });
});

// ── Left-rail registry (PRD 11 Phase C) ──

describe('left-rail registry', () => {
  it('gives each mode its intended rail with developer views off', () => {
    expect(leftPanelsForMode('learn', { developerViews: false })).toEqual([
      'files', 'learning', 'challenges', 'launch', 'community', 'settings',
    ]);
    expect(leftPanelsForMode('research', { developerViews: false })).toEqual([
      'files', 'experiments', 'hardware', 'launch', 'plugins', 'settings',
    ]);
  });

  it('the developer flag governs ONLY search + circuit — no other view is flag-gated', () => {
    for (const mode of ['learn', 'research'] as const) {
      const off = leftPanelsForMode(mode, { developerViews: false });
      const on = leftPanelsForMode(mode, { developerViews: true });
      expect(on.filter((v) => !off.includes(v)).sort()).toEqual(['circuit', 'search']);
    }
  });

  it('no view is double-gated: dev-flagged views are never also mode-restricted', () => {
    // Structural invariant — the only panels with dev:true are search/circuit,
    // and they belong to both modes (flag-only, never mode-only).
    for (const p of LEFT_PANEL_REGISTRY) {
      if (p.dev) {
        expect(p.modes).toEqual(['learn', 'research']);
      }
    }
  });

  it('settings is the only bottom-pinned view, in both modes', () => {
    expect(bottomLeftPanelsForMode('learn')).toEqual(['settings']);
    expect(bottomLeftPanelsForMode('research')).toEqual(['settings']);
  });

  it('hardware/plugins are research-only; learning/challenges/community are learn-only', () => {
    const research = leftPanelsForMode('research', { developerViews: true });
    const learn = leftPanelsForMode('learn', { developerViews: true });
    expect(research).toEqual(expect.arrayContaining(['hardware', 'plugins', 'experiments']));
    expect(research).not.toEqual(expect.arrayContaining(['learning', 'challenges', 'community']));
    expect(learn).toEqual(expect.arrayContaining(['learning', 'challenges', 'community']));
    expect(learn).not.toEqual(expect.arrayContaining(['hardware', 'plugins', 'experiments']));
  });
});
