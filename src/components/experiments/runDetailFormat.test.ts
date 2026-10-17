import { describe, expect, it } from 'vitest';
import { formatRelative, formatSignificant, toChips } from './runDetailFormat';

describe('runDetailFormat', () => {
  it('rounds metrics to 4 significant figures', () => {
    expect(formatSignificant(-0.15368363905066929)).toBe('-0.1537');
    expect(formatSignificant(2)).toBe('2');
    expect(formatSignificant(1234.5678)).toBe('1235');
  });

  it('formats relative ages', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    expect(formatRelative(new Date('2026-10-15T11:58:00Z'), now)).toBe('2 min ago');
    expect(formatRelative(new Date('2026-10-12T12:00:00Z'), now)).toBe('3 d ago');
    expect(formatRelative(new Date('2026-10-16T12:00:00Z'), now)).toBe('');
  });

  it('builds key = value chips', () => {
    expect(toChips({ theta: 1.5, mode: 'fast' })).toEqual(['theta = 1.5', 'mode = fast']);
    expect(toChips({ energy: -0.123456 }, formatSignificant)).toEqual(['energy = -0.1235']);
  });
});
