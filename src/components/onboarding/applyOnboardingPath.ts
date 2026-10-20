import { useUIModeStore, type UIMode } from '../../stores/uiModeStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { isLearnEnabled } from '../../stores/learnGateStore';
import { useLearnStore } from '../../stores/learnStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { isWebBuild } from '../../platform/buildTarget';
import { TRACKS } from '../../data/lessons/tracks';

export type OnboardingChoice = 'welcome' | 'beginner' | 'intermediate' | 'experienced' | 'research';

const UI_MODE_FOR_PATH: Partial<Record<OnboardingChoice, UIMode>> = {
  beginner: 'beginner',
  intermediate: 'intermediate',
  experienced: 'advanced',
};

/** The lesson a brand-new learner starts on: the first lesson of the fundamentals track. */
export const FIRST_LESSON_TRACK_ID = 'track-1';

function startFirstLesson(): void {
  const track = TRACKS.find((t) => t.id === FIRST_LESSON_TRACK_ID);
  const lesson = track?.lessons[0];
  const learn = useLearnStore.getState();
  if (track && lesson) learn.setCurrentLesson(track.id, lesson.id);
  learn.enterLearnMode();
  useNavigationStore.getState().setActiveView(null);
}

function openTrackChooser(): void {
  const learn = useLearnStore.getState();
  learn.clearCurrentLesson();
  learn.enterLearnMode();
  useNavigationStore.getState().setActiveView(null);
}

/**
 * Applies an onboarding choice to the stores. `undefined` (a returning user
 * continuing) deliberately touches nothing, so the stored UI mode and
 * workspace survive. Persistence is handled by usePersistedPrefs.
 *
 * Every Learn path lands somewhere with content: the brand-new learner on lesson 1,
 * the intermediate learner on the track chooser, and the experienced learner in the
 * editor (on the web build the Explorer is desktop-only, so its empty notice is never
 * the landing view).
 */
export function applyOnboardingPath(path: OnboardingChoice | undefined): void {
  if (!path) return;
  // Learn is hidden by default: a Learn path (stale caller, test hook) falls back to Research.
  if (path !== 'research' && !isLearnEnabled()) path = 'research';
  const uiMode = UI_MODE_FOR_PATH[path];
  if (uiMode) {
    useWorkspaceStore.getState().setMode('learn');
    useUIModeStore.getState().setMode(uiMode);
    if (path === 'beginner') startFirstLesson();
    else if (path === 'intermediate') openTrackChooser();
    else if (isWebBuild()) useNavigationStore.getState().setActiveView(null);
  } else if (path === 'research') {
    useWorkspaceStore.getState().setMode('research');
  }
}
