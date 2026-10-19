/**
 * UI-8 / M12 — the Lab's design tokens must meet WCAG AA (4.5:1 for small
 * text) in both themes, and interactive targets must meet the size rule.
 * This reads the real stylesheets, so a token edit that regresses contrast
 * or a target size fails here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, parseDeclarations, resolveColor, ruleBody } from './contrastMath';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const TOKENS_CSS = read('../../styles/tokens.css');
const LAB_CSS = read('./lab.css');

const AA = 4.5;

type Theme = 'dark' | 'light';

function themeTokens(theme: Theme): Record<string, string> {
  const base = parseDeclarations(ruleBody(TOKENS_CSS, theme === 'dark' ? ":root[data-theme='dark']" : ":root[data-theme='light']"));
  const lab = parseDeclarations(ruleBody(LAB_CSS, '.lab'));
  const labTheme = theme === 'light' ? parseDeclarations(ruleBody(LAB_CSS, ":root[data-theme='light'] .lab")) : {};
  return { ...base, ...lab, ...labTheme };
}

const SURFACES = ['--lab-surface-1', '--lab-surface-2', '--lab-surface-3'] as const;

/** Contrast of `fg` on `bg`; translucent fills are composited over `under` first. */
function ratio(tokens: Record<string, string>, fg: string, bg: string, under?: string): number {
  const backdrop = under ? resolveColor(tokens, under) : { rgb: [0, 0, 0] as [number, number, number], alpha: 1 };
  const fill = composite(resolveColor(tokens, bg), backdrop);
  const ink = composite(resolveColor(tokens, fg), fill);
  return contrastRatio(ink.rgb, fill.rgb);
}

describe.each(['dark', 'light'] as const)('Lab contrast tokens (%s)', (theme) => {
  const tokens = themeTokens(theme);

  it.each(['--color-text-primary', '--color-text-secondary', '--color-text-tertiary'])('%s reads on every Lab surface', (ink) => {
    for (const surface of SURFACES) {
      expect(ratio(tokens, ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each([
    ['quantum', '--color-accent-quantum', '--lab-quantum-soft'],
    ['success', '--color-success', '--lab-success-soft'],
    ['warning', '--color-warning', '--lab-warning-soft'],
    ['danger', '--color-danger', '--lab-danger-soft'],
    ['dirac', '--lab-dirac-ink', '--lab-dirac-soft'],
  ])('%s pills are legible on every surface', (_tone, ink, soft) => {
    for (const surface of SURFACES) {
      expect(ratio(tokens, ink, soft, surface), `${ink} on ${soft} over ${surface}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it('keeps label ink legible on every sequential step', () => {
    for (let step = 0; step < 9; step += 1) {
      expect(ratio(tokens, `--lab-seq-ink-${step}`, `--lab-seq-${step}`), `ink on step ${step}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it('keeps the neutral pill, field errors and button inks legible', () => {
    expect(ratio(tokens, '--color-text-secondary', '--lab-surface-3')).toBeGreaterThanOrEqual(AA);
    expect(ratio(tokens, '--color-danger', '--lab-surface-1')).toBeGreaterThanOrEqual(AA);
    expect(ratio(tokens, '--color-danger', '--lab-surface-2')).toBeGreaterThanOrEqual(AA);
    expect(ratio(tokens, '--color-surface-base', '--color-accent-quantum')).toBeGreaterThanOrEqual(AA);
  });
});

describe('Lab interactive target sizes', () => {
  const height = (selector: string): number => {
    const decls = parseDeclarations(ruleBody(LAB_CSS, selector));
    const match = /^(\d+(?:\.\d+)?)px$/.exec(decls.height ?? '');
    if (!match) throw new Error(`${selector} has no px height`);
    return Number(match[1]);
  };

  it('keeps small buttons, segmented items, inputs and icon buttons at 28 px or more', () => {
    expect(height('.lab-button--sm')).toBeGreaterThanOrEqual(28);
    expect(height('.lab-segmented__item')).toBeGreaterThanOrEqual(28);
    expect(height('.lab-button')).toBeGreaterThanOrEqual(28);
    expect(height('.lab-input')).toBeGreaterThanOrEqual(28);
    expect(parseDeclarations(ruleBody(LAB_CSS, '.lab-button--icon')).width).toBe('28px');
  });

  it('gives primary buttons a 32 px target, after the size modifiers so it wins', () => {
    expect(height('.lab-button--primary')).toBeGreaterThanOrEqual(32);
    expect(LAB_CSS.indexOf('.lab-button--primary {')).toBeGreaterThan(LAB_CSS.indexOf('.lab-button--sm {'));
  });
});
