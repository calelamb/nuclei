import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExperimentRunStore } from './experimentRunStore';

describe('experimentRunStore', () => {
  beforeEach(() => {
    useExperimentRunStore.setState({ active: null, lastSummary: null, lastError: null });
  });

  it('starts a run with idle progress and clears prior summary/error', () => {
    useExperimentRunStore.setState({ lastSummary: { total: 1, completed: 1, failed: 0, cancelled: false, failures: [], runDirs: ['x'] }, lastError: 'old error' });
    const cancel = vi.fn();
    useExperimentRunStore.getState().start({ experimentFileName: 'a.experiment.yaml', experimentName: 'a', cancel });

    const state = useExperimentRunStore.getState();
    expect(state.active).toEqual({
      experimentFileName: 'a.experiment.yaml',
      experimentName: 'a',
      cancel,
      progress: { completed: 0, total: 0, failures: 0, currentPoint: -1 },
    });
    expect(state.lastSummary).toBeNull();
    expect(state.lastError).toBeNull();
  });

  it('updates progress on the active run only', () => {
    useExperimentRunStore.getState().start({ experimentFileName: 'a.experiment.yaml', experimentName: 'a', cancel: vi.fn() });
    useExperimentRunStore.getState().updateProgress({ completed: 2, total: 5, failures: 1, currentPoint: 1 });
    expect(useExperimentRunStore.getState().active?.progress).toEqual({ completed: 2, total: 5, failures: 1, currentPoint: 1 });
  });

  it('is a no-op to update progress with no active run', () => {
    useExperimentRunStore.getState().updateProgress({ completed: 1, total: 1, failures: 0, currentPoint: 0 });
    expect(useExperimentRunStore.getState().active).toBeNull();
  });

  it('finish clears active and stores the summary or error', () => {
    useExperimentRunStore.getState().start({ experimentFileName: 'a.experiment.yaml', experimentName: 'a', cancel: vi.fn() });
    const summary = { total: 3, completed: 3, failed: 0, cancelled: false, failures: [], runDirs: ['a', 'b', 'c'] };
    useExperimentRunStore.getState().finish(summary);
    expect(useExperimentRunStore.getState().active).toBeNull();
    expect(useExperimentRunStore.getState().lastSummary).toEqual(summary);
    expect(useExperimentRunStore.getState().lastError).toBeNull();
  });

  it('finish records an error when the sweep threw', () => {
    useExperimentRunStore.getState().start({ experimentFileName: 'a.experiment.yaml', experimentName: 'a', cancel: vi.fn() });
    useExperimentRunStore.getState().finish(null, 'kernel session failed');
    expect(useExperimentRunStore.getState().active).toBeNull();
    expect(useExperimentRunStore.getState().lastSummary).toBeNull();
    expect(useExperimentRunStore.getState().lastError).toBe('kernel session failed');
  });
});
