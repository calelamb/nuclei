import type { UIMode } from '../stores/uiModeStore';
import type { WorkspaceMode } from '../stores/workspaceStore';

/**
 * Progressive disclosure: which pieces of chrome each Learn UI mode shows.
 * Strictly additive from Beginner to Advanced. Research ignores the UI mode and
 * is always Advanced. Read through `featuresFor`, never by comparing the mode in
 * components, so the mapping lives (and is tested) in one place.
 */
export interface UiModeFeatures {
  /** The Launch-on-hardware button, strip and modal entry. */
  launchHardware: boolean;
  /** The "Agent goal" autonomous run entry in the Dirac panel. */
  agentEntry: boolean;
  /** The Clean / Balanced / Full layout preset picker. */
  layoutPresets: boolean;
  /** The Explorer sidebar and its activity-bar item. */
  explorerSidebar: boolean;
  /** The framework picker in the editor toolbar (the kernel still auto-detects). */
  frameworkPicker: boolean;
}

const BEGINNER: UiModeFeatures = {
  launchHardware: false,
  agentEntry: false,
  layoutPresets: false,
  explorerSidebar: false,
  frameworkPicker: false,
};

const INTERMEDIATE: UiModeFeatures = {
  ...BEGINNER,
  launchHardware: true,
  layoutPresets: true,
  explorerSidebar: true,
  frameworkPicker: true,
};

const ADVANCED: UiModeFeatures = { ...INTERMEDIATE, agentEntry: true };

export function featuresForUiMode(mode: UIMode): UiModeFeatures {
  switch (mode) {
    case 'beginner': return BEGINNER;
    case 'intermediate': return INTERMEDIATE;
    case 'advanced': return ADVANCED;
  }
}

export function featuresFor(workspace: WorkspaceMode, uiMode: UIMode): UiModeFeatures {
  return workspace === 'research' ? ADVANCED : featuresForUiMode(uiMode);
}
