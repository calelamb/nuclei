import { describe, it, expect, beforeEach } from 'vitest';
import { useSimulationStore } from './simulationStore';

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

  it('caps the buffer at 500 lines across many appends', () => {
    // Add 600 lines one at a time, then 10 in a batch.
    for (let i = 0; i < 600; i++) {
      useSimulationStore.getState().addOutput(`line-${i}`, 'stdout');
    }
    const batch = Array.from({ length: 10 }, (_, i) => `batch-${i}`).join('\n');
    useSimulationStore.getState().addOutput(batch, 'stdout');

    const lines = useSimulationStore.getState().terminalOutput;
    expect(lines).toHaveLength(500);
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
