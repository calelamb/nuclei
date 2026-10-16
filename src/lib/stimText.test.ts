import { describe, it, expect } from 'vitest';
import { isStimCircuitText } from './stimText';

describe('isStimCircuitText', () => {
  it('accepts .stim files and untitled stim-looking text', () => {
    expect(isStimCircuitText('H 0\nM 0\n', 'a/b.stim')).toBe(true);
    expect(isStimCircuitText('H 0\nM 0\n', null)).toBe(true);
  });
  it('rejects python files and python-looking buffers', () => {
    expect(isStimCircuitText('H 0\n', 'x.py')).toBe(false);
    expect(isStimCircuitText('import stim\nc = stim.Circuit()\n', null)).toBe(false);
  });
  it('rejects empty text', () => {
    expect(isStimCircuitText('  \n', 'x.stim')).toBe(false);
  });

  it('only accepts .stim or extension-less buffers (allow-list)', () => {
    expect(isStimCircuitText('H 0\n', 'circuit')).toBe(true);
    expect(isStimCircuitText('H 0\n', 'a/b/CIRCUIT.STIM')).toBe(true);
    expect(isStimCircuitText('H 0\n', 'a.b/circuit')).toBe(true);
    for (const f of ['x.qasm', 'x.qs', 'x.py', 'x.txt', 'x.json', 'x.dem']) {
      expect(isStimCircuitText('H 0\nM 0\n', f)).toBe(false);
    }
  });
});
