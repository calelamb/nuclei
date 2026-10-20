import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'vizRail.css'), 'utf8');

const uiCss = readFileSync(join(__dirname, '..', 'ui', 'ui.css'), 'utf8');

describe('programmatic landing targets', () => {
  it('draw no focus ring: they are not controls (one shared rule in ui.css)', () => {
    for (const attr of ['data-landing', 'data-nav-landing', 'data-nav-landed', 'data-viz-landing']) {
      expect(uiCss).toMatch(new RegExp(`:is\\([^)]*\\[${attr}\\][^)]*\\):is\\(:focus, :focus-visible\\)\\s*\\{[^}]*outline:\\s*none`));
    }
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
