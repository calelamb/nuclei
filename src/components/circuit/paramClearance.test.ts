import { describe, expect, it } from 'vitest';
import { GATE_SIZE, WIRE_SPACING } from './gates';

/** Where the parameter caption sits under a gate box (see GateBox): baseline offset and the 11px font's descent. */
const CAPTION_BASELINE_BELOW_CENTRE = GATE_SIZE / 2 + 11;
const CAPTION_DESCENT = 3;

describe('rotation parameter caption', () => {
  it('ends clear of the next row\'s gate box (it used to touch the top of the RX box)', () => {
    const captionBottom = CAPTION_BASELINE_BELOW_CENTRE + CAPTION_DESCENT;
    const nextBoxTop = WIRE_SPACING - GATE_SIZE / 2;
    expect(nextBoxTop - captionBottom).toBeGreaterThanOrEqual(4);
  });
});
