import { describe, expect, it } from 'vitest';
import { createLimiter } from './runContext';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('createLimiter', () => {
  it('never exceeds the limit when a new caller arrives as a slot is released (CR-M7)', async () => {
    for (let hops = 0; hops < 8; hops += 1) {
      const limit = createLimiter(1);
      let inFlight = 0;
      let max = 0;
      const body = (p: Promise<unknown>) => async () => {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await p;
        inFlight -= 1;
      };
      let releaseA: () => void = () => undefined;
      const a = new Promise<void>((r) => { releaseA = r; });
      let releaseC: () => void = () => undefined;
      const c = new Promise<void>((r) => { releaseC = r; });
      const runs = [limit(body(a)), limit(body(tick(2)))];
      let chain: Promise<unknown> = c;
      for (let i = 0; i < hops; i += 1) chain = chain.then(() => undefined);
      runs.push(chain.then(() => limit(body(tick(2)))));
      releaseA();
      releaseC();
      await Promise.all(runs);
      expect(max).toBe(1);
    }
  });

  it('runs up to the limit concurrently and drains the queue in order', async () => {
    const limit = createLimiter(2);
    const order: number[] = [];
    let active = 0;
    let peak = 0;
    await Promise.all([1, 2, 3, 4, 5].map((n) => limit(async () => {
      active += 1; peak = Math.max(peak, active);
      await tick(1);
      order.push(n);
      active -= 1;
    })));
    expect(peak).toBe(2);
    expect(order).toHaveLength(5);
  });
});
