import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../test/learnGateOn';
import { applyOnboardingPath } from './applyOnboardingPath';
import { useUIModeStore } from '../../stores/uiModeStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useLearnStore } from '../../stores/learnStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { TRACKS } from '../../data/lessons/tracks';
import { useLearnGateStore } from '../../stores/learnGateStore';

const web = vi.hoisted(() => ({ value: false }));
vi.mock('../../platform/buildTarget', () => ({ isWebBuild: () => web.value }));

beforeEach(() => {
  web.value = false;
  useUIModeStore.setState({ mode: 'intermediate' });
  useWorkspaceStore.setState({ mode: 'research' });
  useLearnStore.setState({ isLearnMode: false, currentTrackId: null, currentLessonId: null });
  useNavigationStore.setState({ activeView: 'files' });
});

describe('applyOnboardingPath', () => {
  it('lands every Learn path in the Learn workspace', () => {
    for (const path of ['beginner', 'intermediate', 'experienced'] as const) {
      useWorkspaceStore.setState({ mode: 'research' });
      applyOnboardingPath(path);
      expect(useWorkspaceStore.getState().mode).toBe('learn');
    }
  });

  it('maps the Learn level to a UI mode', () => {
    applyOnboardingPath('beginner');
    expect(useUIModeStore.getState().mode).toBe('beginner');
    applyOnboardingPath('intermediate');
    expect(useUIModeStore.getState().mode).toBe('intermediate');
    applyOnboardingPath('experienced');
    expect(useUIModeStore.getState().mode).toBe('advanced');
  });

  it('research selects the Research workspace and leaves the UI mode alone', () => {
    useWorkspaceStore.setState({ mode: 'learn' });
    useUIModeStore.setState({ mode: 'beginner' });
    applyOnboardingPath('research');
    expect(useWorkspaceStore.getState().mode).toBe('research');
    expect(useUIModeStore.getState().mode).toBe('beginner');
  });

  it('a returning user continuing (no path) changes nothing', () => {
    useUIModeStore.setState({ mode: 'beginner' });
    applyOnboardingPath(undefined);
    expect(useUIModeStore.getState().mode).toBe('beginner');
    expect(useWorkspaceStore.getState().mode).toBe('research');
  });

  describe('every Learn path ends somewhere with content', () => {
    it('brand new lands on lesson 1 of the fundamentals track in Learn mode, with no empty sidebar', () => {
      applyOnboardingPath('beginner');
      const learn = useLearnStore.getState();
      const first = TRACKS.find((t) => t.id === 'track-1')!.lessons[0];
      expect(learn.isLearnMode).toBe(true);
      expect(learn.currentTrackId).toBe('track-1');
      expect(learn.currentLessonId).toBe(first.id);
      expect(useNavigationStore.getState().activeView).toBeNull();
    });

    it('some-quantum opens the track chooser (Learn mode, no lesson selected)', () => {
      useLearnStore.setState({ currentTrackId: 'track-2', currentLessonId: 'x' });
      applyOnboardingPath('intermediate');
      const learn = useLearnStore.getState();
      expect(learn.isLearnMode).toBe(true);
      expect(learn.currentLessonId).toBeNull();
    });

    it('experienced on the web build skips the desktop-only Explorer notice', () => {
      web.value = true;
      applyOnboardingPath('experienced');
      expect(useNavigationStore.getState().activeView).toBeNull();
      expect(useLearnStore.getState().isLearnMode).toBe(false);
    });

    it('experienced on desktop keeps the Explorer open in the editor', () => {
      applyOnboardingPath('experienced');
      expect(useNavigationStore.getState().activeView).toBe('files');
    });

    it('research does not enter Learn mode', () => {
      applyOnboardingPath('research');
      expect(useLearnStore.getState().isLearnMode).toBe(false);
    });
  });
});

describe('applyOnboardingPath with the Learn workspace gated off', () => {
  beforeEach(() => useLearnGateStore.getState().setLearnEnabled(false));
  afterEach(() => useLearnGateStore.getState().setLearnEnabled(true));

  it('turns every Learn path into Research and never enters Learn', () => {
    for (const path of ['beginner', 'intermediate', 'experienced'] as const) {
      applyOnboardingPath(path);
      expect(useWorkspaceStore.getState().mode).toBe('research');
      expect(useLearnStore.getState().isLearnMode).toBe(false);
    }
  });

  it('leaves the UI level alone', () => {
    applyOnboardingPath('beginner');
    expect(useUIModeStore.getState().mode).toBe('intermediate');
  });
});
