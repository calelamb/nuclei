import { describe, it, expect, beforeEach } from 'vitest';
import { applyOnboardingPath } from './applyOnboardingPath';
import { useUIModeStore } from '../../stores/uiModeStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

beforeEach(() => {
  useUIModeStore.setState({ mode: 'intermediate' });
  useWorkspaceStore.setState({ mode: 'research' });
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
});
