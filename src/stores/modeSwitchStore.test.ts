import { describe, it, expect, beforeEach } from 'vitest';
import { useModeSwitchStore } from './modeSwitchStore';
import { useWorkspaceStore } from './workspaceStore';
import { useExperimentRunStore } from './experimentRunStore';

const activeRun = {
  experimentName: 'theta-sweep',
  experimentFileName: 'theta-sweep.experiment.yaml',
  cancel: () => {},
  progress: { completed: 2, total: 8, failures: 0, currentPoint: 2 },
};

describe('modeSwitchStore (PRD 11 Phase B)', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ mode: 'learn' });
    useExperimentRunStore.setState({ active: null });
    useModeSwitchStore.setState({ pending: null, announcement: '' });
  });

  it('switches immediately and announces when nothing is running', () => {
    useModeSwitchStore.getState().requestSwitch('research');
    expect(useWorkspaceStore.getState().mode).toBe('research');
    expect(useModeSwitchStore.getState().pending).toBeNull();
    expect(useModeSwitchStore.getState().announcement).toBe('Switched to Research mode');
  });

  it('switching to the current mode is a no-op', () => {
    useModeSwitchStore.getState().requestSwitch('learn');
    expect(useModeSwitchStore.getState().pending).toBeNull();
    expect(useWorkspaceStore.getState().mode).toBe('learn');
    expect(useModeSwitchStore.getState().announcement).toBe('');
  });

  it('stages a confirm (and does NOT switch) when a run is active', () => {
    useExperimentRunStore.setState({ active: activeRun });
    useModeSwitchStore.getState().requestSwitch('research');
    // Not switched yet — the job keeps running, we ask first.
    expect(useWorkspaceStore.getState().mode).toBe('learn');
    expect(useModeSwitchStore.getState().pending).toEqual({
      target: 'research',
      runningName: 'theta-sweep',
    });
  });

  it('confirmPending applies the staged switch and announces', () => {
    useExperimentRunStore.setState({ active: activeRun });
    useModeSwitchStore.getState().requestSwitch('research');
    useModeSwitchStore.getState().confirmPending();
    expect(useWorkspaceStore.getState().mode).toBe('research');
    expect(useModeSwitchStore.getState().pending).toBeNull();
    expect(useModeSwitchStore.getState().announcement).toBe('Switched to Research mode');
  });

  it('cancelPending discards the switch — the run and mode are untouched', () => {
    useExperimentRunStore.setState({ active: activeRun });
    useModeSwitchStore.getState().requestSwitch('research');
    useModeSwitchStore.getState().cancelPending();
    expect(useModeSwitchStore.getState().pending).toBeNull();
    expect(useWorkspaceStore.getState().mode).toBe('learn');
    // The active run is never touched by a mode switch (visibility != lifecycle).
    expect(useExperimentRunStore.getState().active).toBe(activeRun);
  });

  it('requestToggle flips the current mode through the same guard', () => {
    useModeSwitchStore.getState().requestToggle();
    expect(useWorkspaceStore.getState().mode).toBe('research');
    useModeSwitchStore.getState().requestToggle();
    expect(useWorkspaceStore.getState().mode).toBe('learn');
  });

  it('requestToggle stages a confirm when a run is active', () => {
    useExperimentRunStore.setState({ active: activeRun });
    useModeSwitchStore.getState().requestToggle();
    expect(useModeSwitchStore.getState().pending?.target).toBe('research');
    expect(useWorkspaceStore.getState().mode).toBe('learn');
  });
});
