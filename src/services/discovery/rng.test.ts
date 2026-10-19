import { describe, expect, it } from 'vitest';
import { createRng, deriveSeed, restoreRng } from './rng';

describe('rng', () => {
  it('matches the xoshiro128** reference vector', () => {
    const rng = restoreRng([1, 2, 3, 4]);
    expect([rng.nextU32(), rng.nextU32(), rng.nextU32(), rng.nextU32()]).toEqual([11520, 0, 5927040, 70819200]);
    expect(rng.state()).toEqual([27274249, 25704967, 31982592, 12605441]);
  });

  it('is deterministic per seed and differs across seeds', () => {
    const a = createRng(7);
    const b = createRng(7);
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 20 }, () => createRng(8).next())).not.toEqual(seqA);
  });

  it('round trips its state through JSON', () => {
    const rng = createRng(42);
    for (let i = 0; i < 10; i += 1) rng.next();
    const restored = restoreRng(JSON.parse(JSON.stringify(rng.state())));
    expect(Array.from({ length: 10 }, () => restored.nextU32())).toEqual(Array.from({ length: 10 }, () => rng.nextU32()));
  });

  it('draws floats in [0,1) and ints in range inclusive', () => {
    const rng = createRng(1);
    for (let i = 0; i < 500; i += 1) {
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rng.int(-2, 3);
      expect(n).toBeGreaterThanOrEqual(-2);
      expect(n).toBeLessThanOrEqual(3);
      const u = rng.uniform(5, 6);
      expect(u).toBeGreaterThanOrEqual(5);
      expect(u).toBeLessThan(6);
    }
    expect(() => rng.int(3, 1)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('shuffles a copy without losing items, and picks members', () => {
    const rng = createRng(5);
    const input = [1, 2, 3, 4, 5, 6];
    const out = rng.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort()).toEqual(input);
    expect(input).toContain(rng.pick(input));
  });

  it('derives stable, label-sensitive child seeds', () => {
    expect(deriveSeed(1, 'a')).toBe(deriveSeed(1, 'a'));
    expect(deriveSeed(1, 'a')).not.toBe(deriveSeed(1, 'b'));
    expect(deriveSeed(1, 'a')).not.toBe(deriveSeed(2, 'a'));
  });

  it('never gets stuck on an all-zero state', () => {
    const rng = restoreRng([0, 0, 0, 0]);
    expect(new Set(Array.from({ length: 5 }, () => rng.nextU32())).size).toBeGreaterThan(1);
  });
});
