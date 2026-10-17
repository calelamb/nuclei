// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { handleKernelMessage } from './kernelMessageHandler';
import { useSimulationStore } from '../stores/simulationStore';

describe('handleKernelMessage — run failure tracking', () => {
  beforeEach(() => {
    useSimulationStore.setState({ result: null, isRunning: true, lastRunFailed: false, terminalOutput: [] });
  });

  it('flags the last run as failed on an execute error and clears it when a new run starts', () => {
    handleKernelMessage(
      { type: 'error', message: 'boom', phase: 'execute', code: 'execution_error' },
      {},
    );
    expect(useSimulationStore.getState().lastRunFailed).toBe(true);
    expect(useSimulationStore.getState().isRunning).toBe(false);

    useSimulationStore.getState().setRunning(true);
    expect(useSimulationStore.getState().lastRunFailed).toBe(false);
  });

  it('does not flag a live-preview parse error as a failed run', () => {
    handleKernelMessage(
      { type: 'error', message: 'half-typed', phase: 'parse', code: 'execution_error' },
      {},
    );
    expect(useSimulationStore.getState().lastRunFailed).toBe(false);
    expect(useSimulationStore.getState().terminalOutput).toEqual([]);
  });

  it('tells the user in the Terminal when a live preview was stopped for running too long', () => {
    handleKernelMessage(
      { type: 'error', message: 'Your code ran for more than 5 seconds and was stopped. Python is restarting.', phase: 'parse', code: 'timeout' },
      {},
    );
    const lines = useSimulationStore.getState().terminalOutput;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'info' });
    expect(lines[0].text).toContain('stopped');
    expect(useSimulationStore.getState().lastRunFailed).toBe(false);
  });
});
