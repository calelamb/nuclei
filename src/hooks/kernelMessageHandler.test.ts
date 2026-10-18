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

describe('handleKernelMessage — a run that finished without a circuit', () => {
  const noCircuit = { type: 'error', message: 'No circuit found.', phase: 'execute', code: 'no_circuit' } as const;

  beforeEach(() => {
    useSimulationStore.setState({ result: null, isRunning: true, lastRunFailed: false, lastRunNoCircuit: false, terminalOutput: [] });
    useCircuitStore.getState().clear();
  });

  it('is a clean finish: not a failed run, no error line, one calm note in the Terminal', () => {
    handleKernelMessage({ ...noCircuit }, {});
    const sim = useSimulationStore.getState();
    expect(sim.lastRunFailed).toBe(false);
    expect(sim.lastRunNoCircuit).toBe(true);
    expect(sim.isRunning).toBe(false);
    expect(sim.terminalOutput.some((l) => l.type === 'stderr' || l.text.startsWith('Error'))).toBe(false);
    expect(sim.terminalOutput.map((l) => l.text)).toContain('Ran as plain Python. No circuit to simulate.');
  });

  it('drops the previous diagram instead of calling it out of date, and sets no circuit error', () => {
    handleKernelMessage({ type: 'snapshot', data: { framework: 'qiskit', qubit_count: 2, classical_bit_count: 0, depth: 3, gates: [{ type: 'H', targets: [0], controls: [], params: [], layer: 0 }] } as never }, {});
    handleKernelMessage({ type: 'snapshot', data: null }, {});
    handleKernelMessage({ ...noCircuit }, {});
    const circuit = useCircuitStore.getState();
    expect(circuit.snapshot).toBeNull();
    expect(circuit.lastGood).toBeNull();
    expect(circuit.error).toBeNull();
  });

  it('drops a latched diagram when a parse finds no circuit and no error, but keeps it for a real error', () => {
    vi.useFakeTimers();
    try {
      const snap = { framework: 'qiskit', qubit_count: 1, classical_bit_count: 0, depth: 1, gates: [{ type: 'H', targets: [0], controls: [], params: [], layer: 0 }] } as never;
      handleKernelMessage({ type: 'snapshot', data: snap }, {});
      handleKernelMessage({ type: 'snapshot', data: null }, {});
      handleKernelMessage({ type: 'error', message: 'invalid syntax', phase: 'parse', code: 'execution_error' }, {});
      vi.advanceTimersByTime(500);
      expect(useCircuitStore.getState().lastGood).not.toBeNull();

      handleKernelMessage({ type: 'snapshot', data: null }, {});
      vi.advanceTimersByTime(500);
      expect(useCircuitStore.getState().lastGood).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgets the note when the next run starts', () => {
    handleKernelMessage({ ...noCircuit }, {});
    useSimulationStore.getState().setRunning(true);
    expect(useSimulationStore.getState().lastRunNoCircuit).toBe(false);
  });

  it('still reports a genuine execute error as a failure', () => {
    handleKernelMessage({ type: 'error', message: 'boom', phase: 'execute', code: 'execution_error' }, {});
    expect(useSimulationStore.getState().lastRunFailed).toBe(true);
    expect(useSimulationStore.getState().lastRunNoCircuit).toBe(false);
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

describe('handleKernelMessage — plain-Python note ends when a circuit comes back', () => {
  it('clears lastRunNoCircuit once a snapshot with gates arrives', () => {
    useSimulationStore.setState({ lastRunNoCircuit: true });
    handleKernelMessage({ type: 'snapshot', data: { framework: 'qiskit', qubit_count: 2, classical_bit_count: 0, depth: 1, gates: [{ type: 'H', targets: [0], controls: [], params: [], layer: 0 }] } as never }, {});
    expect(useSimulationStore.getState().lastRunNoCircuit).toBe(false);
  });

  it('keeps it while the snapshot is empty', () => {
    useSimulationStore.setState({ lastRunNoCircuit: true });
    handleKernelMessage({ type: 'snapshot', data: null }, {});
    expect(useSimulationStore.getState().lastRunNoCircuit).toBe(true);
  });
});
