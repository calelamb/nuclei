import type { ActivityView } from './ActivityBar';
import type { WorkspaceMode } from '../../stores/workspaceStore';
import {
  leftPanelsForMode,
  bottomLeftPanelsForMode,
  type LeftPanelId,
} from '../../layout/panelRegistry';

/**
 * Activity-bar (left-rail) view selection.
 *
 * As of PRD 11 Phase C this delegates to the unified panel registry
 * (`src/layout/panelRegistry.ts`), which owns the left-panel definitions and
 * the mode/developer-flag gating. This module stays as the ActivityBar-facing
 * API and the type bridge between the registry's `LeftPanelId` and the
 * component's `ActivityView` (they are the same set — asserted below).
 */

// Compile-time proof the two id unions stay in lock-step.
type _AssertSame = LeftPanelId extends ActivityView
  ? ActivityView extends LeftPanelId
    ? true
    : never
  : never;
const _same: _AssertSame = true;
void _same;

export interface PanelRegistryOptions {
  /**
   * The developer-views flag (Settings → Advanced), formerly the broad
   * "experimental features" flag. It now governs ONLY the Search and Circuit
   * inspector views — every other view is gated by mode alone, so no view is
   * double-gated (PRD 11 Phase C).
   */
  experimentalFeatures: boolean;
}

/** Ordered activity-bar views for a mode (top + bottom-pinned). */
export function activityViewsForMode(
  mode: WorkspaceMode,
  { experimentalFeatures }: PanelRegistryOptions,
): ActivityView[] {
  return leftPanelsForMode(mode, { developerViews: experimentalFeatures });
}

/** Views rendered pinned to the bottom of the rail for a mode. */
export function bottomViewsForMode(mode: WorkspaceMode): ActivityView[] {
  return bottomLeftPanelsForMode(mode);
}
