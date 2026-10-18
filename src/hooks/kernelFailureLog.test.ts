// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { logKernelFailureOnce } from './kernelFailureLog';
import { useSimulationStore } from '../stores/simulationStore';

const lines = () => useSimulationStore.getState().terminalOutput.map((l) => l.text);

describe('logKernelFailureOnce', () => {
  beforeEach(() => useSimulationStore.setState({ terminalOutput: [] }));

  it('writes the failure once even when two connect generations report it', () => {
    logKernelFailureOnce('The kernel did not respond after 15 attempts.');
    logKernelFailureOnce('The kernel did not respond after 15 attempts.');
    expect(lines()).toEqual(['Error: The kernel did not respond after 15 attempts.']);
  });

  it('reports the same failure again after something else was written (a Retry that worked, then failed later)', () => {
    logKernelFailureOnce('boom');
    useSimulationStore.getState().addOutput('Python ready', 'info');
    logKernelFailureOnce('boom');
    expect(lines()).toEqual(['Error: boom', 'Python ready', 'Error: boom']);
  });

  it('reports a different failure', () => {
    logKernelFailureOnce('a');
    logKernelFailureOnce('b');
    expect(lines()).toEqual(['Error: a', 'Error: b']);
  });
});
