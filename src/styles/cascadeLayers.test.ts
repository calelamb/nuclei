import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

describe('cascade layers (dev and the shipped build must render the same pixels)', () => {
  const tokens = read('src/styles/tokens.css');
  const ui = read('src/components/ui/ui.css');
  const index = read('src/index.css');

  it('declares the layer order once, in the first stylesheet main.tsx loads', () => {
    expect(tokens).toContain('@layer reset, tokens, primitives;');
    const main = read('src/main.tsx');
    expect(main.indexOf("./styles/tokens.css")).toBeLessThan(main.indexOf("./index.css"));
    expect(main.indexOf("./styles/tokens.css")).toBeLessThan(main.indexOf("./components/ui/ui.css"));
  });

  it('puts the token custom properties in the tokens layer', () => {
    expect(tokens).toMatch(/@layer tokens \{\s*:root,/);
  });

  it('wraps every primitive rule in the primitives layer so component CSS always outranks it', () => {
    const body = ui.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    expect(body.startsWith('@layer primitives {')).toBe(true);
    expect(body.endsWith('}')).toBe(true);
  });

  it('keeps the global element resets below the primitives', () => {
    expect(index).toMatch(/@layer reset \{[^@]*\* \{\s*margin: 0;/);
    expect(index).toMatch(/@layer reset \{\s*button, \[role="button"\] \{/);
  });

  it('makes the boot placeholder override explicit, not order-dependent', () => {
    expect(read('src/components/layout/vizRail.css')).toContain('.nuclei-empty.viz-empty--boot {');
  });
});
