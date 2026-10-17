import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore } from '../stores/layoutStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useCircuitStore } from '../stores/circuitStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { getResolvedVisibility, togglePanelResolved } from './resolvedVisibility';

describe('resolved panel visibility', () => {
  beforeEach(() => {
    useLayoutStore.setState({ preset: 'clean', overrides: {}, histogramChipDismissed: false });
    useSimulationStore.setState({ terminalOutput: [], result: null, lastRunFailed: false });
    useCircuitStore.setState({ snapshot: null });
    useWorkspaceStore.setState({ mode: 'research' });
  });

  it('reports the terminal hidden in Clean with no output', () => {
    expect(getResolvedVisibility().terminal).toBe(false);
  });

  it('reveals the terminal when a run has failed even with no output yet', () => {
    useSimulationStore.setState({ lastRunFailed: true });
    expect(getResolvedVisibility().terminal).toBe(true);
  });

  it('the first toggle of a hidden terminal shows it', () => {
    togglePanelResolved('terminal');
    expect(getResolvedVisibility().terminal).toBe(true);
  });

  it('the first toggle of an auto-revealed terminal hides it, the second shows it again', () => {
    useSimulationStore.getState().addOutput('x', 'stdout');
    expect(getResolvedVisibility().terminal).toBe(true);
    togglePanelResolved('terminal');
    expect(getResolvedVisibility().terminal).toBe(false);
    togglePanelResolved('terminal');
    expect(getResolvedVisibility().terminal).toBe(true);
  });

  it('showing the terminal expands a collapsed bottom panel on the Terminal tab', () => {
    useBottomPanelStore.setState({ collapsed: true, activeTab: 'histogram' });
    togglePanelResolved('terminal');
    expect(useBottomPanelStore.getState()).toMatchObject({ collapsed: false, activeTab: 'terminal' });
  });

  it('fresh terminal output overrides a user-hidden terminal so a failed run is never invisible', () => {
    useLayoutStore.getState().setPanelOverride('terminal', false);
    useBottomPanelStore.getState().focusTerminal();
    expect(useLayoutStore.getState().overrides.terminal).toBeUndefined();
  });
});
