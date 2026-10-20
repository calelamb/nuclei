import { describe, it, expect, beforeEach } from 'vitest';
import '../test/learnGateOn';
import { useModeSwitchStore } from './modeSwitchStore';
import { useWorkspaceStore } from './workspaceStore';
import { useExperimentRunStore } from './experimentRunStore';
import { useLabActivityStore } from './labActivityStore';
import { useTrainabilityStore } from './trainabilityStore';
import { useConjectureStore } from './conjectureStore';
import { emptyRunConjectures, type TestJob } from '../services/conjecture/state';
import { jobFixture } from '../services/trainability/fixtures';

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
    useLabActivityStore.setState({ discovery: null });
    useTrainabilityStore.getState().reset();
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

  describe('Quantum AI Lab work (PRD 14 §3.3)', () => {
    const discovery = (status: 'running' | 'paused') => ({ runId: 'r1', name: 'w-state', status, evaluations: 4, maxEvaluations: 50 });

    beforeEach(() => {
      useWorkspaceStore.setState({ mode: 'research' });
    });

    it('stages a confirm that names a running discovery when leaving Research', () => {
      useLabActivityStore.setState({ discovery: discovery('running') });
      useModeSwitchStore.getState().requestSwitch('learn');
      expect(useWorkspaceStore.getState().mode).toBe('research');
      expect(useModeSwitchStore.getState().pending).toEqual({
        target: 'learn',
        runningName: 'Discovery run w-state',
        panelName: 'Discovery Engine',
      });
    });

    it('does not guard a paused discovery run', () => {
      useLabActivityStore.setState({ discovery: discovery('paused') });
      useModeSwitchStore.getState().requestSwitch('learn');
      expect(useWorkspaceStore.getState().mode).toBe('learn');
    });

    it('stages a confirm for an active trainability job and applies it on confirm', () => {
      const job = jobFixture({ status: 'running' });
      useTrainabilityStore.setState({ jobs: { [job.id]: job }, jobOrder: [job.id], activeJobId: job.id });
      useModeSwitchStore.getState().requestSwitch('learn');
      expect(useModeSwitchStore.getState().pending).toEqual({
        target: 'learn',
        runningName: 'Trainability analysis of hardware_efficient.py',
        panelName: 'Trainability Lab',
      });
      useModeSwitchStore.getState().confirmPending();
      expect(useWorkspaceStore.getState().mode).toBe('learn');
    });

    it('stages a confirm for a running conjecture test', () => {
      useConjectureStore.setState({
        byRun: { r: { ...emptyRunConjectures(), jobs: { j: { jobId: 'j', conjectureId: 'cj-1', status: 'running' } as TestJob } } },
      });
      useModeSwitchStore.getState().requestSwitch('learn');
      expect(useModeSwitchStore.getState().pending).toEqual({
        target: 'learn',
        runningName: 'Conjecture test',
        panelName: 'Discovery Engine',
      });
    });

    it('a finished conjecture test does not block the switch', () => {
      useConjectureStore.setState({
        byRun: { r: { ...emptyRunConjectures(), jobs: { j: { jobId: 'j', conjectureId: 'cj-1', status: 'complete' } as TestJob } } },
      });
      useModeSwitchStore.getState().requestSwitch('learn');
      expect(useWorkspaceStore.getState().mode).toBe('learn');
    });

    it('a finished trainability job does not block the switch', () => {
      const job = jobFixture({ status: 'complete' });
      useTrainabilityStore.setState({ jobs: { [job.id]: job }, jobOrder: [job.id], activeJobId: null });
      useModeSwitchStore.getState().requestSwitch('learn');
      expect(useWorkspaceStore.getState().mode).toBe('learn');
    });

    it('entering Research is never guarded by Lab work', () => {
      useWorkspaceStore.setState({ mode: 'learn' });
      useLabActivityStore.setState({ discovery: discovery('running') });
      useModeSwitchStore.getState().requestSwitch('research');
      expect(useWorkspaceStore.getState().mode).toBe('research');
    });

    it('a sweep still takes precedence in the copy', () => {
      useExperimentRunStore.setState({ active: activeRun });
      useLabActivityStore.setState({ discovery: discovery('running') });
      useModeSwitchStore.getState().requestSwitch('learn');
      expect(useModeSwitchStore.getState().pending?.runningName).toBe('theta-sweep');
    });
  });
});
