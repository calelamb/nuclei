/**
 * Seeded xoshiro128** with a serializable state (PRD 14 §7.4).
 *
 * A generator is inherently stateful, so `Rng` mutates its four words; the
 * state is always exportable (`state()`) and restorable (`restoreRng`), which
 * is what makes a resumed run reproduce the original stream exactly.
 */

import type { RngState } from '../../types/discovery';

export type { RngState };

const U32 = 0x1_0000_0000;

/** splitmix32: expands one 32-bit seed into well-mixed words. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

/** Mix a seed with a text label into a new 32-bit seed (child streams). */
export function deriveSeed(seed: number, label: string | number): number {
  let h = (seed >>> 0) ^ 0x811c9dc5;
  const text = String(label);
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  const next = splitmix32(h);
  next();
  return next();
}

export interface Rng {
  /** Next unsigned 32-bit integer. */
  nextU32(): number;
  /** Float in [0, 1). */
  next(): number;
  uniform(min: number, max: number): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates over a copy; the input is never mutated. */
  shuffle<T>(items: readonly T[]): T[];
  /** Draw a fresh 32-bit seed for a child consumer (advances this stream). */
  childSeed(): number;
  state(): RngState;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function restoreRng(initial: RngState): Rng {
  const s = [initial[0] >>> 0, initial[1] >>> 0, initial[2] >>> 0, initial[3] >>> 0];
  if (s.every((word) => word === 0)) s[0] = 1; // xoshiro must not be all-zero.

  const nextU32 = (): number => {
    const result = (Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0);
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    for (let i = 0; i < 4; i += 1) s[i] >>>= 0;
    return result;
  };

  const next = () => nextU32() / U32;
  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`rng.int needs integers with min <= max (got ${min}, ${max})`);
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  return {
    nextU32,
    next,
    uniform: (min, max) => min + next() * (max - min),
    int,
    chance: (probability) => next() < probability,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError('rng.pick needs a non-empty list');
      return items[int(0, items.length - 1)];
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    childSeed: nextU32,
    state: () => [s[0], s[1], s[2], s[3]] as const,
  };
}

export function createRng(seed: number): Rng {
  const mix = splitmix32(seed);
  return restoreRng([mix(), mix(), mix(), mix()]);
}
