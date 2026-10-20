// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModeSwitchStore } from './modeSwitchStore';
import { useWorkspaceStore } from './workspaceStore';
import { useExperimentRunStore } from './experimentRunStore';

beforeEach(() => {
  vi.useFakeTimers();
  useWorkspaceStore.setState({ mode: 'learn' });
  useExperimentRunStore.setState({ active: null });
  useModeSwitchStore.setState({ pending: null, announcement: '' });
});
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('focus across a workspace switch', () => {
  it('lands on the mode chip when the focused control unmounts with the switch', () => {
    document.body.innerHTML = '<button id="level" aria-label="Level: Intermediate">Level</button><button data-focus-id="mode-chip">LEARN</button>';
    const level = document.getElementById('level') as HTMLElement;
    level.focus();
    useModeSwitchStore.getState().requestSwitch('research');
    level.remove(); // Research has no Level chip
    vi.advanceTimersByTime(100);
    expect(document.activeElement?.getAttribute('data-focus-id')).toBe('mode-chip');
  });

  it('leaves focus alone when the focused control survives the switch', () => {
    document.body.innerHTML = '<button id="keep">k</button><button data-focus-id="mode-chip">LEARN</button>';
    const keep = document.getElementById('keep') as HTMLElement;
    keep.focus();
    useModeSwitchStore.getState().requestSwitch('research');
    vi.advanceTimersByTime(100);
    expect(document.activeElement).toBe(keep);
  });
});
