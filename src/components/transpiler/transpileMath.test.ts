import { describe, it, expect } from 'vitest';
import {
  formatSigned,
  deltaTone,
  totalAddedGates,
  isEntanglingPass,
  formatAddedGates,
  resolveTargetRequest,
} from './transpileMath';
import { SIMULATOR_TARGET_ID } from '../../stores/transpileStore';
import type { TranspilePass } from '../../types/quantum';
import type { BackendInfo } from '../../types/hardware';

const pass = (added: Record<string, number>, depth = 10): TranspilePass => ({
  name: 'X',
  depth,
  added_gates: added,
});

describe('formatSigned', () => {
  it('prefixes a plus for positive and a unicode minus for negative', () => {
    expect(formatSigned(13)).toBe('+13');
    expect(formatSigned(-2)).toBe('−2');
    expect(formatSigned(0)).toBe('0');
  });
});

describe('deltaTone', () => {
  it('classifies growth as increase, shrink as decrease, equal as flat', () => {
    expect(deltaTone(4, 11)).toBe('increase');
    expect(deltaTone(11, 4)).toBe('decrease');
    expect(deltaTone(8, 8)).toBe('flat');
  });
});

describe('totalAddedGates', () => {
  it('sums signed deltas', () => {
    expect(totalAddedGates(pass({ swap: 6 }))).toBe(6);
    expect(totalAddedGates(pass({ sx: 16, h: -16, rz: 32 }))).toBe(32);
  });
});

describe('isEntanglingPass', () => {
  it('is true when a two-qubit gate is added', () => {
    expect(isEntanglingPass(pass({ swap: 1 }))).toBe(true);
    expect(isEntanglingPass(pass({ cx: 3, rz: 2 }))).toBe(true);
  });
  it('is false for single-qubit-only additions', () => {
    expect(isEntanglingPass(pass({ h: 16, rz: 32 }))).toBe(false);
  });
  it('ignores a two-qubit gate that was removed, not added', () => {
    expect(isEntanglingPass(pass({ swap: -1, sx: 1 }))).toBe(false);
  });
});

describe('formatAddedGates', () => {
  it('orders by descending magnitude and signs each', () => {
    expect(formatAddedGates(pass({ rz: 32, sx: 16, h: -16 }))).toBe('+32 rz, +16 sx, −16 h');
  });
  it('drops zero deltas', () => {
    expect(formatAddedGates(pass({ swap: 2, cx: 0 }))).toBe('+2 swap');
  });
});

const BACKEND: BackendInfo = {
  name: 'ibm_torino',
  provider: 'ibm' as never,
  qubitCount: 5,
  connectivity: [[0, 1], [1, 2]],
  queueLength: 0,
  averageErrorRate: 0,
  gateSet: ['rz', 'sx', 'x', 'cx'],
  status: 'online',
};

describe('resolveTargetRequest', () => {
  it('returns an unconstrained request for the simulator target', () => {
    expect(resolveTargetRequest(SIMULATOR_TARGET_ID, [BACKEND], 2)).toEqual({
      basisGates: null,
      couplingMap: null,
      optimizationLevel: 2,
    });
  });

  it('carries a backend’s basis gates and connectivity', () => {
    expect(resolveTargetRequest('ibm_torino', [BACKEND], 1)).toEqual({
      basisGates: ['rz', 'sx', 'x', 'cx'],
      couplingMap: [[0, 1], [1, 2]],
      optimizationLevel: 1,
    });
  });

  it('falls back to unconstrained when the target id matches no backend', () => {
    expect(resolveTargetRequest('ghost', [BACKEND], 3)).toEqual({
      basisGates: null,
      couplingMap: null,
      optimizationLevel: 3,
    });
  });
});
