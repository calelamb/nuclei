import { beforeEach, describe, expect, it } from 'vitest';
import { useNavigationStore } from './navigationStore';
import { useLearnStore } from './learnStore';
import { useChallengeModeStore } from './challengeModeStore';

beforeEach(() => {
  useNavigationStore.setState({ activeView: 'files', autoCollapsedView: null, settingsTarget: null });
  useLearnStore.setState({ isLearnMode: false });
  useChallengeModeStore.setState({ isChallengeMode: false });
});

describe('openSettings', () => {
  it('keeps the lesson on screen: Learn mode stays active while Settings opens beside it', () => {
    useLearnStore.setState({ isLearnMode: true });
    useNavigationStore.getState().openSettings('dirac');
    expect(useLearnStore.getState().isLearnMode).toBe(true);
    expect(useNavigationStore.getState().activeView).toBe('settings');
    expect(useNavigationStore.getState().settingsTarget?.section).toBe('dirac');
  });

  it('keeps a challenge on screen too', () => {
    useChallengeModeStore.setState({ isChallengeMode: true });
    useNavigationStore.getState().openSettings();
    expect(useChallengeModeStore.getState().isChallengeMode).toBe(true);
  });

  it('selecting a different rail view still leaves the full-view surface', () => {
    useLearnStore.setState({ isLearnMode: true });
    useNavigationStore.getState().openSettings('dirac');
    useNavigationStore.getState().setActiveView('files');
    expect(useLearnStore.getState().isLearnMode).toBe(false);
  });
});

describe('room retreat', () => {
  beforeEach(() => {
    useNavigationStore.setState({ activeView: 'files', autoCollapsedView: null, lastNarrow: false });
  });

  it('parks the open view and restores it when room returns', () => {
    useNavigationStore.getState().retreatSidebarForRoom();
    expect(useNavigationStore.getState().activeView).toBeNull();
    expect(useNavigationStore.getState().autoCollapsedView).toBe('files');
    useNavigationStore.getState().restoreSidebarForRoom();
    expect(useNavigationStore.getState().activeView).toBe('files');
    expect(useNavigationStore.getState().autoCollapsedView).toBeNull();
  });

  it('does not restore over a sidebar the user already reopened or a narrow-window fold', () => {
    useNavigationStore.getState().retreatSidebarForRoom();
    useNavigationStore.getState().setActiveView('settings');
    useNavigationStore.getState().restoreSidebarForRoom();
    expect(useNavigationStore.getState().activeView).toBe('settings');

    useNavigationStore.setState({ activeView: null, autoCollapsedView: 'files', lastNarrow: true });
    useNavigationStore.getState().restoreSidebarForRoom();
    expect(useNavigationStore.getState().activeView).toBeNull();
  });
});
