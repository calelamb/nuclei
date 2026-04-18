// src/styles/tokens.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DARK_COLORS, LIGHT_COLORS } from './tokens';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, 'tokens.css');
const css = readFileSync(cssPath, 'utf8');

function extractScope(source: string, selector: string): Map<string, string> {
  // Grab the block that starts with the given selector and collect --foo: bar declarations.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm');
  const match = source.match(re);
  const body = match?.[1] ?? '';
  const out = new Map<string, string>();
  for (const line of body.split(/[\n;]/)) {
    const m = line.trim().match(/^(--[a-z0-9-]+)\s*:\s*(.+?)\s*$/i);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

const colorKeyMap: Record<keyof typeof DARK_COLORS, string> = {
  surfaceBase: '--color-surface-base',
  surfaceRaised: '--color-surface-raised',
  surfaceOverlay: '--color-surface-overlay',
  surfaceSunken: '--color-surface-sunken',
  textPrimary: '--color-text-primary',
  textSecondary: '--color-text-secondary',
  textTertiary: '--color-text-tertiary',
  textDisabled: '--color-text-disabled',
  borderSubtle: '--color-border-subtle',
  borderStrong: '--color-border-strong',
  accentQuantum: '--color-accent-quantum',
  accentQuantumSoft: '--color-accent-quantum-soft',
  accentDirac: '--color-accent-dirac',
  success: '--color-success',
  warning: '--color-warning',
  danger: '--color-danger',
  info: '--color-info',
  kernelIdle: '--color-kernel-idle',
  kernelConnecting: '--color-kernel-connecting',
  kernelReady: '--color-kernel-ready',
  kernelError: '--color-kernel-error',
  syntaxComment: '--color-syntax-comment',
  syntaxString: '--color-syntax-string',
  syntaxNumber: '--color-syntax-number',
  syntaxKeyword: '--color-syntax-keyword',
  syntaxType: '--color-syntax-type',
  gateSingle: '--color-gate-single',
  gateMulti: '--color-gate-multi',
  gateMeasure: '--color-gate-measure',
  wire: '--color-wire',
};

const shadowKeyMap: Record<'sm' | 'md' | 'lg' | 'glow', string> = {
  sm: '--shadow-sm',
  md: '--shadow-md',
  lg: '--shadow-lg',
  glow: '--shadow-glow',
};

describe('tokens.css and tokens.ts are in sync', () => {
  it('dark scope contains every color/shadow token in DARK_COLORS and DARK_SHADOWS', () => {
    const scope = extractScope(css, `:root[data-theme='dark']`);
    for (const [jsKey, cssKey] of Object.entries(colorKeyMap)) {
      expect(scope.has(cssKey), `dark missing ${cssKey} (JS ${jsKey})`).toBe(true);
    }
    for (const cssKey of Object.values(shadowKeyMap)) {
      expect(scope.has(cssKey), `dark missing ${cssKey}`).toBe(true);
    }
  });

  it('light scope contains every color/shadow token in LIGHT_COLORS and LIGHT_SHADOWS', () => {
    const scope = extractScope(css, `:root[data-theme='light']`);
    for (const [jsKey, cssKey] of Object.entries(colorKeyMap)) {
      expect(scope.has(cssKey), `light missing ${cssKey} (JS ${jsKey})`).toBe(true);
    }
    for (const cssKey of Object.values(shadowKeyMap)) {
      expect(scope.has(cssKey), `light missing ${cssKey}`).toBe(true);
    }
  });

  it('dark scope values match DARK_COLORS', () => {
    const scope = extractScope(css, `:root[data-theme='dark']`);
    for (const [jsKey, cssKey] of Object.entries(colorKeyMap)) {
      const expected = DARK_COLORS[jsKey as keyof typeof DARK_COLORS];
      expect(scope.get(cssKey)?.toLowerCase()).toBe(expected.toLowerCase());
    }
  });

  it('light scope values match LIGHT_COLORS', () => {
    const scope = extractScope(css, `:root[data-theme='light']`);
    for (const [jsKey, cssKey] of Object.entries(colorKeyMap)) {
      const expected = LIGHT_COLORS[jsKey as keyof typeof LIGHT_COLORS];
      expect(scope.get(cssKey)?.toLowerCase()).toBe(expected.toLowerCase());
    }
  });
});
