import { describe, it, expect } from 'vitest';
import { formatPercentTick, probabilityAxis, topOutcomes, MAX_VISIBLE_OUTCOMES } from './histogramScale';

describe('probabilityAxis', () => {
  it('fits the data instead of fixing the axis at 0..1', () => {
    const uniform64 = probabilityAxis(1 / 64);
    expect(uniform64.max).toBeLessThanOrEqual(0.05);
    expect(uniform64.max).toBeGreaterThan(1 / 64);
  });

  it('uses a full 0..100% axis for a certain outcome', () => {
    const certain = probabilityAxis(1);
    expect(certain.max).toBe(1);
    expect(certain.ticks.at(-1)).toBe(1);
  });

  it('gives a Bell pair a 0..60% axis with whole-percent ticks', () => {
    const bell = probabilityAxis(0.5);
    expect(bell.max).toBeGreaterThanOrEqual(0.55);
    expect(bell.ticks.map(formatPercentTick).every((t) => /^\d+%$/.test(t))).toBe(true);
  });

  it('always starts at zero and has distinct ascending ticks', () => {
    for (const p of [0.001, 0.02, 0.1, 0.33, 0.5, 0.9, 1]) {
      const { ticks } = probabilityAxis(p);
      expect(ticks[0]).toBe(0);
      expect(new Set(ticks).size).toBe(ticks.length);
      expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
    }
  });

  it('survives an empty or zero distribution', () => {
    expect(probabilityAxis(0).max).toBeGreaterThan(0);
  });
});

describe('formatPercentTick', () => {
  it('never rounds 0.25 / 0.75 into misleading values', () => {
    expect(formatPercentTick(0.25)).toBe('25%');
    expect(formatPercentTick(0.75)).toBe('75%');
    expect(formatPercentTick(0.015)).toBe('1.5%');
    expect(formatPercentTick(0)).toBe('0%');
  });
});

describe('topOutcomes', () => {
  const rows = Array.from({ length: 64 }, (_, i) => ({ state: `|${i.toString(2).padStart(6, '0')}⟩`, probability: 1 / 64 }));

  it('keeps small distributions whole, in basis order', () => {
    const small = [
      { state: '|11⟩', probability: 0.5 },
      { state: '|00⟩', probability: 0.5 },
    ];
    const out = topOutcomes(small);
    expect(out.hiddenCount).toBe(0);
    expect(out.shown.map((r) => r.state)).toEqual(['|00⟩', '|11⟩']);
  });

  it('caps many outcomes and reports what was left out', () => {
    const out = topOutcomes(rows);
    expect(out.shown).toHaveLength(MAX_VISIBLE_OUTCOMES);
    expect(out.hiddenCount).toBe(64 - MAX_VISIBLE_OUTCOMES);
    expect(out.hiddenProbability).toBeCloseTo((64 - MAX_VISIBLE_OUTCOMES) / 64, 6);
  });

  it('keeps the most likely outcomes, then orders them by basis state', () => {
    const skewed = [...rows.slice(0, 40).map((r) => ({ ...r, probability: 0.001 })), { state: '|111111⟩', probability: 0.9 }];
    const out = topOutcomes(skewed);
    expect(out.shown.some((r) => r.state === '|111111⟩')).toBe(true);
    const states = out.shown.map((r) => r.state);
    expect([...states].sort()).toEqual(states);
  });

  it('can show everything on request', () => {
    expect(topOutcomes(rows, Infinity).shown).toHaveLength(64);
  });
});
