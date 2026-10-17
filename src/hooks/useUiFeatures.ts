import { useUIModeStore } from '../stores/uiModeStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { featuresFor, type UiModeFeatures } from '../layout/uiModeFeatures';

/** The progressive-disclosure feature flags for the current workspace + UI mode. */
export function useUiFeatures(): UiModeFeatures {
  const workspace = useWorkspaceStore((s) => s.mode);
  const uiMode = useUIModeStore((s) => s.mode);
  return featuresFor(workspace, uiMode);
}
