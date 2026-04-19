import { create } from 'zustand';
import type { CircuitSnapshot, SimulationResult } from '../types/quantum';

export type LayoutPreset = 'clean' | 'balanced' | 'full';

export interface VisiblePanels {
  circuit: boolean;
  bloch: boolean;
  histogramChip: boolean;
  histogramFull: boolean;
  terminal: boolean;
}

export interface VisibilityInputs {
  preset: LayoutPreset;
  snapshot: CircuitSnapshot | null;
  result: SimulationResult | null;
  hasTerminalOutput: boolean;
  errorActive: boolean;
}

/**
 * Given the layout preset plus current circuit/sim state, return the set
 * of panels that should be visible. Pure and side-effect free so the
 * reveal rules can be exhaustively tested without React.
 */
export function computeVisiblePanels(input: VisibilityInputs): VisiblePanels {
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

  // 'clean' — every panel is driven by evidence of the student's code.
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

interface LayoutStoreState {
  preset: LayoutPreset;
  histogramChipDismissed: boolean;
  setPreset(p: LayoutPreset): void;
  dismissHistogramChip(): void;
  resetRunArtifacts(): void;
}

export const useLayoutStore = create<LayoutStoreState>((set) => ({
  preset: 'clean',
  histogramChipDismissed: false,
  setPreset: (preset) => set({ preset }),
  dismissHistogramChip: () => set({ histogramChipDismissed: true }),
  resetRunArtifacts: () => set({ histogramChipDismissed: false }),
}));
