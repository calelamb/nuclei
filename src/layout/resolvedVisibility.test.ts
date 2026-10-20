import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore } from '../stores/layoutStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useCircuitStore } from '../stores/circuitStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { getResolvedVisibility, togglePanelResolved, cycleTerminalShortcut } from './resolvedVisibility';

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

describe('the terminal shortcut cycle (Cmd+`)', () => {
  beforeEach(() => {
    useLayoutStore.setState({ preset: 'clean', overrides: {}, histogramChipDismissed: false });
    useSimulationStore.setState({ terminalOutput: [], result: null, lastRunFailed: false });
    useCircuitStore.setState({ snapshot: null });
    useWorkspaceStore.setState({ mode: 'research' });
    useBottomPanelStore.setState({ collapsed: false, activeTab: 'terminal' });
  });

  it('in Clean, the second press hides the terminal again instead of leaving a collapsed strip', () => {
    cycleTerminalShortcut();
    expect(getResolvedVisibility().terminal).toBe(true);
    cycleTerminalShortcut();
    expect(getResolvedVisibility().terminal).toBe(false);
    expect(useLayoutStore.getState().overrides.terminal).toBeUndefined();
  });

  it('when the preset already shows the terminal, the last press collapses it', () => {
    useLayoutStore.setState({ preset: 'full' });
    expect(getResolvedVisibility().terminal).toBe(true);
    cycleTerminalShortcut();
    expect(useBottomPanelStore.getState().collapsed).toBe(true);
  });

  it('a collapsed terminal opens first', () => {
    useLayoutStore.setState({ preset: 'full' });
    useBottomPanelStore.setState({ collapsed: true });
    cycleTerminalShortcut();
    expect(useBottomPanelStore.getState().collapsed).toBe(false);
  });

  it('another tab comes back to Terminal before anything closes', () => {
    useLayoutStore.setState({ preset: 'full' });
    useBottomPanelStore.setState({ activeTab: 'histogram' });
    cycleTerminalShortcut();
    expect(useBottomPanelStore.getState()).toMatchObject({ activeTab: 'terminal', collapsed: false });
  });
});

