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

describe('selectView: one rule for the rail, the keys and the palette', () => {
  const surface = () => ({
    view: useNavigationStore.getState().activeView,
    learn: useLearnStore.getState().isLearnMode,
    challenge: useChallengeModeStore.getState().isChallengeMode,
  });
  const VIEWS = ['files', 'learning', 'challenges', 'search', 'settings', 'qec', 'transpiler', 'experiments'] as const;

  it.each(VIEWS)('%s: toggle:false (keys, palette) lands on the same surface as the first rail click', (view) => {
    useNavigationStore.setState({ activeView: null });
    useNavigationStore.getState().selectView(view, { toggle: true });
    const rail = surface();
    useNavigationStore.setState({ activeView: null, autoCollapsedView: null });
    useLearnStore.setState({ isLearnMode: false });
    useChallengeModeStore.setState({ isChallengeMode: false });
    useNavigationStore.getState().selectView(view, { toggle: false });
    expect(surface()).toEqual(rail);
  });

  it('learning enters Learn mode with no sidebar view, and leaves Challenge mode', () => {
    useChallengeModeStore.setState({ isChallengeMode: true });
    useNavigationStore.getState().selectView('learning', { toggle: false });
    expect(surface()).toEqual({ view: null, learn: true, challenge: false });
  });

  it('challenges enters Challenge mode with no sidebar view, and leaves Learn mode', () => {
    useLearnStore.setState({ isLearnMode: true });
    useNavigationStore.getState().selectView('challenges', { toggle: false });
    expect(surface()).toEqual({ view: null, learn: false, challenge: true });
  });

  it('the rail toggles a takeover off; the keys keep it open', () => {
    useNavigationStore.getState().selectView('learning', { toggle: true });
    useNavigationStore.getState().selectView('learning', { toggle: true });
    expect(surface().learn).toBe(false);
    useNavigationStore.getState().selectView('learning', { toggle: false });
    useNavigationStore.getState().selectView('learning', { toggle: false });
    expect(surface().learn).toBe(true);
  });

  it('a plain view toggles on the rail and only selects from the keys', () => {
    useNavigationStore.getState().selectView('files', { toggle: true });
    expect(surface().view).toBeNull();
    useNavigationStore.getState().selectView('files', { toggle: false });
    useNavigationStore.getState().selectView('files', { toggle: false });
    expect(surface().view).toBe('files');
  });
});
