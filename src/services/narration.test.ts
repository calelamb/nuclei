// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { narrateParse, narrateResult } from './narration';
import * as claudeClient from './claudeClient';
import type { CircuitSnapshot, SimulationResult } from '../types/quantum';

const SNAPSHOT: CircuitSnapshot = {
  framework: 'cirq',
  qubit_count: 2,
  classical_bit_count: 0,
  depth: 1,
  gates: [{ type: 'H', targets: [0], controls: [], params: [], layer: 0 }],
};

const RESULT: SimulationResult = {
  state_vector: [],
  probabilities: { '00': 0.5, '11': 0.5 },
  measurements: {},
  bloch_coords: [],
  execution_time_ms: 8,
};

describe('narrateParse', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null if snapshot is null', async () => {
    const out = await narrateParse({ code: '', snapshot: null });
    expect(out).toBeNull();
  });

  it('returns null if call fails (graceful)', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: null, error: 'http_error' });
    const out = await narrateParse({ code: 'x', snapshot: SNAPSHOT });
    expect(out).toBeNull();
  });

  it('returns trimmed single-line narration on success', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({
      text: '  q0 is now in superposition.\nLine2 ignored  ',
      error: null,
    });
    const out = await narrateParse({ code: 'x', snapshot: SNAPSHOT });
    expect(out).toBe('q0 is now in superposition.');
  });

  it('includes framework + gate count in prompt', async () => {
    const spy = vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: 'ok', error: null });
    await narrateParse({ code: 'cirq.H(q0)', snapshot: SNAPSHOT });
    const call = spy.mock.calls[0][0];
    expect(call.user).toContain('cirq');
    expect(call.user).toContain('1 gate');
  });
});

describe('narrateResult', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('includes probability summary in prompt', async () => {
    const spy = vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({
      text: 'bell state',
      error: null,
    });
    await narrateResult({ code: 'x', snapshot: SNAPSHOT, result: RESULT });
    const call = spy.mock.calls[0][0];
    expect(call.user).toContain('|00⟩');
    expect(call.user).toContain('50%');
  });
});
