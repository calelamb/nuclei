import { railViewsFor, type LeftPanelId } from './panelRegistry';
import { useNavigationStore } from '../stores/navigationStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

/** The raw `view` value from a query string, or null when absent or empty. */
export function parseViewParam(search: string): string | null {
  const value = new URLSearchParams(search).get('view')?.trim();
  return value ? value : null;
}

/** The rail views a `?view=` link can open: exactly the Research rail (so never lessons or challenges). */
export function deepLinkableViews(): LeftPanelId[] {
  const developerViews = useSettingsStore.getState().general.experimentalFeatures;
  return railViewsFor('research', { developerViews, explorerSidebar: true });
}

/**
 * Read once at startup: `?view=<id>` opens that left-rail view in the Research workspace, through the same
 * navigation action as the rail, Cmd+1..9 and the palette. Unknown or unavailable ids are ignored and leave
 * the workspace untouched. Returns the view that was opened, or null.
 */
export function applyViewQueryParam(search: string): LeftPanelId | null {
  const requested = parseViewParam(search);
  if (!requested) return null;
  const view = deepLinkableViews().find((v) => v === requested);
  if (!view) return null;
  useWorkspaceStore.getState().setMode('research');
  if (useWorkspaceStore.getState().mode !== 'research') return null;
  useNavigationStore.getState().selectView(view, { toggle: false });
  return view;
}
