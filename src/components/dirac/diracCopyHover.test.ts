import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Dirac code copy button', () => {
  it('has its own hover rule, because unlayered rules beat the primitives layer', () => {
    const css = readFileSync(join(__dirname, 'dirac.css'), 'utf8');
    expect(css).toMatch(/\.dirac-code__copy\.nuclei-icon-btn:hover:not\(:disabled\)\s*\{[^}]*background/);
  });

  it('scrolls the code inside the space left of the button so the first line never runs under it (learn-r4-08)', () => {
    const css = readFileSync(join(__dirname, 'dirac.css'), 'utf8');
    expect(css).toMatch(/\.dirac-code pre\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.dirac-code pre code\s*\{[^}]*overflow-x:\s*auto/);
  });
});
