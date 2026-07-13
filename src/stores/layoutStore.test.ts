import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore, type LayoutPreset } from './layoutStore';

// NOTE: the reveal-rule tests for computeVisiblePanels were RELOCATED to
// src/layout/panelRegistry.test.ts as part of PRD 11 Phase A (the logic
// moved into the registry's defaultVisible functions, verbatim, with a
// parity test against a frozen copy of the old function). This file now
// covers only the layout store's own state.

describe('useLayoutStore', () => {
  beforeEach(() => {
    useLayoutStore.setState({ preset: 'clean', histogramChipDismissed: false, overrides: {} });
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

  describe('panel overrides (PRD 11 Phase A)', () => {
    it('starts empty — no override means reveal-rule behavior', () => {
      expect(useLayoutStore.getState().overrides).toEqual({});
    });

    it('sets and clears a single override', () => {
      useLayoutStore.getState().setPanelOverride('bloch', false);
      expect(useLayoutStore.getState().overrides).toEqual({ bloch: false });
      useLayoutStore.getState().setPanelOverride('terminal', true);
      expect(useLayoutStore.getState().overrides).toEqual({ bloch: false, terminal: true });
      useLayoutStore.getState().clearPanelOverride('bloch');
      expect(useLayoutStore.getState().overrides).toEqual({ terminal: true });
    });

    it('clearing a non-existent override is a no-op (stable reference)', () => {
      const before = useLayoutStore.getState().overrides;
      useLayoutStore.getState().clearPanelOverride('circuit');
      expect(useLayoutStore.getState().overrides).toBe(before);
    });

    it('resetPanelOverrides drops everything', () => {
      useLayoutStore.getState().setPanelOverride('bloch', false);
      useLayoutStore.getState().setPanelOverride('circuit', false);
      useLayoutStore.getState().resetPanelOverrides();
      expect(useLayoutStore.getState().overrides).toEqual({});
    });

    it('hydrateOverrides replaces the whole map (project load)', () => {
      useLayoutStore.getState().setPanelOverride('bloch', false);
      useLayoutStore.getState().hydrateOverrides({ terminal: false, circuit: true });
      expect(useLayoutStore.getState().overrides).toEqual({ terminal: false, circuit: true });
    });
  });
});
