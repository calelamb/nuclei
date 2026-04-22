/**
 * Polling-backoff schedule for hardware jobs.
 *
 * Tiers (age since job submission):
 *   0-60s     → every 5s    (fast convergence on short queues)
 *   60s-5m    → every 15s
 *   5m-30m    → every 60s
 *   >30m      → every 5m
 *
 * ±10% jitter applied to avoid request thundering-herd when many jobs
 * were submitted in the same second. The caller is responsible for the
 * 24h "stale" cutoff — this function only produces a next-delay.
 */

export function computeNextPollDelayMs(
  ageSeconds: number,
  rand: () => number = Math.random,
): number {
  let baseSeconds: number;
  if (ageSeconds < 60) baseSeconds = 5;
  else if (ageSeconds < 5 * 60) baseSeconds = 15;
  else if (ageSeconds < 30 * 60) baseSeconds = 60;
  else baseSeconds = 300;
  // ±10% jitter
  const jitter = (rand() - 0.5) * 0.2;
  return Math.max(1000, Math.round(baseSeconds * (1 + jitter) * 1000));
}

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
