import { useUIModeStore, type UIMode } from '../../stores/uiModeStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

export type OnboardingChoice = 'welcome' | 'beginner' | 'intermediate' | 'experienced' | 'research';

const UI_MODE_FOR_PATH: Partial<Record<OnboardingChoice, UIMode>> = {
  beginner: 'beginner',
  intermediate: 'intermediate',
  experienced: 'advanced',
};

/**
 * Applies an onboarding choice to the stores. `undefined` (a returning user
 * continuing) deliberately touches nothing, so the stored UI mode and
 * workspace survive. Persistence is handled by usePersistedPrefs.
 */
export function applyOnboardingPath(path: OnboardingChoice | undefined): void {
  if (!path) return;
  const uiMode = UI_MODE_FOR_PATH[path];
  if (uiMode) {
    useWorkspaceStore.getState().setMode('learn');
    useUIModeStore.getState().setMode(uiMode);
  } else if (path === 'research') {
    useWorkspaceStore.getState().setMode('research');
  }
}
