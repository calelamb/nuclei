import { describe, expect, it } from 'vitest';
import { WHATS_NEW } from './whatsNew';

describe('WHATS_NEW', () => {
  it('describes the upcoming 0.14.0 release', () => {
    expect(WHATS_NEW.version).toBe('0.14.0');
  });

  it('covers kernel token, CSV plotting, statistics, Explain and nuclei-mcp', () => {
    const text = WHATS_NEW.highlights.map((h) => `${h.title} ${h.text}`).join('\n').toLowerCase();
    for (const needle of ['token', 'sinter csv', 'λ', 'warning', 'explain', 'nuclei-mcp']) {
      expect(text).toContain(needle);
    }
  });

  it('keeps every highlight terse and complete', () => {
    for (const h of WHATS_NEW.highlights) {
      expect(h.title.length).toBeGreaterThan(0);
      expect(h.text.length).toBeGreaterThan(20);
      expect(h.text.length).toBeLessThanOrEqual(220);
    }
  });
});
