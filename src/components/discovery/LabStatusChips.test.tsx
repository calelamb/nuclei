// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LabStatusChips } from './LabStatusChips';
import { useLabActivityStore } from '../../stores/labActivityStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useTrainabilityStore } from '../../stores/trainabilityStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { jobFixture } from '../../services/trainability/fixtures';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { FIXTURE_RUN_ID, fixtureRun } from '../../services/discovery/fixtures';
import { createRunView } from '../../services/discovery/runView';

beforeEach(() => {
  useLabActivityStore.setState({ discovery: null });
  useTrainabilityStore.getState().reset();
  useDiscoveryStore.getState().reset();
  useWorkspaceStore.setState({ mode: 'research' });
  useNavigationStore.setState({ activeView: 'files' });
});
afterEach(() => cleanup());

describe('LabStatusChips', () => {
  it('renders nothing when no Lab work is active', () => {
    const { container } = render(<LabStatusChips />);
    expect(container.textContent).toBe('');
  });

  it('shows a discovery chip with progress and jumps to the Discovery Engine', () => {
    useLabActivityStore.setState({ discovery: { runId: 'r', name: 'w-state', status: 'running', evaluations: 12, maxEvaluations: 60 } });
    render(<LabStatusChips />);
    const chip = screen.getByRole('button', { name: /Discovery Engine: w-state is running/ });
    expect(chip.textContent).toContain('w-state');
    expect(chip.textContent).toContain('12/60 evals');
    fireEvent.click(chip);
    expect(useNavigationStore.getState().activeView).toBe('discovery');
  });

  it('labels a paused discovery run', () => {
    useLabActivityStore.setState({ discovery: { runId: 'r', name: 'w-state', status: 'paused', evaluations: 12, maxEvaluations: 60 } });
    render(<LabStatusChips />);
    expect(screen.getByRole('button', { name: /is paused/ }).textContent).toContain('paused');
  });

  it('shows a trainability chip only while a job is active', () => {
    const job = jobFixture({ status: 'running' });
    useTrainabilityStore.setState({ jobs: { [job.id]: job }, jobOrder: [job.id], activeJobId: job.id });
    render(<LabStatusChips />);
    const chip = screen.getByRole('button', { name: /Trainability Lab: analyzing hardware_efficient\.py/ });
    fireEvent.click(chip);
    expect(useNavigationStore.getState().activeView).toBe('trainability');
    act(() => useTrainabilityStore.setState({ jobs: { [job.id]: { ...job, status: 'complete' } }, activeJobId: null }));
    expect(screen.queryByRole('button', { name: /Trainability Lab/ })).toBeNull();
  });

  it('opens Research mode first when clicked from Learn', () => {
    useWorkspaceStore.setState({ mode: 'learn' });
    useLabActivityStore.setState({ discovery: { runId: 'r', name: 'x', status: 'running', evaluations: 1, maxEvaluations: 5 } });
    render(<LabStatusChips />);
    fireEvent.click(screen.getByRole('button', { name: /Discovery Engine/ }));
    expect(useWorkspaceStore.getState().mode).toBe('research');
  });

  it('the discovery store mirrors a live run into the activity store and clears it', () => {
    const run = fixtureRun({ status: 'running' });
    useDiscoveryStore.setState({ liveRunIds: [FIXTURE_RUN_ID], views: { [FIXTURE_RUN_ID]: createRunView(run, []) } });
    expect(useLabActivityStore.getState().discovery).toMatchObject({ name: 'w-state-synthesis', status: 'running', evaluations: 9, maxEvaluations: 60 });
    useDiscoveryStore.setState({ liveRunIds: [] });
    expect(useLabActivityStore.getState().discovery).toBeNull();
  });
});
