import { describe, expect, it } from 'vitest';
import { headlineFor, highlightsFor, WHATS_NEW } from './whatsNew';

describe('WHATS_NEW', () => {
  it('describes the 0.15.0 release', () => {
    expect(WHATS_NEW.version).toBe('0.15.0');
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

  it('headlines the Learn story in Learn, not QEC jargon', () => {
    const head = headlineFor(WHATS_NEW, { platform: 'desktop', mode: 'learn' });
    expect(head.title.toLowerCase()).not.toContain('qec');
    expect(head.tagline ?? '').not.toMatch(/sinter|kernel/i);
    expect(highlightsFor(WHATS_NEW, { platform: 'desktop', mode: 'learn' }).length).toBeGreaterThan(0);
  });

  it('does not claim a local-kernel change on the web build', () => {
    const head = headlineFor(WHATS_NEW, { platform: 'web', mode: 'research' });
    expect(head.tagline ?? '').not.toMatch(/kernel/i);
    expect(headlineFor(WHATS_NEW, { platform: 'desktop', mode: 'research' }).tagline).toMatch(/research/i);
  });
});
