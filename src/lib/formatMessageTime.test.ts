import { describe, it, expect } from 'vitest';
import { formatMessageTime } from './formatMessageTime';

describe('formatMessageTime', () => {
  const now = new Date(2026, 9, 16, 22, 6);

  it('shows only the time for messages from today', () => {
    const out = formatMessageTime(new Date(2026, 9, 16, 9, 5).toISOString(), now);
    expect(out).toMatch(/9:05/);
    expect(out).not.toMatch(/Oct/);
  });

  it('adds the date for earlier days and uses the message time, not now', () => {
    const out = formatMessageTime(new Date(2026, 6, 14, 15, 30).toISOString(), now);
    expect(out).toMatch(/Jul/);
    expect(out).toMatch(/14/);
    expect(out).toMatch(/3:30/);
    expect(out).not.toMatch(/10:06/);
  });

  it('adds the year for other years', () => {
    expect(formatMessageTime(new Date(2025, 6, 14, 15, 30).toISOString(), now)).toMatch(/2025/);
  });

  it('returns empty for garbage', () => {
    expect(formatMessageTime('nope', now)).toBe('');
  });
});
