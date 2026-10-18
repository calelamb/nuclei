import { describe, expect, it } from 'vitest';
import { runSummary } from './runSummary';
import type { SimulationResult } from '../types/quantum';

const result = (over: Partial<SimulationResult>): SimulationResult => ({
  state_vector: [], probabilities: {}, measurements: {}, bloch_coords: [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }],
  execution_time_ms: 2.4, shot_count: 1024, metrics: {}, ...over,
});

describe('runSummary', () => {
  it('names qubits, shots and time', () => {
    expect(runSummary(result({}))).toBe('Done · 2 qubits · 1,024 shots · 2 ms');
  });
  it('uses singular nouns and leaves out what is unknown', () => {
    expect(runSummary(result({ bloch_coords: [{ x: 0, y: 0, z: 1 }], shot_count: 1 }))).toBe('Done · 1 qubit · 1 shot · 2 ms');
    expect(runSummary(result({ bloch_coords: [], shot_count: 0 }))).toBe('Done · 2 ms');
  });
});
