import { describe, expect, it } from 'vitest';
import { nextOpenPhase } from './openFeedback';

describe('nextOpenPhase (rq-r3-07)', () => {
  it('moves from idle to loading once the file is open', () => {
    expect(nextOpenPhase('idle', 'opened')).toBe('loading');
  });
  it('stalls only after a timeout while loading', () => {
    expect(nextOpenPhase('loading', 'timeout')).toBe('stalled');
    expect(nextOpenPhase('idle', 'timeout')).toBe('idle');
  });
  it('a parsed circuit ends the wait', () => {
    expect(nextOpenPhase('loading', 'circuit')).toBe('idle');
    expect(nextOpenPhase('stalled', 'circuit')).toBe('idle');
  });
  it('a second open restarts the wait', () => {
    expect(nextOpenPhase('stalled', 'opened')).toBe('loading');
  });
});
