import { describe, it, expect, beforeEach } from 'vitest';
import { useMissingDependencyStore } from './missingDependencyStore';

describe('missingDependencyStore', () => {
  beforeEach(() => useMissingDependencyStore.getState().dismiss());

  it('starts empty', () => {
    const s = useMissingDependencyStore.getState();
    expect(s.dependency).toBeNull();
    expect(s.framework).toBeNull();
  });

  it('reports a missing dependency and clears on dismiss', () => {
    useMissingDependencyStore.getState().report('qiskit', 'qiskit');
    expect(useMissingDependencyStore.getState().dependency).toBe('qiskit');
    expect(useMissingDependencyStore.getState().framework).toBe('qiskit');

    useMissingDependencyStore.getState().dismiss();
    expect(useMissingDependencyStore.getState().dependency).toBeNull();
  });

  it('accepts a null framework attribution', () => {
    useMissingDependencyStore.getState().report('stim', null);
    expect(useMissingDependencyStore.getState().dependency).toBe('stim');
    expect(useMissingDependencyStore.getState().framework).toBeNull();
  });
});
