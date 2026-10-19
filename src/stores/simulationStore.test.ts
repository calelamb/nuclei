import { describe, it, expect, beforeEach } from 'vitest';
import { hasMeaningfulOutput, isResultStale, useSimulationStore } from './simulationStore';

describe('simulationStore.addOutput', () => {
  beforeEach(() => {
    useSimulationStore.getState().clearOutput();
  });

  it('splits multi-line stdout into separate entries', () => {
    useSimulationStore.getState().addOutput('line 1\nline 2\nline 3', 'stdout');
    const lines = useSimulationStore.getState().terminalOutput;
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.text)).toEqual(['line 1', 'line 2', 'line 3']);
    for (const line of lines) expect(line.type).toBe('stdout');
  });

  it('drops the trailing empty line from print() output', () => {
    // Python's print() ends with '\n' by default — the naive split would
    // produce a phantom empty line after every printed line.
    useSimulationStore.getState().addOutput('hello world\n', 'stdout');
    const lines = useSimulationStore.getState().terminalOutput;
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('hello world');
  });

  it('strips ANSI color escape codes', () => {
    useSimulationStore.getState().addOutput('\x1b[31mred text\x1b[0m plain', 'stderr');
    const lines = useSimulationStore.getState().terminalOutput;
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('red text plain');
    expect(lines[0].type).toBe('stderr');
  });

  it('preserves intermediate empty lines', () => {
    useSimulationStore.getState().addOutput('first\n\nthird', 'stdout');
    const lines = useSimulationStore.getState().terminalOutput;
    expect(lines.map((l) => l.text)).toEqual(['first', '', 'third']);
  });

  it('preserves separator lines verbatim (no splitting, no ANSI strip)', () => {
    const separatorText = '─── Run at 10:42:15 PM ─────';
    useSimulationStore.getState().addOutput(separatorText, 'separator');
    const lines = useSimulationStore.getState().terminalOutput;
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe(separatorText);
    expect(lines[0].type).toBe('separator');
  });

  it('tags info messages so the UI can style them distinctly', () => {
    useSimulationStore.getState().addOutput('Kernel is still loading.', 'info');
    expect(useSimulationStore.getState().terminalOutput[0].type).toBe('info');
  });

  it('caps the buffer at 2000 lines across many appends', () => {
    // Add 600 lines one at a time, then 10 in a batch.
    for (let i = 0; i < 2100; i++) {
      useSimulationStore.getState().addOutput(`line-${i}`, 'stdout');
    }
    const batch = Array.from({ length: 10 }, (_, i) => `batch-${i}`).join('\n');
    useSimulationStore.getState().addOutput(batch, 'stdout');

    const lines = useSimulationStore.getState().terminalOutput;
    expect(lines).toHaveLength(2000);
    // Oldest should be dropped, newest kept.
    expect(lines[lines.length - 1].text).toBe('batch-9');
  });

  it('defaults the type to stdout when none is provided', () => {
    useSimulationStore.getState().addOutput('implicit');
    expect(useSimulationStore.getState().terminalOutput[0].type).toBe('stdout');
  });

  it('stores a timestamp on every line', () => {
    const before = Date.now();
    useSimulationStore.getState().addOutput('with time', 'stdout');
    const after = Date.now();
    const line = useSimulationStore.getState().terminalOutput[0];
    expect(line.timestamp).toBeGreaterThanOrEqual(before);
    expect(line.timestamp).toBeLessThanOrEqual(after);
  });
});

describe('simulationStore result provenance', () => {
  beforeEach(() => {
    useSimulationStore.getState().clearResult();
  });
  const result = { probabilities: { '00': 1 }, bloch_coords: [] } as never;

  it('remembers which code produced the result', () => {
    useSimulationStore.getState().beginRun('qc.h(0)');
    useSimulationStore.getState().setResult(result);
    expect(useSimulationStore.getState().resultCode).toBe('qc.h(0)');
  });

  it('clears the provenance with the result so the next run starts clean', () => {
    useSimulationStore.getState().beginRun('a');
    useSimulationStore.getState().setResult(result);
    useSimulationStore.getState().clearResult();
    expect(useSimulationStore.getState().resultCode).toBeNull();
  });

  it('reports a result stale only when its code differs from the current buffer', () => {
    expect(isResultStale('a', 'a')).toBe(false);
    expect(isResultStale('a', 'a\nqc.x(1)')).toBe(true);
    expect(isResultStale(null, 'anything')).toBe(false);
    expect(isResultStale('a', 'b', false)).toBe(false);
  });

  it('does not count run separators as terminal output', () => {
    const line = (type: 'separator' | 'stdout') => ({ text: 'x', type, timestamp: 0 });
    expect(hasMeaningfulOutput([line('separator'), line('separator')])).toBe(false);
    expect(hasMeaningfulOutput([line('separator'), line('stdout')])).toBe(true);
  });

  it('does not count a lone background info notice (research-r-16)', () => {
    const info = { text: 'Installing Cirq…', type: 'info' as const, timestamp: 0 };
    expect(hasMeaningfulOutput([info])).toBe(false);
    expect(hasMeaningfulOutput([info, { text: 'boom', type: 'stderr' as const, timestamp: 0 }])).toBe(true);
  });
});
