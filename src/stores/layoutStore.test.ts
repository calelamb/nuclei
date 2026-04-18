import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore, computeVisiblePanels, type LayoutPreset } from './layoutStore';
import type { CircuitSnapshot, SimulationResult } from '../types/quantum';

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
};

describe('computeVisiblePanels', () => {
  describe("preset 'clean'", () => {
    it('hides circuit/bloch/histogram/terminal with no snapshot and no result', () => {
      const v = computeVisiblePanels({
        preset: 'clean',
        snapshot: null,
        result: null,
        hasTerminalOutput: false,
        errorActive: false,
      });
      expect(v).toEqual({
        circuit: false,
        bloch: false,
        histogramChip: false,
        histogramFull: false,
        terminal: false,
      });
    });

    it('reveals circuit once the snapshot has at least one gate', () => {
      const v = computeVisiblePanels({
        preset: 'clean',
        snapshot: GATE_SNAPSHOT,
        result: null,
        hasTerminalOutput: false,
        errorActive: false,
      });
      expect(v.circuit).toBe(true);
      expect(v.bloch).toBe(false);
      expect(v.histogramChip).toBe(false);
    });

    it('keeps circuit hidden when snapshot has zero gates', () => {
      const v = computeVisiblePanels({
        preset: 'clean',
        snapshot: EMPTY_SNAPSHOT,
        result: null,
        hasTerminalOutput: false,
        errorActive: false,
      });
      expect(v.circuit).toBe(false);
    });

    it('reveals bloch + histogramChip when a result is present', () => {
      const v = computeVisiblePanels({
        preset: 'clean',
        snapshot: GATE_SNAPSHOT,
        result: RESULT,
        hasTerminalOutput: false,
        errorActive: false,
      });
      expect(v.bloch).toBe(true);
      expect(v.histogramChip).toBe(true);
      expect(v.histogramFull).toBe(false);
    });

    it('reveals terminal on error', () => {
      const v = computeVisiblePanels({
        preset: 'clean',
        snapshot: null,
        result: null,
        hasTerminalOutput: false,
        errorActive: true,
      });
      expect(v.terminal).toBe(true);
    });

    it('reveals terminal when output exists', () => {
      const v = computeVisiblePanels({
        preset: 'clean',
        snapshot: null,
        result: null,
        hasTerminalOutput: true,
        errorActive: false,
      });
      expect(v.terminal).toBe(true);
    });
  });

  describe("preset 'balanced'", () => {
    it('forces circuit + bloch visible even with no code yet', () => {
      const v = computeVisiblePanels({
        preset: 'balanced',
        snapshot: null,
        result: null,
        hasTerminalOutput: false,
        errorActive: false,
      });
      expect(v.circuit).toBe(true);
      expect(v.bloch).toBe(true);
      expect(v.histogramChip).toBe(false);
      expect(v.histogramFull).toBe(false);
    });
  });

  describe("preset 'full'", () => {
    it('forces every panel visible and shows full histogram, not chip', () => {
      const v = computeVisiblePanels({
        preset: 'full',
        snapshot: null,
        result: null,
        hasTerminalOutput: false,
        errorActive: false,
      });
      expect(v).toEqual({
        circuit: true,
        bloch: true,
        histogramChip: false,
        histogramFull: true,
        terminal: true,
      });
    });
  });
});

describe('useLayoutStore', () => {
  beforeEach(() => {
    useLayoutStore.setState({ preset: 'clean', histogramChipDismissed: false });
  });

  it("defaults to preset 'clean'", () => {
    expect(useLayoutStore.getState().preset).toBe('clean');
  });

  it('can switch preset', () => {
    useLayoutStore.getState().setPreset('balanced' satisfies LayoutPreset);
    expect(useLayoutStore.getState().preset).toBe('balanced');
  });

  it('tracks histogram chip dismissal', () => {
    useLayoutStore.getState().dismissHistogramChip();
    expect(useLayoutStore.getState().histogramChipDismissed).toBe(true);
  });

  it('resets histogram chip dismissal on new run', () => {
    useLayoutStore.getState().dismissHistogramChip();
    useLayoutStore.getState().resetRunArtifacts();
    expect(useLayoutStore.getState().histogramChipDismissed).toBe(false);
  });
});
