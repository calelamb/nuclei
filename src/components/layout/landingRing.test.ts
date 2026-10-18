import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'vizRail.css'), 'utf8');

describe('programmatic landing targets', () => {
  it('draw no focus ring: they are not controls (matches the lesson and track titles)', () => {
    expect(css).toMatch(/\[data-nav-landing\]:focus[^{]*\{[^}]*outline:\s*none/);
    expect(css).toMatch(/\[data-viz-landing\]:focus[^{]*\{[^}]*outline:\s*none/);
  });
});

describe('results-ready dot (shell-r6-06)', () => {
  it('sits in the tab flow beside its label, not pinned to the strip edge', () => {
    const rule = css.match(/\.viz-rail__dot\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).not.toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/margin-inline-end/)
    expect(rule).not.toMatch(/margin-block-end/);
  });
});
