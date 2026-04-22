import { describe, it, expect } from 'vitest';
import { computeNextPollDelayMs, STALE_AFTER_MS } from './pollSchedule';

// Deterministic rng at rand() = 0.5 makes jitter = 0, so the output
// exactly equals baseSeconds * 1000 — easy to assert against.
const noJitter = () => 0.5;

describe('computeNextPollDelayMs', () => {
  it('fast tier: 5s for the first 60s after submit', () => {
    expect(computeNextPollDelayMs(0, noJitter)).toBe(5000);
    expect(computeNextPollDelayMs(30, noJitter)).toBe(5000);
    expect(computeNextPollDelayMs(59.999, noJitter)).toBe(5000);
  });

  it('mid tier: 15s from 1 minute to 5 minutes', () => {
    expect(computeNextPollDelayMs(60, noJitter)).toBe(15000);
    expect(computeNextPollDelayMs(4 * 60, noJitter)).toBe(15000);
    expect(computeNextPollDelayMs(5 * 60 - 0.001, noJitter)).toBe(15000);
  });

  it('slow tier: 60s from 5 to 30 minutes', () => {
    expect(computeNextPollDelayMs(5 * 60, noJitter)).toBe(60_000);
    expect(computeNextPollDelayMs(29 * 60, noJitter)).toBe(60_000);
  });

  it('slowest tier: 5min past 30 minutes', () => {
    expect(computeNextPollDelayMs(30 * 60, noJitter)).toBe(5 * 60_000);
    expect(computeNextPollDelayMs(6 * 3600, noJitter)).toBe(5 * 60_000);
  });

  it('applies ±10% jitter', () => {
    // Lowest possible: rand() == 0 → jitter = -0.1 → base * 0.9
    // Highest possible: rand() == 0.999... → jitter ≈ 0.1 → base * 1.1
    const lo = computeNextPollDelayMs(0, () => 0);
    const hi = computeNextPollDelayMs(0, () => 0.999);
    expect(lo).toBe(Math.round(5000 * 0.9));
    expect(hi).toBeGreaterThanOrEqual(Math.round(5000 * 1.099));
    expect(hi).toBeLessThanOrEqual(Math.round(5000 * 1.1));
  });

  it('never returns less than 1s even at the extreme low end of jitter', () => {
    // Defensive: 5s tier with rand()=0 → 4500ms which is >= 1000.
    // Safety net keeps us from accidentally hammering the kernel if
    // somebody widens jitter in the future.
    expect(computeNextPollDelayMs(0, () => 0)).toBeGreaterThanOrEqual(1000);
  });

  it('produces the documented request-rate reduction for a 1h queue', () => {
    // Mock out jitter so the totals are deterministic. We'll tick through
    // an imaginary hour and count how many polls fire.
    let pollCount = 0;
    let t = 0;
    const SUBMITTED_AT = 0;
    const ENDS_AT = 60 * 60 * 1000; // 1 hour
    let nextPollAt = 0;
    while (t <= ENDS_AT) {
      if (t >= nextPollAt) {
        pollCount++;
        const ageSeconds = (t - SUBMITTED_AT) / 1000;
        nextPollAt = t + computeNextPollDelayMs(ageSeconds, noJitter);
      }
      t += 2000; // 2s tick (matches the interval in useKernel.ts)
    }

    // Fixed-5s polling for an hour = 720 requests.
    // Our schedule should come in well under 100 — PRD target is ~30.
    expect(pollCount).toBeLessThan(60);
    // And it must not be absurdly small (e.g. the first tier still fires).
    expect(pollCount).toBeGreaterThan(15);
  });
});

describe('STALE_AFTER_MS', () => {
  it('is 24 hours', () => {
    expect(STALE_AFTER_MS).toBe(24 * 60 * 60 * 1000);
  });
});
