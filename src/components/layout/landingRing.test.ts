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
