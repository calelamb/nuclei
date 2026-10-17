// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CircuitSnapshot } from '../types/quantum';

vi.mock('./narration', () => ({
  narrateParse: vi.fn(),
  narrateResult: vi.fn(),
}));

import { narrateParse } from './narration';
import { useDiracStore } from '../stores/diracStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  NARRATION_IDLE_MS,
  NARRATION_MIN_INTERVAL_MS,
  gateSignature,
  requestParseNarration,
  resetAmbientNarrator,
} from './ambientNarrator';

function snap(gates: Array<{ type: string; targets: number[]; controls?: number[] }>): CircuitSnapshot {
  return {
    framework: 'qiskit',
    qubit_count: 2,
    classical_bit_count: 0,
    depth: gates.length,
    gates: gates.map((g, i) => ({ type: g.type, targets: g.targets, controls: g.controls ?? [], params: [], layer: i })),
  };
}

const H0 = snap([{ type: 'H', targets: [0] }]);
const HX = snap([{ type: 'H', targets: [0] }, { type: 'X', targets: [1] }]);

describe('ambient narration scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(narrateParse).mockReset();
    vi.mocked(narrateParse).mockResolvedValue('A line');
    resetAmbientNarrator();
    useDiracStore.setState({ apiKey: 'sk-test', ambientFeed: [] } as never);
    useSettingsStore.getState().updateDirac({ ambientNarration: true });
  });
  afterEach(() => vi.useRealTimers());

  it('is off by default', () => {
    useSettingsStore.getState().resetAll();
    expect(useSettingsStore.getState().dirac.ambientNarration).toBe(false);
  });

  it('never calls without the setting', async () => {
    useSettingsStore.getState().updateDirac({ ambientNarration: false });
    requestParseNarration('code', H0);
    await vi.advanceTimersByTimeAsync(NARRATION_IDLE_MS * 3);
    expect(narrateParse).not.toHaveBeenCalled();
  });

  it('never calls without an API key', async () => {
    useDiracStore.setState({ apiKey: '' } as never);
    requestParseNarration('code', H0);
    await vi.advanceTimersByTimeAsync(NARRATION_IDLE_MS * 3);
    expect(narrateParse).not.toHaveBeenCalled();
  });

  it('collapses a burst of snapshots into one call after idle', async () => {
    for (let i = 0; i < 26; i++) {
      requestParseNarration(`code ${i}`, i % 2 ? H0 : HX);
      await vi.advanceTimersByTimeAsync(400);
    }
    expect(narrateParse).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(NARRATION_IDLE_MS);
    expect(narrateParse).toHaveBeenCalledTimes(1);
  });

  it('skips when the gate signature did not change', async () => {
    requestParseNarration('a', H0);
    await vi.advanceTimersByTimeAsync(NARRATION_IDLE_MS + 10);
    requestParseNarration('a  ', H0);
    await vi.advanceTimersByTimeAsync(NARRATION_MIN_INTERVAL_MS + NARRATION_IDLE_MS);
    expect(narrateParse).toHaveBeenCalledTimes(1);
  });

  it('rate-limits to one call per interval', async () => {
    requestParseNarration('a', H0);
    await vi.advanceTimersByTimeAsync(NARRATION_IDLE_MS + 10);
    requestParseNarration('b', HX);
    await vi.advanceTimersByTimeAsync(NARRATION_IDLE_MS + 10);
    expect(narrateParse).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(NARRATION_MIN_INTERVAL_MS);
    expect(narrateParse).toHaveBeenCalledTimes(2);
  });

  it('drops a stale answer that resolves after a newer request', async () => {
    const pushed: string[] = [];
    useDiracStore.setState({ pushAmbient: (e: { text: string }) => pushed.push(e.text) } as never);
    let resolveFirst: (v: string) => void = () => {};
    vi.mocked(narrateParse)
      .mockImplementationOnce(() => new Promise<string>((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce('second');
    requestParseNarration('a', H0);
    await vi.advanceTimersByTimeAsync(NARRATION_IDLE_MS + 10);
    requestParseNarration('b', HX);
    await vi.advanceTimersByTimeAsync(NARRATION_MIN_INTERVAL_MS + NARRATION_IDLE_MS + 10);
    resolveFirst('first-late');
    await vi.advanceTimersByTimeAsync(10);
    expect(pushed).toEqual(['second']);
  });
});

describe('gateSignature', () => {
  it('ignores code whitespace and depends on gates only', () => {
    expect(gateSignature(H0)).toBe(gateSignature(snap([{ type: 'H', targets: [0] }])));
    expect(gateSignature(H0)).not.toBe(gateSignature(HX));
  });
});
