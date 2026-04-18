# A1 — Token Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish `tokens.css` as the single source of truth for color/depth/motion/spacing/typography/radius, with a JS mirror for runtime consumers (Monaco, Three.js). Wire the theme store to toggle `<html data-theme>`. Migrate `index.css`, `monacoThemes.ts`, and `App.tsx`'s SplashScreen to the new system. **Do not migrate the 30 component files with inline hex** — those are A2-A12.

**Architecture:** Two coordinated files. `src/styles/tokens.css` owns CSS custom properties in `:root[data-theme="dark"]` and `:root[data-theme="light"]` scopes. `src/styles/tokens.ts` re-exports a typed JS mirror for code that can't read CSS vars (Monaco theme generation, Three.js colors, D3 scales). A sync test asserts the two stay in lockstep. `themeStore.ts` becomes thin — state + toggle — and a small effect in `App.tsx` writes `data-theme` to `<html>` so CSS rules and components see the switch simultaneously.

**Tech Stack:** CSS custom properties, TypeScript, Zustand, Vitest (node env), Monaco.

---

## Scope

**In scope (this sitting):**
- `src/styles/tokens.css` (new)
- `src/styles/tokens.ts` (new)
- `src/styles/tokens.test.ts` (new, sync-check)
- `src/stores/themeStore.ts` (migrate to source-from-tokens, add `data-theme` effect target)
- `src/stores/themeStore.test.ts` (new)
- `src/components/editor/monacoThemes.ts` (rewrite as a builder that reads `tokens.ts`)
- `src/components/editor/monacoThemes.test.ts` (new)
- `src/index.css` (hex values → `var(--...)`; add `[data-theme]` scoping where needed)
- `src/main.tsx` (import `tokens.css` before `index.css`)
- `src/App.tsx` (SplashScreen uses tokens; add `useThemeDocumentAttribute` effect)

**Explicitly out of scope (future A-items):**
- 30 component files with inline hex (A2-A12 pull these by surface).
- Typography class rename, depth pass, empty states, etc.
- Anything under `src/components/bloch/**` beyond incidental token alignment — Bloch just shipped and is not up for re-litigation this sitting.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `src/styles/tokens.css` | CSS custom properties — single source of truth for both themes | **Create** |
| `src/styles/tokens.ts` | Typed JS mirror of the token set for runtime consumers | **Create** |
| `src/styles/tokens.test.ts` | Parse `tokens.css`, assert all keys in `tokens.ts` exist in both scopes | **Create** |
| `src/stores/themeStore.ts` | Mode state + toggle; colors/shadows sourced from `tokens.ts` | **Modify** |
| `src/stores/themeStore.test.ts` | Toggle behavior, setMode, payload shape | **Create** |
| `src/components/editor/monacoThemes.ts` | `buildNucleiDarkTheme()` / `buildNucleiLightTheme()` from `tokens.ts` | **Rewrite** |
| `src/components/editor/monacoThemes.test.ts` | Theme objects contain required keys and correct values from tokens | **Create** |
| `src/index.css` | Hex → `var()`; scrollbar/selection/focus-ring theme-aware | **Modify** |
| `src/main.tsx` | Import `tokens.css` before `index.css` | **Modify** |
| `src/App.tsx` | SplashScreen uses tokens; effect sets `<html data-theme>` on mode change | **Modify** |

---

## Task 1: Create `tokens.ts` — typed JS mirror

**Files:**
- Create: `src/styles/tokens.ts`

- [ ] **Step 1.1: Create the tokens module with full token set**

```typescript
// src/styles/tokens.ts
//
// Single typed source of truth for design tokens. The CSS file `tokens.css`
// is generated from this shape — the sync test asserts they stay aligned.
// Use these values from TypeScript when a CSS variable isn't an option
// (Monaco theme generation, Three.js materials, D3 scales).

export type ThemeMode = 'dark' | 'light';

export interface ColorTokens {
  // Surfaces
  surfaceBase: string;
  surfaceRaised: string;
  surfaceOverlay: string;
  surfaceSunken: string;
  // Text
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
  // Borders
  borderSubtle: string;
  borderStrong: string;
  // Accents
  accentQuantum: string;
  accentQuantumSoft: string;
  accentDirac: string;
  // Semantics
  success: string;
  warning: string;
  danger: string;
  info: string;
  // Kernel status
  kernelIdle: string;
  kernelConnecting: string;
  kernelReady: string;
  kernelError: string;
  // Syntax (used by Monaco + markdown preview)
  syntaxComment: string;
  syntaxString: string;
  syntaxNumber: string;
  syntaxKeyword: string;
  syntaxType: string;
  // Circuit
  gateSingle: string;
  gateMulti: string;
  gateMeasure: string;
  wire: string;
}

export interface ShadowTokens {
  sm: string;
  md: string;
  lg: string;
  glow: string;
}

export interface MotionTokens {
  durationFast: string;
  durationNormal: string;
  durationSlow: string;
  easeStandard: string;
  easeEmphasizedOut: string;
  easeEmphasizedIn: string;
}

export interface SpacingTokens {
  s1: string; s2: string; s3: string; s4: string;
  s5: string; s6: string; s8: string; s12: string;
}

export interface RadiusTokens {
  sharp: string;
  soft: string;
  round: string;
  pill: string;
}

export interface TypographyTokens {
  fontSans: string;
  fontMono: string;
  sizeDisplay: string;
  sizeTitle: string;
  sizeBody: string;
  sizeCode: string;
  sizeCaption: string;
  sizeChromeLabel: string;
  weightRegular: string;
  weightMedium: string;
  weightSemibold: string;
  weightBold: string;
}

export const DARK_COLORS: ColorTokens = {
  surfaceBase: '#0F1B2D',
  surfaceRaised: '#152238',
  surfaceOverlay: '#1A2A42',
  surfaceSunken: '#080E18',
  textPrimary: '#E8ECF1',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',
  textDisabled: '#475569',
  borderSubtle: 'rgba(255,255,255,0.06)',
  borderStrong: '#1A2A42',
  accentQuantum: '#00B4D8',
  accentQuantumSoft: '#48CAE4',
  accentDirac: '#7B2D8E',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
  kernelIdle: '#64748B',
  kernelConnecting: '#F59E0B',
  kernelReady: '#10B981',
  kernelError: '#EF4444',
  syntaxComment: '#6A737D',
  syntaxString: '#98C379',
  syntaxNumber: '#D19A66',
  syntaxKeyword: '#00B4D8',
  syntaxType: '#48CAE4',
  gateSingle: '#00B4D8',
  gateMulti: '#1E3A5F',
  gateMeasure: '#6A737D',
  wire: '#3D5A80',
};

export const LIGHT_COLORS: ColorTokens = {
  surfaceBase: '#FFFFFF',
  surfaceRaised: '#F8FAFC',
  surfaceOverlay: '#F1F5F9',
  surfaceSunken: '#E2E8F0',
  textPrimary: '#1A1A2E',
  textSecondary: '#475569',
  textTertiary: '#64748B',
  textDisabled: '#94A3B8',
  borderSubtle: 'rgba(0,0,0,0.06)',
  borderStrong: '#E2E8F0',
  accentQuantum: '#0891B2',
  accentQuantumSoft: '#00B4D8',
  accentDirac: '#6B21A8',
  success: '#059669',
  warning: '#D97706',
  danger: '#DC2626',
  info: '#2563EB',
  kernelIdle: '#94A3B8',
  kernelConnecting: '#D97706',
  kernelReady: '#059669',
  kernelError: '#DC2626',
  syntaxComment: '#6A737D',
  syntaxString: '#22863A',
  syntaxNumber: '#B76E00',
  syntaxKeyword: '#0891B2',
  syntaxType: '#005F73',
  gateSingle: '#0891B2',
  gateMulti: '#3B6EA5',
  gateMeasure: '#6A737D',
  wire: '#959DA5',
};

export const DARK_SHADOWS: ShadowTokens = {
  sm: '0 1px 2px rgba(0,0,0,0.3)',
  md: '0 4px 12px rgba(0,0,0,0.4)',
  lg: '0 8px 24px rgba(0,0,0,0.5)',
  glow: '0 0 20px rgba(0,180,216,0.15)',
};

export const LIGHT_SHADOWS: ShadowTokens = {
  sm: '0 1px 3px rgba(0,0,0,0.08)',
  md: '0 4px 12px rgba(0,0,0,0.1)',
  lg: '0 8px 24px rgba(0,0,0,0.15)',
  glow: '0 0 20px rgba(8,145,178,0.12)',
};

export const MOTION: MotionTokens = {
  durationFast: '120ms',
  durationNormal: '200ms',
  durationSlow: '360ms',
  easeStandard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easeEmphasizedOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeEmphasizedIn: 'cubic-bezier(0.7, 0, 0.84, 0)',
};

export const SPACING: SpacingTokens = {
  s1: '4px', s2: '8px', s3: '12px', s4: '16px',
  s5: '20px', s6: '24px', s8: '32px', s12: '48px',
};

export const RADIUS: RadiusTokens = {
  sharp: '0',
  soft: '4px',
  round: '8px',
  pill: '999px',
};

export const TYPOGRAPHY: TypographyTokens = {
  fontSans: "'Geist Sans', Inter, -apple-system, system-ui, sans-serif",
  fontMono: "'JetBrains Mono', 'Geist Mono', ui-monospace, monospace",
  sizeDisplay: '28px',
  sizeTitle: '20px',
  sizeBody: '14px',
  sizeCode: '13px',
  sizeCaption: '11px',
  sizeChromeLabel: '12px',
  weightRegular: '400',
  weightMedium: '500',
  weightSemibold: '600',
  weightBold: '700',
};

export function getColors(mode: ThemeMode): ColorTokens {
  return mode === 'dark' ? DARK_COLORS : LIGHT_COLORS;
}

export function getShadows(mode: ThemeMode): ShadowTokens {
  return mode === 'dark' ? DARK_SHADOWS : LIGHT_SHADOWS;
}
```

- [ ] **Step 1.2: Commit**

```bash
git add src/styles/tokens.ts
git commit -m "feat(tokens): add typed JS mirror of design tokens"
```

---

## Task 2: Create `tokens.css` — CSS custom properties

**Files:**
- Create: `src/styles/tokens.css`

- [ ] **Step 2.1: Write the CSS file with all tokens**

```css
/* src/styles/tokens.css
 *
 * Single source of truth for design tokens as CSS custom properties.
 * Mirrored by src/styles/tokens.ts; the sync test enforces parity.
 *
 * The default :root scope contains dark values so stylesheets that don't
 * opt in to theming still render with the intended palette.
 */

:root,
:root[data-theme='dark'] {
  /* Surfaces */
  --color-surface-base: #0F1B2D;
  --color-surface-raised: #152238;
  --color-surface-overlay: #1A2A42;
  --color-surface-sunken: #080E18;

  /* Text */
  --color-text-primary: #E8ECF1;
  --color-text-secondary: #94A3B8;
  --color-text-tertiary: #64748B;
  --color-text-disabled: #475569;

  /* Borders */
  --color-border-subtle: rgba(255, 255, 255, 0.06);
  --color-border-strong: #1A2A42;

  /* Accents */
  --color-accent-quantum: #00B4D8;
  --color-accent-quantum-soft: #48CAE4;
  --color-accent-dirac: #7B2D8E;

  /* Semantics */
  --color-success: #10B981;
  --color-warning: #F59E0B;
  --color-danger: #EF4444;
  --color-info: #3B82F6;

  /* Kernel status */
  --color-kernel-idle: #64748B;
  --color-kernel-connecting: #F59E0B;
  --color-kernel-ready: #10B981;
  --color-kernel-error: #EF4444;

  /* Syntax */
  --color-syntax-comment: #6A737D;
  --color-syntax-string: #98C379;
  --color-syntax-number: #D19A66;
  --color-syntax-keyword: #00B4D8;
  --color-syntax-type: #48CAE4;

  /* Circuit */
  --color-gate-single: #00B4D8;
  --color-gate-multi: #1E3A5F;
  --color-gate-measure: #6A737D;
  --color-wire: #3D5A80;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 20px rgba(0, 180, 216, 0.15);
}

:root[data-theme='light'] {
  --color-surface-base: #FFFFFF;
  --color-surface-raised: #F8FAFC;
  --color-surface-overlay: #F1F5F9;
  --color-surface-sunken: #E2E8F0;

  --color-text-primary: #1A1A2E;
  --color-text-secondary: #475569;
  --color-text-tertiary: #64748B;
  --color-text-disabled: #94A3B8;

  --color-border-subtle: rgba(0, 0, 0, 0.06);
  --color-border-strong: #E2E8F0;

  --color-accent-quantum: #0891B2;
  --color-accent-quantum-soft: #00B4D8;
  --color-accent-dirac: #6B21A8;

  --color-success: #059669;
  --color-warning: #D97706;
  --color-danger: #DC2626;
  --color-info: #2563EB;

  --color-kernel-idle: #94A3B8;
  --color-kernel-connecting: #D97706;
  --color-kernel-ready: #059669;
  --color-kernel-error: #DC2626;

  --color-syntax-comment: #6A737D;
  --color-syntax-string: #22863A;
  --color-syntax-number: #B76E00;
  --color-syntax-keyword: #0891B2;
  --color-syntax-type: #005F73;

  --color-gate-single: #0891B2;
  --color-gate-multi: #3B6EA5;
  --color-gate-measure: #6A737D;
  --color-wire: #959DA5;

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.15);
  --shadow-glow: 0 0 20px rgba(8, 145, 178, 0.12);
}

/* Motion / spacing / radius / typography tokens are theme-independent */
:root {
  --duration-fast: 120ms;
  --duration-normal: 200ms;
  --duration-slow: 360ms;
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-emphasized-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-emphasized-in: cubic-bezier(0.7, 0, 0.84, 0);

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;

  --radius-sharp: 0;
  --radius-soft: 4px;
  --radius-round: 8px;
  --radius-pill: 999px;

  --font-sans: 'Geist Sans', Inter, -apple-system, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Geist Mono', ui-monospace, monospace;

  --font-size-display: 28px;
  --font-size-title: 20px;
  --font-size-body: 14px;
  --font-size-code: 13px;
  --font-size-caption: 11px;
  --font-size-chrome-label: 12px;

  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
}
```

- [ ] **Step 2.2: Commit**

```bash
git add src/styles/tokens.css
git commit -m "feat(tokens): add tokens.css with CSS custom properties for both themes"
```

---

## Task 3: Sync test — assert `tokens.ts` and `tokens.css` stay aligned

**Files:**
- Create: `src/styles/tokens.test.ts`

The test reads both files from disk and confirms every JS token has a matching CSS custom property in both theme scopes (and vice versa for the color subset). This is the guard against drift when anyone edits one and forgets the other.

- [ ] **Step 3.1: Write the failing test first**

```typescript
// src/styles/tokens.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DARK_COLORS, LIGHT_COLORS,
  DARK_SHADOWS, LIGHT_SHADOWS,
} from './tokens';

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

const shadowKeyMap: Record<keyof typeof DARK_SHADOWS, string> = {
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
    // Shadows live in the same scope
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
```

- [ ] **Step 3.2: Run it to verify it passes against what we already wrote**

Run: `npx vitest run src/styles/tokens.test.ts`
Expected: 4 passing tests. If any fail, fix the mismatch in either `tokens.ts` or `tokens.css` until green.

- [ ] **Step 3.3: Commit**

```bash
git add src/styles/tokens.test.ts
git commit -m "test(tokens): sync test between tokens.ts and tokens.css"
```

---

## Task 4: Import `tokens.css` before `index.css`

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 4.1: Add tokens import at the top of the CSS import chain**

Replace `src/main.tsx` contents with:

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import './styles/tokens.css'
import './index.css'
import App from './App.tsx'

// Configure Monaco web workers for Vite — without this, Monaco's default
// worker creation fails silently in Tauri's WKWebView.
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  },
}

loader.config({ monaco })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 4.2: Commit**

```bash
git add src/main.tsx
git commit -m "feat(tokens): load tokens.css before index.css"
```

---

## Task 5: Migrate `themeStore.ts` to source from `tokens.ts`

**Files:**
- Modify: `src/stores/themeStore.ts`
- Create: `src/stores/themeStore.test.ts`

Keep the public shape of `ThemeColors`/`ThemeShadows` (30+ component files read `useThemeStore((s) => s.colors)` — we are NOT touching those this sitting). Internally, map the new token set onto the legacy shape. Remove the hard-coded palette literals.

- [ ] **Step 5.1: Write the failing test**

```typescript
// src/stores/themeStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore } from './themeStore';
import { DARK_COLORS, LIGHT_COLORS } from '../styles/tokens';

describe('themeStore', () => {
  beforeEach(() => {
    useThemeStore.getState().setMode('dark');
  });

  it('starts in dark mode', () => {
    expect(useThemeStore.getState().mode).toBe('dark');
  });

  it('setMode(light) applies the light palette', () => {
    useThemeStore.getState().setMode('light');
    const { colors, mode } = useThemeStore.getState();
    expect(mode).toBe('light');
    expect(colors.bg.toLowerCase()).toBe(LIGHT_COLORS.surfaceBase.toLowerCase());
    expect(colors.accent.toLowerCase()).toBe(LIGHT_COLORS.accentQuantum.toLowerCase());
  });

  it('setMode(dark) applies the dark palette', () => {
    useThemeStore.getState().setMode('light');
    useThemeStore.getState().setMode('dark');
    const { colors } = useThemeStore.getState();
    expect(colors.bg.toLowerCase()).toBe(DARK_COLORS.surfaceBase.toLowerCase());
  });

  it('toggle alternates between modes', () => {
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().mode).toBe('light');
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().mode).toBe('dark');
  });
});
```

- [ ] **Step 5.2: Run the test to verify it fails**

Run: `npx vitest run src/stores/themeStore.test.ts`
Expected: FAIL — either tests fail on value mismatch or the import of `../styles/tokens` doesn't resolve yet (Task 1 already wrote it, so value mismatch is the likely mode — the legacy store uses a different palette for light than `LIGHT_COLORS`).

- [ ] **Step 5.3: Rewrite `themeStore.ts` to source from tokens**

Replace `src/stores/themeStore.ts` contents with:

```typescript
import { create } from 'zustand';
import {
  DARK_COLORS, LIGHT_COLORS,
  DARK_SHADOWS, LIGHT_SHADOWS,
  type ColorTokens, type ShadowTokens, type ThemeMode,
} from '../styles/tokens';

// Legacy public shape consumed across the app. A2+ migrations will move
// consumers onto token keys directly; this adapter keeps them working
// unchanged in the meantime.

export type { ThemeMode };

export interface ThemeShadows {
  sm: string;
  md: string;
  lg: string;
  glow: string;
}

export interface ThemeColors {
  bg: string;
  bgPanel: string;
  bgEditor: string;
  bgElevated: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textDim: string;
  accent: string;
  accentLight: string;
  dirac: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  comment: string;
  string: string;
  number: string;
  gateSingle: string;
  gateMulti: string;
  gateMeasure: string;
  wire: string;
}

function legacyFromTokens(c: ColorTokens): ThemeColors {
  return {
    bg: c.surfaceBase,
    bgPanel: c.surfaceSunken,
    bgEditor: c.surfaceBase,
    bgElevated: c.surfaceRaised,
    border: c.borderSubtle,
    borderStrong: c.borderStrong,
    text: c.textPrimary,
    textMuted: c.textSecondary,
    textDim: c.textDisabled,
    accent: c.accentQuantum,
    accentLight: c.accentQuantumSoft,
    dirac: c.accentDirac,
    success: c.success,
    warning: c.warning,
    error: c.danger,
    info: c.info,
    comment: c.syntaxComment,
    string: c.syntaxString,
    number: c.syntaxNumber,
    gateSingle: c.gateSingle,
    gateMulti: c.gateMulti,
    gateMeasure: c.gateMeasure,
    wire: c.wire,
  };
}

function shadowsFromTokens(s: ShadowTokens): ThemeShadows {
  return { sm: s.sm, md: s.md, lg: s.lg, glow: s.glow };
}

interface ThemeState {
  mode: ThemeMode;
  colors: ThemeColors;
  shadow: ThemeShadows;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

function snapshot(mode: ThemeMode) {
  const colors = mode === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const shadow = mode === 'dark' ? DARK_SHADOWS : LIGHT_SHADOWS;
  return {
    mode,
    colors: legacyFromTokens(colors),
    shadow: shadowsFromTokens(shadow),
  };
}

export const useThemeStore = create<ThemeState>((set) => ({
  ...snapshot('dark'),
  setMode: (mode) => set(snapshot(mode)),
  toggle: () => set((s) => snapshot(s.mode === 'dark' ? 'light' : 'dark')),
}));
```

- [ ] **Step 5.4: Run the test to verify it passes**

Run: `npx vitest run src/stores/themeStore.test.ts`
Expected: 4 passing tests.

- [ ] **Step 5.5: Run the full test suite to catch any regression in existing stores**

Run: `npx vitest run`
Expected: all previously-passing tests still pass.

- [ ] **Step 5.6: Commit**

```bash
git add src/stores/themeStore.ts src/stores/themeStore.test.ts
git commit -m "refactor(theme): source themeStore from tokens, add tests"
```

---

## Task 6: Rewrite `monacoThemes.ts` to read from tokens

**Files:**
- Modify: `src/components/editor/monacoThemes.ts`
- Create: `src/components/editor/monacoThemes.test.ts`

Monaco registers themes imperatively. Rewrite the module as two builder functions that consume token objects, plus a `registerNucleiThemes` that still takes the Monaco instance.

- [ ] **Step 6.1: Write the failing test**

```typescript
// src/components/editor/monacoThemes.test.ts
import { describe, it, expect } from 'vitest';
import { buildNucleiDarkTheme, buildNucleiLightTheme } from './monacoThemes';
import { DARK_COLORS, LIGHT_COLORS } from '../../styles/tokens';

describe('monacoThemes', () => {
  it('dark theme surfaces are sourced from tokens', () => {
    const t = buildNucleiDarkTheme();
    expect(t.colors['editor.background']).toBe(DARK_COLORS.surfaceBase);
    expect(t.colors['editorCursor.foreground']).toBe(DARK_COLORS.accentQuantum);
    expect(t.colors['editorLineNumber.activeForeground']).toBe(DARK_COLORS.accentQuantum);
  });

  it('light theme surfaces are sourced from tokens', () => {
    const t = buildNucleiLightTheme();
    expect(t.colors['editor.background']).toBe(LIGHT_COLORS.surfaceBase);
    expect(t.colors['editorCursor.foreground']).toBe(LIGHT_COLORS.accentQuantum);
  });

  it('dark theme includes the required syntax tokens', () => {
    const t = buildNucleiDarkTheme();
    const tokens = t.rules.map((r) => r.token);
    expect(tokens).toEqual(expect.arrayContaining(['comment', 'keyword', 'string', 'number', 'type']));
  });
});
```

- [ ] **Step 6.2: Run the test to verify it fails**

Run: `npx vitest run src/components/editor/monacoThemes.test.ts`
Expected: FAIL — `buildNucleiDarkTheme` / `buildNucleiLightTheme` don't exist yet.

- [ ] **Step 6.3: Rewrite `monacoThemes.ts`**

Replace `src/components/editor/monacoThemes.ts` contents with:

```typescript
import type * as monaco from 'monaco-editor';
import {
  DARK_COLORS, LIGHT_COLORS,
  type ColorTokens,
} from '../../styles/tokens';

type Monaco = typeof monaco;
type ThemeData = monaco.editor.IStandaloneThemeData;

function stripHash(hex: string): string {
  // Monaco's `rules[].foreground` wants the 6-char form without the leading #.
  return hex.startsWith('#') ? hex.slice(1) : hex;
}

function buildTheme(base: 'vs' | 'vs-dark', c: ColorTokens): ThemeData {
  return {
    base,
    inherit: true,
    rules: [
      { token: 'comment', foreground: stripHash(c.syntaxComment), fontStyle: 'italic' },
      { token: 'keyword', foreground: stripHash(c.syntaxKeyword) },
      { token: 'string', foreground: stripHash(c.syntaxString) },
      { token: 'number', foreground: stripHash(c.syntaxNumber) },
      { token: 'type', foreground: stripHash(c.syntaxType) },
    ],
    colors: {
      'editor.background': c.surfaceBase,
      'editor.foreground': c.textPrimary,
      'editor.lineHighlightBackground': c.surfaceOverlay,
      'editor.selectionBackground': base === 'vs-dark' ? '#264F78' : '#B4D7FF',
      'editorCursor.foreground': c.accentQuantum,
      'editorLineNumber.foreground': c.wire,
      'editorLineNumber.activeForeground': c.accentQuantum,
    },
  };
}

export function buildNucleiDarkTheme(): ThemeData {
  return buildTheme('vs-dark', DARK_COLORS);
}

export function buildNucleiLightTheme(): ThemeData {
  return buildTheme('vs', LIGHT_COLORS);
}

export function registerNucleiThemes(monacoInstance: Monaco): void {
  monacoInstance.editor.defineTheme('nuclei-dark', buildNucleiDarkTheme());
  monacoInstance.editor.defineTheme('nuclei-light', buildNucleiLightTheme());
}
```

- [ ] **Step 6.4: Run the test to verify it passes**

Run: `npx vitest run src/components/editor/monacoThemes.test.ts`
Expected: 3 passing tests.

- [ ] **Step 6.5: Commit**

```bash
git add src/components/editor/monacoThemes.ts src/components/editor/monacoThemes.test.ts
git commit -m "refactor(editor): Monaco themes read from tokens"
```

---

## Task 7: Migrate `index.css` hex values to `var(--...)`

**Files:**
- Modify: `src/index.css`

Replace every hard-coded color with a token reference so light mode actually applies to body, focus ring, scrollbar, dirac-markdown, gate hover, and circuit grid.

- [ ] **Step 7.1: Rewrite `index.css`**

Replace `src/index.css` contents with:

```css
/* Nuclei — Global Styles */
/* Fonts: Geist Sans (UI) + JetBrains Mono (code) */
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');

/* Geist Sans font-face (from npm package) */
@font-face {
  font-family: 'Geist Sans';
  src: url('/node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2') format('woff2');
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Geist Sans';
  src: url('/node_modules/geist/dist/fonts/geist-sans/Geist-Medium.woff2') format('woff2');
  font-weight: 500; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Geist Sans';
  src: url('/node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.woff2') format('woff2');
  font-weight: 600; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Geist Sans';
  src: url('/node_modules/geist/dist/fonts/geist-sans/Geist-Bold.woff2') format('woff2');
  font-weight: 700; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Geist Mono';
  src: url('/node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.woff2') format('woff2');
  font-weight: 400; font-style: normal; font-display: swap;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  overflow: hidden;
  background: var(--color-surface-base);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
}

#root {
  width: 100vw;
  height: 100vh;
}

/* ── Accessibility: visible focus indicators ── */
:focus-visible {
  outline: 2px solid var(--color-accent-quantum);
  outline-offset: 2px;
}

button:focus:not(:focus-visible) {
  outline: none;
}

/* ── Reduced motion: disable all animations ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* ── Keyframes ── */
@keyframes nuclei-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@keyframes nuclei-slide-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes nuclei-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes nuclei-dots { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
@keyframes nuclei-gate-enter { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
@keyframes nuclei-gate-exit { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.8); } }
@keyframes nuclei-teal-glow {
  0%, 100% { filter: drop-shadow(0 0 4px rgba(0, 180, 216, 0.3)); }
  50% { filter: drop-shadow(0 0 12px rgba(0, 180, 216, 0.6)); }
}
@keyframes nuclei-lightbulb-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
@keyframes nuclei-bar-grow {
  from { transform: scaleY(0); transform-origin: bottom; }
  to { transform: scaleY(1); transform-origin: bottom; }
}
@keyframes nuclei-heartbeat { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
@keyframes nuclei-slide-down { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes nuclei-slide-in-right { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
@keyframes nuclei-slide-in-left { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
@keyframes nuclei-counter-tick { 0% { transform: translateY(0); } 50% { transform: translateY(-2px); } 100% { transform: translateY(0); } }
@keyframes nuclei-shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }
@keyframes nuclei-wire-draw { from { stroke-dashoffset: 1000; } to { stroke-dashoffset: 0; } }
@keyframes nuclei-shimmer { 0% { background-position: -200px 0; } 100% { background-position: 200px 0; } }
@keyframes nuclei-orbit { from { transform: translateX(-50%) rotate(0deg); } to { transform: translateX(-50%) rotate(360deg); } }

/* ── Dirac markdown styling ── */
.dirac-markdown p { margin: 0 0 8px 0; }
.dirac-markdown p:last-child { margin-bottom: 0; }
.dirac-markdown code {
  background: var(--color-surface-overlay);
  padding: 2px 6px;
  border-radius: var(--radius-soft);
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  color: var(--color-accent-quantum);
}
.dirac-markdown pre {
  background: var(--color-surface-base);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-round);
  padding: 10px;
  margin: 8px 0;
  overflow-x: auto;
  position: relative;
}
.dirac-markdown pre code {
  background: none;
  padding: 0;
  color: var(--color-text-primary);
}
.dirac-markdown ul, .dirac-markdown ol { padding-left: 20px; margin: 6px 0; }
.dirac-markdown strong { color: var(--color-accent-quantum-soft); }
.dirac-markdown h1, .dirac-markdown h2, .dirac-markdown h3 {
  color: var(--color-accent-quantum);
  margin: 8px 0 4px 0;
}

/* ── Interactive element defaults ── */
button, [role="button"] {
  transition: all var(--duration-fast) var(--ease-standard);
}

/* ── Circuit gate hover ── */
.nuclei-gate {
  transition: filter var(--duration-fast) var(--ease-standard),
              transform var(--duration-fast) var(--ease-standard);
}
.nuclei-gate:hover {
  filter: drop-shadow(0 0 8px rgba(0, 180, 216, 0.4));
  transform: scale(1.05);
  transform-origin: center;
}

/* ── Circuit dot grid background ── */
.circuit-renderer-container {
  background-image: radial-gradient(circle, var(--color-border-strong) 0.5px, transparent 0.5px);
  background-size: 20px 20px;
  background-position: 10px 10px;
}

/* ── Scrollbar styling ── */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: var(--radius-soft);
}
::-webkit-scrollbar-thumb:hover { background: var(--color-text-tertiary); }

/* ── Typography scale classes ── */
.nuclei-h1 { font-size: var(--font-size-display); font-weight: var(--font-weight-bold); font-family: var(--font-sans); line-height: 1.2; }
.nuclei-h2 { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); font-family: var(--font-sans); line-height: 1.3; }
.nuclei-h3 { font-size: 16px; font-weight: var(--font-weight-semibold); font-family: var(--font-sans); line-height: 1.4; }
.nuclei-body { font-size: var(--font-size-body); font-family: var(--font-sans); line-height: 1.5; }
.nuclei-secondary { font-size: var(--font-size-code); font-family: var(--font-sans); line-height: 1.5; }
.nuclei-caption { font-size: var(--font-size-caption); font-family: var(--font-sans); line-height: 1.4; }
.nuclei-code { font-size: var(--font-size-code); font-family: var(--font-mono); line-height: 1.5; }
```

- [ ] **Step 7.2: Commit**

```bash
git add src/index.css
git commit -m "refactor(styles): migrate index.css to token variables"
```

---

## Task 8: Wire `<html data-theme>` from App + migrate SplashScreen

**Files:**
- Modify: `src/App.tsx`

Two changes to `App.tsx`:
1. Add a `useEffect` that writes `document.documentElement.dataset.theme` whenever the theme store mode changes. Without this, the new CSS `[data-theme='light']` scope never activates.
2. Rewrite `SplashScreen` to use CSS vars instead of hard-coded `#080E18` / `#00B4D8`.

- [ ] **Step 8.1: Modify `src/App.tsx` — add the theme-attribute effect**

Add this import alongside the existing theme-store import:

```typescript
import { useThemeStore } from './stores/themeStore';
```

(Already present.) Then add a new effect inside `AppInner`, immediately after the existing `themeToggle` assignment and before the `isDirty` effect:

Find:
```typescript
  const themeToggle = useThemeStore((s) => s.toggle);
```

Add directly below:
```typescript
  const themeMode = useThemeStore((s) => s.mode);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);
```

- [ ] **Step 8.2: Rewrite `SplashScreen` to use tokens**

Replace the `SplashScreen` function in `src/App.tsx` with:

```typescript
function SplashScreen() {
  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 16,
      backgroundColor: 'var(--color-surface-sunken)',
    }}>
      <div style={{
        color: 'var(--color-accent-quantum)',
        fontSize: 36,
        fontWeight: 800,
        fontFamily: 'var(--font-sans)',
        letterSpacing: -1,
        animation: 'nuclei-fade-in var(--duration-slow) var(--ease-emphasized-out)',
      }}>
        NUCLEI
      </div>
      <div style={{
        color: 'var(--color-text-tertiary)',
        fontSize: 13,
        fontFamily: 'var(--font-sans)',
      }}>
        Quantum Computing IDE
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            width: 4, height: 4, borderRadius: '50%',
            backgroundColor: 'var(--color-accent-quantum)',
            animation: `nuclei-dots 1.2s var(--ease-emphasized-out) ${i * 150}ms infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8.3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(theme): drive <html data-theme>, migrate SplashScreen to tokens"
```

---

## Task 9: Final verification

- [ ] **Step 9.1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests green, including the three new test files added in this plan. If anything regressed, fix before proceeding.

- [ ] **Step 9.2: Run the linter**

Run: `npm run lint`
Expected: no new errors. If existing warnings changed count, that's fine.

- [ ] **Step 9.3: Run the typecheck/build**

Run: `npm run build`
Expected: clean build. Warnings about chunk size are pre-existing; no new TypeScript errors.

- [ ] **Step 9.4: Manual visual verification (desktop)**

Run: `npm run tauri dev`

Check:
1. App opens, splash renders correctly with the same dark palette.
2. Editor opens in dark theme; syntax colors match before (Qiskit sample code in the default buffer is a good reference).
3. Toggle theme with `Cmd+Shift+T`.
4. Light mode now applies to body background, scrollbar, focus ring, and Monaco — *confirm this works,* because light mode for CSS rules was broken before this task.
5. Toggle back to dark — everything returns to the expected palette.

Take before/after screenshots of both themes for the PR.

- [ ] **Step 9.5: Manual visual verification (web)**

Run: `npm run dev:web`, open in browser.

Same checks as desktop. Web version should behave identically.

- [ ] **Step 9.6: Final commit (if any fixup needed)**

If verification surfaced a small fix, commit it separately:

```bash
git commit -m "fix(theme): <specific issue from verification>"
```

---

## Update the Backlog

- [ ] **Step 10.1: Mark A1 complete in the spec**

Edit `docs/superpowers/specs/2026-04-18-polish-backlog-design.md`. Change the A1 line from:

```
1. **A1 — Token extraction.** `tokens.css` as single source of truth (both themes). Delete scattered inline hex/rgb/px across `src/`. Wire `monacoThemes.ts` to read from tokens.
```

to:

```
1. **A1 — Token extraction.** ✅ Shipped 2026-04-18 (PR #TBD). `tokens.css` + `tokens.ts` are the single source of truth. `themeStore.ts`, `monacoThemes.ts`, `index.css`, and `SplashScreen` migrated. Component files still holding inline hex are the scope of A2–A12.
```

- [ ] **Step 10.2: Commit the doc update**

```bash
git add docs/superpowers/specs/2026-04-18-polish-backlog-design.md
git commit -m "docs(polish): mark A1 complete"
```

---

## Self-Review

**Spec coverage.** The polish-backlog spec describes A1 as: *"tokens.css as single source of truth (both themes). Delete scattered inline hex/rgb/px across src/. Wire monacoThemes.ts to read from tokens."* The middle clause ("delete scattered inline hex across src/") cannot fit inside a single ~4-hour sitting given 239 literals across 30+ files, and the spec's own scope guardrail forbids ballooning. This plan covers tokens, Monaco, `index.css`, `themeStore`, and `SplashScreen` — the *system* side of A1. Remaining component-level hex migrations move to A2 (typography pass, which naturally touches most of those files) and subsequent surface-by-surface items. Updated scope made explicit in the plan's "Scope" section.

**Placeholder scan.** No TBDs except the literal "PR #TBD" placeholder in the backlog-update step (acceptable — it's content the author fills in at merge time). All code blocks are complete; no "implement later" language.

**Type consistency.** `ColorTokens` keys used in `tokens.ts`, `tokens.test.ts`, `themeStore.ts` (via `legacyFromTokens`), and `monacoThemes.ts` (via `buildTheme`) all match. `ThemeMode` exported from `tokens.ts` and re-exported from `themeStore.ts` to preserve the legacy public import site.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-18-a1-token-extraction.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
