import { resolveVisiblePanels, type PanelId, type VisiblePanels } from './panelRegistry';
import { useLayoutStore } from '../stores/layoutStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useCircuitStore } from '../stores/circuitStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';

/**
 * The same resolved panel visibility PanelLayout renders, read imperatively
 * from the stores. Palette commands and shortcuts use it so a "toggle"
 * flips what the user actually sees instead of a stale override.
 */
export function getResolvedVisibility(): VisiblePanels {
  const { preset, overrides } = useLayoutStore.getState();
  const { result, terminalOutput, lastRunFailed } = useSimulationStore.getState();
  const snapshot = useCircuitStore.getState().snapshot;
  return resolveVisiblePanels(
    {
      preset,
      snapshot,
      result,
      hasTerminalOutput: terminalOutput.length > 0,
      errorActive: lastRunFailed,
      mode: useWorkspaceStore.getState().mode,
      framework: snapshot?.framework ?? null,
    },
    overrides,
  );
}

/**
 * Flip a panel against its currently resolved visibility. Showing the
 * terminal also expands the bottom panel and selects its Terminal tab, so
 * the toggle never lands on a collapsed or histogram-only panel.
 */
export function togglePanelResolved(id: PanelId): void {
  useLayoutStore.getState().togglePanel(id, getResolvedVisibility()[id]);
  if (id === 'terminal' && getResolvedVisibility().terminal) {
    useBottomPanelStore.getState().focusTerminal();
  }
}
