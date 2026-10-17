import { describe, expect, it } from 'vitest';
import { describeLastRun, formatLocalDateTime, formatRelative, formatSignificant, toChips, toMetricChips } from './runDetailFormat';

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

  it('describes last run as relative age with the full time as the tooltip (LR-12)', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const described = describeLastRun('2026-10-12T12:00:00Z', now);
    expect(described.label).toBe('3 d ago');
    expect(described.title).toBe(formatLocalDateTime('2026-10-12T12:00:00Z'));
    expect(describeLastRun(undefined, now).label).toBe('never run');
  });

  it('prints metric chips with the table decimals (LR-12)', () => {
    expect(toMetricChips({ energy: -1.14333 }, new Map([['energy', 4]]))).toEqual(['energy = -1.1433']);
    expect(toMetricChips({ shots: 100 }, new Map([['shots', 0]]))).toEqual(['shots = 100']);
  });
});
