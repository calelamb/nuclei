// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { handleKernelMessage } from './kernelMessageHandler';
import { useSimulationStore } from '../stores/simulationStore';
import { useCircuitStore } from '../stores/circuitStore';
import { setHardwareBackendsSender } from '../lib/hardwareBackendsSender';
import { vi } from 'vitest';

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

  it('treats a timed-out live preview as a paused preview, not an error: nothing in the Terminal, no circuit error', () => {
    useCircuitStore.setState({ error: null, previewPaused: false });
    handleKernelMessage(
      { type: 'error', message: 'Your code ran for more than 5 seconds and was stopped. Python is restarting.', phase: 'parse', code: 'timeout' },
      {},
    );
    expect(useSimulationStore.getState().terminalOutput).toEqual([]);
    expect(useSimulationStore.getState().lastRunFailed).toBe(false);
    expect(useCircuitStore.getState().previewPaused).toBe(true);
    expect(useCircuitStore.getState().error).toBeNull();
  });

  it('clears the paused state when the next preview parses', () => {
    useCircuitStore.setState({ previewPaused: true });
    handleKernelMessage({ type: 'snapshot', data: { framework: 'qiskit', qubit_count: 1, classical_bit_count: 0, depth: 1, gates: [] } as never }, {});
    expect(useCircuitStore.getState().previewPaused).toBe(false);
  });

  it('still reports an ordinary parse error as an error', () => {
    useCircuitStore.setState({ error: null, previewPaused: false });
    handleKernelMessage({ type: 'error', message: 'invalid syntax', phase: 'parse', code: 'execution_error' }, {});
    expect(useCircuitStore.getState().error).toBe('invalid syntax');
    expect(useCircuitStore.getState().previewPaused).toBe(false);
  });
});

describe('handleKernelMessage — backend discovery', () => {
  it('asks the kernel for backends once when a provider connects, and not when a connect fails', () => {
    const sender = vi.fn();
    setHardwareBackendsSender(sender);
    handleKernelMessage({ type: 'hardware_connected', provider: 'ibm', success: false } as never, {});
    expect(sender).not.toHaveBeenCalled();
    handleKernelMessage({ type: 'hardware_connected', provider: 'ibm', success: true } as never, {});
    expect(sender).toHaveBeenCalledTimes(1);
    setHardwareBackendsSender(null);
  });

  it('asks once after the kernel reports already-connected providers, never for an empty list', () => {
    const sender = vi.fn();
    setHardwareBackendsSender(sender);
    handleKernelMessage({ type: 'hardware_connected_providers', providers: [] } as never, {});
    expect(sender).not.toHaveBeenCalled();
    handleKernelMessage({ type: 'hardware_connected_providers', providers: ['ibm', 'ionq'] } as never, {});
    expect(sender).toHaveBeenCalledTimes(1);
    setHardwareBackendsSender(null);
  });
});
