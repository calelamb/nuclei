import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/experiments/experiments.css'), 'utf8');

describe('runs table sticky cells (research-r-02)', () => {
  it('stretches cells to the row height so sticky backgrounds cover scrolled status pills', () => {
    expect(css).toMatch(/\.nuclei-runs-row \{[^}]*align-items: stretch/);
    expect(css).toMatch(/\.nuclei-runs-row__run \{[^}]*display: flex; align-items: center/);
    expect(css).toMatch(/\.nuclei-runs-row__cell \{[^}]*display: flex; align-items: center/);
    expect(css).toMatch(/\.nuclei-runs-row__cell\[data-numeric='true'\] \{[^}]*justify-content: flex-end/);
  });
});

describe('runs table frozen column edge', () => {
  it('casts a soft shadow from the Run column so scrolled cells read as sliding under it', () => {
    expect(css).toMatch(/\.nuclei-runs-row__run \{[^}]*box-shadow: 1px 0 0 var\(--color-border-subtle\), 6px 0 8px -6px/);
  });
});
