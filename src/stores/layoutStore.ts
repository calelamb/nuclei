import { create } from 'zustand';
import type { PanelId } from '../layout/panelRegistry';

export type LayoutPreset = 'clean' | 'balanced' | 'full';

/**
 * Reveal rules relocated (PRD 11 Phase A): the pure `computeVisiblePanels`
 * that used to live here now lives in `src/layout/panelRegistry.ts` as
 * per-panel `defaultVisible` functions + `resolveVisiblePanels`. This store
 * keeps only stateful layout concerns: the preset, the dismissable histogram
 * chip, and per-project panel visibility overrides.
 */

interface LayoutStoreState {
  preset: LayoutPreset;
  histogramChipDismissed: boolean;
  /**
   * Explicit per-project panel visibility overrides (PRD 11 Phase A). An
   * entry here wins over the reveal rule (subject to framework affinity —
   * see `resolveVisiblePanels`). Empty by default, so with no user toggles
   * the resolved set is identical to the old reveal-rule output. Persisted
   * per project via `hydrateOverrides` / the caller's persistence layer.
   */
  overrides: Partial<Record<PanelId, boolean>>;
  setPreset(p: LayoutPreset): void;
  dismissHistogramChip(): void;
  resetRunArtifacts(): void;
  /** Force a panel visible/hidden (the PanelHeader "Hide panel" action, Phase C). */
  setPanelOverride(id: PanelId, visible: boolean): void;
  /** Drop a single override, returning the panel to its reveal rule. */
  clearPanelOverride(id: PanelId): void;
  /** Drop every override ("Reset layout"). */
  resetPanelOverrides(): void;
  /** Replace the override map wholesale — used when loading a project's
   * persisted layout. */
  hydrateOverrides(overrides: Partial<Record<PanelId, boolean>>): void;
}

export const useLayoutStore = create<LayoutStoreState>((set) => ({
  preset: 'clean',
  histogramChipDismissed: false,
  overrides: {},
  setPreset: (preset) => set({ preset }),
  dismissHistogramChip: () => set({ histogramChipDismissed: true }),
  resetRunArtifacts: () => set({ histogramChipDismissed: false }),
  setPanelOverride: (id, visible) =>
    set((state) => ({ overrides: { ...state.overrides, [id]: visible } })),
  clearPanelOverride: (id) =>
    set((state) => {
      if (!(id in state.overrides)) return state;
      const next = { ...state.overrides };
      delete next[id];
      return { overrides: next };
    }),
  resetPanelOverrides: () => set({ overrides: {} }),
  hydrateOverrides: (overrides) => set({ overrides: { ...overrides } }),
}));
