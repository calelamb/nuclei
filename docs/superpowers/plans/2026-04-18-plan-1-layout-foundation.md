# Plan 1 — Aesthetic + Layout Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Cursor-minimalist shell with progressive-reveal panels and a demoted histogram, with no AI behavior changes, so subsequent AI plans build into a ready home.

**Architecture:** Introduce a `layoutStore` that derives panel visibility from circuit/simulation state. Wrap reveal-target panels in a `PanelReveal` animation component. Demote `ProbabilityHistogram` to an optional `HistogramChip` inline variant beneath the Bloch sphere. Soften existing design tokens (radii, surfaces, motion) without breaking the passing `tokens.test.ts` sync guarantee.

**Tech Stack:** React 19 + TypeScript + Zustand + Vitest + existing `src/styles/tokens.{ts,css}` system.

**Branch:** `feat/layout-foundation` (cut from current `feat/ai-native-spec`).

**Source spec:** `docs/superpowers/specs/2026-04-18-ai-native-progressive-reveal-design.md` sections 1, 4, 5, 7.

---

## Task 1: Create feature branch + verify starting state

**Files:**
- Verify: `src/styles/tokens.ts`, `src/styles/tokens.css`, `src/styles/tokens.test.ts`

- [ ] **Step 1: Cut feature branch from `feat/ai-native-spec`**

```bash
cd "/Users/calelamb/Desktop/personal projects/nuclei"
git checkout -b feat/layout-foundation
```

Expected: `Switched to a new branch 'feat/layout-foundation'`

- [ ] **Step 2: Verify baseline tests pass**

```bash
npm test -- --run
```

Expected: existing `tokens.test.ts`, `themeStore.test.ts`, `challengeModeStore.test.ts`, `editorStore.test.ts`, `layoutMath.test.ts`, `monacoThemes.test.ts` all pass.

- [ ] **Step 3: Verify build is green**

```bash
npm run build:web
```

Expected: `✓ built in …ms` with no TypeScript errors.

---

## Task 2: Soften design tokens (radii + surfaces + motion)

**Files:**
- Modify: `src/styles/tokens.ts`
- Modify: `src/styles/tokens.css`
- Verify: `src/styles/tokens.test.ts`

- [ ] **Step 1: Update `RADIUS` in `tokens.ts`**

Find the existing `RADIUS` export and replace with:

```typescript
export const RADIUS: RadiusTokens = {
  sharp: '0',
  soft: '6px',
  round: '10px',
  pill: '999px',
};
```

- [ ] **Step 2: Update `DARK_COLORS` surface family in `tokens.ts`**

Replace the first four surface entries in `DARK_COLORS` with softer, lower-chroma values:

```typescript
  surfaceBase: 'oklch(14% 0.008 250)',
  surfaceRaised: 'oklch(17% 0.012 250)',
  surfaceOverlay: 'oklch(20% 0.016 250)',
  surfaceSunken: 'oklch(10% 0.006 250)',
```

Leave `LIGHT_COLORS` untouched — light theme is out of scope.

- [ ] **Step 3: Update `DARK_SHADOWS` to be lower-intensity**

Replace `DARK_SHADOWS`:

```typescript
export const DARK_SHADOWS: ShadowTokens = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.25)',
  md: '0 6px 18px rgba(0, 0, 0, 0.32)',
  lg: '0 12px 32px rgba(0, 0, 0, 0.4)',
  glow: '0 0 18px rgba(0, 180, 216, 0.14)',
};
```

- [ ] **Step 4: Mirror changes into `tokens.css`**

Find the `:root` / `[data-theme="dark"]` block(s) and update the CSS variables so they match the new values. The exact variable names follow the existing convention in `tokens.css`. Leave light theme block untouched.

Keys to change (dark only):
- `--radius-soft: 6px;`
- `--radius-round: 10px;`
- `--surface-base: oklch(14% 0.008 250);`
- `--surface-raised: oklch(17% 0.012 250);`
- `--surface-overlay: oklch(20% 0.016 250);`
- `--surface-sunken: oklch(10% 0.006 250);`
- `--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.25);`
- `--shadow-md: 0 6px 18px rgba(0, 0, 0, 0.32);`
- `--shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.4);`
- `--shadow-glow: 0 0 18px rgba(0, 180, 216, 0.14);`

- [ ] **Step 5: Run the sync test**

```bash
npm test -- --run src/styles/tokens.test.ts
```

Expected: PASS. If it fails, the CSS and TS are out of sync — re-read the CSS update and reconcile.

- [ ] **Step 6: Run the whole suite + build to verify no regressions**

```bash
npm test -- --run && npm run build:web
```

Expected: all tests pass, web build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/styles/tokens.ts src/styles/tokens.css
git commit -m "feat(tokens): softer radii, lower-chroma surfaces, calmer shadows"
```

---

## Task 3: Write `layoutStore` tests (RED)

**Files:**
- Create: `src/stores/layoutStore.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/stores/layoutStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore, computeVisiblePanels, type LayoutPreset } from './layoutStore';
import type { CircuitSnapshot, SimulationResult } from '../types/quantum';

const EMPTY_SNAPSHOT: CircuitSnapshot = {
  framework: 'cirq',
  qubit_count: 0,
  classical_bit_count: 0,
  depth: 0,
  gates: [],
};

const GATE_SNAPSHOT: CircuitSnapshot = {
  ...EMPTY_SNAPSHOT,
  qubit_count: 2,
  depth: 1,
  gates: [{ type: 'H', targets: [0], controls: [], params: [], layer: 0 }],
};

const RESULT: SimulationResult = {
  state_vector: [{ re: 1, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }],
  probabilities: { '00': 0.5, '11': 0.5 },
  measurements: {},
  bloch_coords: [],
  execution_time_ms: 12,
};

describe('computeVisiblePanels', () => {
  describe("preset 'clean'", () => {
    it('hides circuit/bloch/histogram/terminal with no snapshot and no result', () => {
      const v = computeVisiblePanels({
        preset: 'clean',
        snapshot: null,
        result: null,
        hasTerminalOutput: false,
        errorActive: false,
      });
      expect(v).toEqual({
        circuit: false,
        bloch: false,
        histogramChip: false,
        histogramFull: false,
        terminal: false,
      });
    });

    it('reveals circuit once the snapshot has at least one gate', () => {
      const v = computeVisiblePanels({
        preset: 'clean',
        snapshot: GATE_SNAPSHOT,
        result: null,
        hasTerminalOutput: false,
        errorActive: false,
      });
      expect(v.circuit).toBe(true);
      expect(v.bloch).toBe(false);
      expect(v.histogramChip).toBe(false);
    });

    it('keeps circuit hidden when snapshot has zero gates', () => {
      const v = computeVisiblePanels({
        preset: 'clean',
        snapshot: EMPTY_SNAPSHOT,
        result: null,
        hasTerminalOutput: false,
        errorActive: false,
      });
      expect(v.circuit).toBe(false);
    });

    it('reveals bloch + histogramChip when a result is present', () => {
      const v = computeVisiblePanels({
        preset: 'clean',
        snapshot: GATE_SNAPSHOT,
        result: RESULT,
        hasTerminalOutput: false,
        errorActive: false,
      });
      expect(v.bloch).toBe(true);
      expect(v.histogramChip).toBe(true);
      expect(v.histogramFull).toBe(false);
    });

    it('reveals terminal on error', () => {
      const v = computeVisiblePanels({
        preset: 'clean',
        snapshot: null,
        result: null,
        hasTerminalOutput: false,
        errorActive: true,
      });
      expect(v.terminal).toBe(true);
    });

    it('reveals terminal when output exists', () => {
      const v = computeVisiblePanels({
        preset: 'clean',
        snapshot: null,
        result: null,
        hasTerminalOutput: true,
        errorActive: false,
      });
      expect(v.terminal).toBe(true);
    });
  });

  describe("preset 'balanced'", () => {
    it('forces circuit + bloch visible even with no code yet', () => {
      const v = computeVisiblePanels({
        preset: 'balanced',
        snapshot: null,
        result: null,
        hasTerminalOutput: false,
        errorActive: false,
      });
      expect(v.circuit).toBe(true);
      expect(v.bloch).toBe(true);
      expect(v.histogramChip).toBe(false);
      expect(v.histogramFull).toBe(false);
    });
  });

  describe("preset 'full'", () => {
    it('forces every panel visible and shows full histogram, not chip', () => {
      const v = computeVisiblePanels({
        preset: 'full',
        snapshot: null,
        result: null,
        hasTerminalOutput: false,
        errorActive: false,
      });
      expect(v).toEqual({
        circuit: true,
        bloch: true,
        histogramChip: false,
        histogramFull: true,
        terminal: true,
      });
    });
  });
});

describe('useLayoutStore', () => {
  beforeEach(() => {
    useLayoutStore.setState({ preset: 'clean', histogramChipDismissed: false });
  });

  it("defaults to preset 'clean'", () => {
    expect(useLayoutStore.getState().preset).toBe('clean');
  });

  it("can switch preset", () => {
    useLayoutStore.getState().setPreset('balanced' satisfies LayoutPreset);
    expect(useLayoutStore.getState().preset).toBe('balanced');
  });

  it("tracks histogram chip dismissal", () => {
    useLayoutStore.getState().dismissHistogramChip();
    expect(useLayoutStore.getState().histogramChipDismissed).toBe(true);
  });

  it("resets histogram chip dismissal on new run", () => {
    useLayoutStore.getState().dismissHistogramChip();
    useLayoutStore.getState().resetRunArtifacts();
    expect(useLayoutStore.getState().histogramChipDismissed).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- --run src/stores/layoutStore.test.ts
```

Expected: FAIL with module not found (`Cannot find module './layoutStore'`).

---

## Task 4: Implement `layoutStore` (GREEN)

**Files:**
- Create: `src/stores/layoutStore.ts`

- [ ] **Step 1: Write the implementation**

Create `src/stores/layoutStore.ts`:

```typescript
import { create } from 'zustand';
import type { CircuitSnapshot, SimulationResult } from '../types/quantum';

export type LayoutPreset = 'clean' | 'balanced' | 'full';

export interface VisiblePanels {
  circuit: boolean;
  bloch: boolean;
  histogramChip: boolean;
  histogramFull: boolean;
  terminal: boolean;
}

export interface VisibilityInputs {
  preset: LayoutPreset;
  snapshot: CircuitSnapshot | null;
  result: SimulationResult | null;
  hasTerminalOutput: boolean;
  errorActive: boolean;
}

/**
 * Pure function: given layout preset + current circuit/sim state, return
 * the set of panels that should be visible. Tests cover the full matrix;
 * keep this function side-effect free so it stays trivially testable.
 */
export function computeVisiblePanels(input: VisibilityInputs): VisiblePanels {
  const { preset, snapshot, result, hasTerminalOutput, errorActive } = input;

  if (preset === 'full') {
    return {
      circuit: true,
      bloch: true,
      histogramChip: false,
      histogramFull: true,
      terminal: true,
    };
  }

  if (preset === 'balanced') {
    return {
      circuit: true,
      bloch: true,
      histogramChip: Boolean(result),
      histogramFull: false,
      terminal: hasTerminalOutput || errorActive,
    };
  }

  // 'clean' — reveal driven entirely by what the user's code is doing.
  const hasGates = Boolean(snapshot && snapshot.gates.length > 0);
  const hasResult = Boolean(result);

  return {
    circuit: hasGates,
    bloch: hasResult,
    histogramChip: hasResult,
    histogramFull: false,
    terminal: hasTerminalOutput || errorActive,
  };
}

interface LayoutStoreState {
  preset: LayoutPreset;
  histogramChipDismissed: boolean;
  setPreset(p: LayoutPreset): void;
  dismissHistogramChip(): void;
  resetRunArtifacts(): void;
}

export const useLayoutStore = create<LayoutStoreState>((set) => ({
  preset: 'clean',
  histogramChipDismissed: false,
  setPreset: (preset) => set({ preset }),
  dismissHistogramChip: () => set({ histogramChipDismissed: true }),
  resetRunArtifacts: () => set({ histogramChipDismissed: false }),
}));
```

- [ ] **Step 2: Run the tests and verify GREEN**

```bash
npm test -- --run src/stores/layoutStore.test.ts
```

Expected: all 10 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/stores/layoutStore.ts src/stores/layoutStore.test.ts
git commit -m "feat(layout): layoutStore + computeVisiblePanels for progressive reveal"
```

---

## Task 5: Write `PanelReveal` tests (RED)

**Files:**
- Create: `src/components/layout/PanelReveal.test.tsx`

- [ ] **Step 1: Write the test file**

Create `src/components/layout/PanelReveal.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PanelReveal } from './PanelReveal';

describe('<PanelReveal>', () => {
  it('renders children when when=true', () => {
    const { queryByText } = render(
      <PanelReveal when={true}>
        <div>revealed</div>
      </PanelReveal>,
    );
    expect(queryByText('revealed')).not.toBeNull();
  });

  it('does not render children when when=false', () => {
    const { queryByText } = render(
      <PanelReveal when={false}>
        <div>hidden</div>
      </PanelReveal>,
    );
    expect(queryByText('hidden')).toBeNull();
  });

  it('applies translate origin class based on "from" prop', () => {
    const { container } = render(
      <PanelReveal when={true} from="right">
        <div>x</div>
      </PanelReveal>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute('data-reveal-from')).toBe('right');
  });

  it('respects prefers-reduced-motion by still rendering but skipping transition', () => {
    // We don't mock matchMedia at render time for this unit test; instead
    // we verify the component exposes a data attr the CSS can target.
    const { container } = render(
      <PanelReveal when={true}>
        <div>x</div>
      </PanelReveal>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute('data-reveal-root')).toBe('');
  });
});
```

- [ ] **Step 2: Verify `@testing-library/react` is installed**

```bash
grep -E "@testing-library/react" package.json || echo "NEEDS INSTALL"
```

If `NEEDS INSTALL`, install it as a dev dep:

```bash
npm i -D @testing-library/react
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
npm test -- --run src/components/layout/PanelReveal.test.tsx
```

Expected: FAIL with module not found (`Cannot find module './PanelReveal'`).

---

## Task 6: Implement `PanelReveal` (GREEN)

**Files:**
- Create: `src/components/layout/PanelReveal.tsx`
- Modify: `src/index.css` — add reveal transition CSS + reduced-motion guard

- [ ] **Step 1: Create the component**

Create `src/components/layout/PanelReveal.tsx`:

```tsx
import { type ReactNode, useEffect, useRef, useState } from 'react';

export type RevealFrom = 'right' | 'left' | 'bottom' | 'top';

interface PanelRevealProps {
  when: boolean;
  from?: RevealFrom;
  children: ReactNode;
}

/**
 * Conditionally mounts children with a fade + translate transition.
 * When `when` goes false, the child unmounts after the exit transition.
 * Translate direction is controlled by `from` (defaults to 'right').
 *
 * The transition itself lives in `src/index.css` keyed off the
 * `data-reveal-*` attributes so tests can verify structure without
 * depending on computed animation values.
 */
export function PanelReveal({ when, from = 'right', children }: PanelRevealProps) {
  const [mounted, setMounted] = useState(when);
  const [entered, setEntered] = useState(false);
  const exitTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (when) {
      if (exitTimeout.current) {
        clearTimeout(exitTimeout.current);
        exitTimeout.current = null;
      }
      setMounted(true);
      // Defer the 'entered' flag by one frame so the browser has a
      // chance to paint the pre-transition state.
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    setEntered(false);
    exitTimeout.current = setTimeout(() => setMounted(false), 160);
    return () => {
      if (exitTimeout.current) clearTimeout(exitTimeout.current);
    };
  }, [when]);

  if (!mounted) return null;

  return (
    <div
      data-reveal-root=""
      data-reveal-from={from}
      data-reveal-entered={entered ? '' : undefined}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Add reveal CSS to `src/index.css`**

Append after the existing `@keyframes` block:

```css
/* ── Panel reveal transitions (see PanelReveal.tsx) ── */
[data-reveal-root] {
  opacity: 0;
  transform: translate3d(0, 0, 0);
  transition: opacity 200ms cubic-bezier(0.16, 1, 0.3, 1),
              transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
  will-change: opacity, transform;
}
[data-reveal-root][data-reveal-from="right"]  { transform: translate3d(12px, 0, 0); }
[data-reveal-root][data-reveal-from="left"]   { transform: translate3d(-12px, 0, 0); }
[data-reveal-root][data-reveal-from="bottom"] { transform: translate3d(0, 12px, 0); }
[data-reveal-root][data-reveal-from="top"]    { transform: translate3d(0, -12px, 0); }
[data-reveal-root][data-reveal-entered] {
  opacity: 1;
  transform: translate3d(0, 0, 0);
}
@media (prefers-reduced-motion: reduce) {
  [data-reveal-root] {
    transition: none !important;
    transform: none !important;
    opacity: 1;
  }
}
```

- [ ] **Step 3: Run the test to verify GREEN**

```bash
npm test -- --run src/components/layout/PanelReveal.test.tsx
```

Expected: all 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/PanelReveal.tsx src/components/layout/PanelReveal.test.tsx src/index.css
# Also stage package.json / lock changes if @testing-library/react was installed:
git add -u package.json package-lock.json 2>/dev/null || true
git commit -m "feat(layout): PanelReveal animation wrapper"
```

---

## Task 7: Write `HistogramChip` tests (RED)

**Files:**
- Create: `src/components/histogram/HistogramChip.test.tsx`

- [ ] **Step 1: Write the test**

Create `src/components/histogram/HistogramChip.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HistogramChip } from './HistogramChip';

describe('<HistogramChip>', () => {
  it('renders nothing when result is null', () => {
    const { container } = render(<HistogramChip probabilities={null} />);
    expect(container.firstElementChild).toBeNull();
  });

  it('renders up to 3 bars, sorted by probability descending', () => {
    const { getAllByTestId } = render(
      <HistogramChip
        probabilities={{ '00': 0.5, '11': 0.5, '01': 0.001, '10': 0.001 }}
      />,
    );
    const bars = getAllByTestId('histogram-chip-bar');
    expect(bars).toHaveLength(3);
    // Labels expected on each bar
    expect(bars[0].textContent).toContain('|00⟩');
    expect(bars[0].textContent).toContain('50');
  });

  it('shows a dismiss button when onDismiss is provided', () => {
    const { getByLabelText } = render(
      <HistogramChip
        probabilities={{ '00': 1.0 }}
        onDismiss={() => {}}
      />,
    );
    expect(getByLabelText('Dismiss histogram')).not.toBeNull();
  });

  it('shows an expand button when onExpand is provided', () => {
    const { getByLabelText } = render(
      <HistogramChip
        probabilities={{ '00': 1.0 }}
        onExpand={() => {}}
      />,
    );
    expect(getByLabelText('Expand histogram')).not.toBeNull();
  });

  it('drops states below the epsilon threshold (1e-6)', () => {
    const { queryByText } = render(
      <HistogramChip
        probabilities={{ '00': 0.999999, '11': 0.0000001 }}
      />,
    );
    expect(queryByText(/\|11⟩/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- --run src/components/histogram/HistogramChip.test.tsx
```

Expected: FAIL with module not found.

---

## Task 8: Implement `HistogramChip` (GREEN)

**Files:**
- Create: `src/components/histogram/HistogramChip.tsx`

- [ ] **Step 1: Write the implementation**

Create `src/components/histogram/HistogramChip.tsx`:

```tsx
import { X, Maximize2 } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';

interface HistogramChipProps {
  probabilities: Record<string, number> | null;
  onDismiss?: () => void;
  onExpand?: () => void;
}

const EPSILON = 1e-6;
const MAX_BARS = 3;

export function HistogramChip({ probabilities, onDismiss, onExpand }: HistogramChipProps) {
  const colors = useThemeStore((s) => s.colors);
  if (!probabilities) return null;

  const entries = Object.entries(probabilities)
    .filter(([, p]) => p > EPSILON)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_BARS);

  if (entries.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 10px',
        background: `${colors.accent}0A`,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        fontSize: 11,
        fontFamily: "'Geist Sans', sans-serif",
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
        {entries.map(([state, p]) => (
          <div
            key={state}
            data-testid="histogram-chip-bar"
            style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}
          >
            <span
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                color: colors.accentLight,
                flexShrink: 0,
              }}
            >
              |{state}⟩
            </span>
            <div
              style={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                background: `${colors.accent}14`,
                overflow: 'hidden',
                minWidth: 20,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.round(p * 100)}%`,
                  background: colors.accent,
                  transition: 'width 200ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />
            </div>
            <span style={{ color: colors.textDim, width: 28, textAlign: 'right', flexShrink: 0 }}>
              {Math.round(p * 100)}%
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {onExpand && (
          <button
            aria-label="Expand histogram"
            onClick={onExpand}
            style={{
              background: 'transparent',
              border: 'none',
              color: colors.textDim,
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
          >
            <Maximize2 size={12} />
          </button>
        )}
        {onDismiss && (
          <button
            aria-label="Dismiss histogram"
            onClick={onDismiss}
            style={{
              background: 'transparent',
              border: 'none',
              color: colors.textDim,
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = colors.error; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run the test to verify GREEN**

```bash
npm test -- --run src/components/histogram/HistogramChip.test.tsx
```

Expected: all 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/histogram/HistogramChip.tsx src/components/histogram/HistogramChip.test.tsx
git commit -m "feat(histogram): compact inline HistogramChip variant"
```

---

## Task 9: Wire `PanelLayout` to `layoutStore` + reveal rules

**Files:**
- Modify: `src/components/layout/PanelLayout.tsx`

Current file structure lives at `src/components/layout/PanelLayout.tsx`. Key regions to touch:
- Imports
- Status bar: add `LayoutPresetSwitcher` component
- Main layout: replace the right-side stacked `CircuitRenderer` + `BlochPanel` panels so each is wrapped in `PanelReveal`, and the bottom panel's histogram tab is replaced by an inline `HistogramChip` beneath `BlochPanel`.

- [ ] **Step 1: Add imports**

At the top of `PanelLayout.tsx`, add:

```typescript
import { PanelReveal } from './PanelReveal';
import { HistogramChip } from '../histogram/HistogramChip';
import { useLayoutStore, computeVisiblePanels, type LayoutPreset } from '../../stores/layoutStore';
```

- [ ] **Step 2: Add a `LayoutPresetSwitcher` component in the same file**

Define this component below the existing `StatusBar` component:

```tsx
function LayoutPresetSwitcher() {
  const preset = useLayoutStore((s) => s.preset);
  const setPreset = useLayoutStore((s) => s.setPreset);
  const colors = useThemeStore((s) => s.colors);
  const platform = usePlatform();

  const options: LayoutPreset[] = ['clean', 'balanced', 'full'];
  const label = preset[0].toUpperCase() + preset.slice(1);

  const onChange = async (next: LayoutPreset) => {
    setPreset(next);
    try { await platform.setStoredValue('layout_preset', next); } catch { /* non-critical */ }
  };

  return (
    <select
      value={preset}
      onChange={(e) => onChange(e.target.value as LayoutPreset)}
      aria-label="Layout preset"
      title="Layout preset"
      style={{
        background: 'transparent',
        color: colors.textDim,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: '1px 6px',
        fontSize: 10,
        fontFamily: "'Geist Sans', sans-serif",
        cursor: 'pointer',
      }}
    >
      {options.map((o) => (
        <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 3: Render `LayoutPresetSwitcher` in the StatusBar**

Inside the existing `StatusBar` component, directly after the closing tag of the "Depth" span on the left side, add:

```tsx
      <LayoutPresetSwitcher />
```

(Place it immediately after the line that renders `Depth: {snapshot ? snapshot.depth : '—'}`.)

- [ ] **Step 4: Compute visibility at the top of the main `PanelLayout` render**

In the main `PanelLayout` component (the default export), near the top of the function body after the existing hook calls, add:

```tsx
  const preset = useLayoutStore((s) => s.preset);
  const layoutChipDismissed = useLayoutStore((s) => s.histogramChipDismissed);
  const dismissChip = useLayoutStore((s) => s.dismissHistogramChip);
  const resetRunArtifacts = useLayoutStore((s) => s.resetRunArtifacts);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const simResult = useSimulationStore((s) => s.result);
  const terminalOutput = useSimulationStore((s) => s.terminalOutput);
  const visible = computeVisiblePanels({
    preset,
    snapshot,
    result: simResult,
    hasTerminalOutput: terminalOutput.length > 0,
    errorActive: false,
  });
```

Note: if existing imports for `useCircuitStore`, `useSimulationStore` already exist, don't duplicate them — just reuse.

- [ ] **Step 5: Reset chip dismissal when a new run lands**

Also in the main `PanelLayout` function, after the visibility computation, add:

```tsx
  useEffect(() => {
    // When a fresh simulation result arrives, un-dismiss the chip so the
    // student sees the new probabilities by default.
    if (simResult) resetRunArtifacts();
  }, [simResult, resetRunArtifacts]);
```

- [ ] **Step 6: Wrap `CircuitRenderer` in PanelReveal**

Find the JSX where `<CircuitRenderer />` is rendered inside the right-side column. Wrap it:

```tsx
  <PanelReveal when={visible.circuit} from="right">
    <CircuitRenderer />
  </PanelReveal>
```

- [ ] **Step 7: Wrap `BlochPanel` in PanelReveal**

Same pattern for `<BlochPanel />`:

```tsx
  <PanelReveal when={visible.bloch} from="bottom">
    <BlochPanel />
  </PanelReveal>
```

- [ ] **Step 8: Replace bottom-panel histogram tab with chip**

In the bottom panel area where tabs for Terminal/Histogram/Dirac are defined, remove the Histogram tab. Leave Terminal only (Dirac still lives in the right-side panel). Replace the tab row's histogram content.

**Render the chip beneath BlochPanel instead:**

Immediately after the `<PanelReveal when={visible.bloch} from="bottom"><BlochPanel /></PanelReveal>` block, add:

```tsx
  <PanelReveal when={visible.histogramChip && !layoutChipDismissed} from="bottom">
    <div style={{ padding: '6px 10px 10px' }}>
      <HistogramChip
        probabilities={simResult?.probabilities ?? null}
        onDismiss={dismissChip}
      />
    </div>
  </PanelReveal>
```

- [ ] **Step 9: Restore full histogram when preset === 'full'**

Beneath (or in a dedicated tab — match existing structure), conditionally render the full `ProbabilityHistogram` only when `visible.histogramFull`:

```tsx
  <PanelReveal when={visible.histogramFull} from="bottom">
    <ProbabilityHistogram />
  </PanelReveal>
```

- [ ] **Step 10: Build to verify**

```bash
npm run build:web
```

Expected: `✓ built in …ms`.

- [ ] **Step 11: Run full unit test suite**

```bash
npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 12: Manual smoke via preview**

```bash
pkill -f "vite preview" 2>/dev/null; true
BUILD_TARGET=web nohup npx vite preview --outDir dist-web > /tmp/nuclei-preview.log 2>&1 &
until grep -q "Local:" /tmp/nuclei-preview.log; do sleep 1; done
grep "Local:" /tmp/nuclei-preview.log
```

Expected: `➜  Local:   http://localhost:4173/try/`

Then load the URL in a browser. Confirm manually:
1. On first load, no circuit panel / no Bloch / no histogram.
2. After typing `cirq.H(q0)` (or any gate) and waiting ~500ms, the circuit panel fades in from the right.
3. After clicking Run, Bloch appears beneath circuit, and an inline chip shows `|00⟩ 50%  |11⟩ 50%` below it.
4. Clicking the X on the chip dismisses it. Running again re-shows it.
5. Status bar now has a `Clean / Balanced / Full` dropdown. Switching to `Full` restores the bottom histogram panel.

- [ ] **Step 13: Commit**

```bash
git add src/components/layout/PanelLayout.tsx
git commit -m "feat(layout): progressive reveal + layout preset switcher + histogram chip"
```

---

## Task 10: Final validation + PR

- [ ] **Step 1: Run full test + build**

```bash
npm test -- --run && npm run build:web
```

Expected: all tests pass, web build succeeds.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feat/layout-foundation
```

Expected: branch published, GitHub prints `Create a pull request for ...` URL.

- [ ] **Step 3: Report URL to user**

Print the PR-creation URL GitHub returned so the user can open the PR. Do not merge to main from this plan.

---

## Spec coverage self-check

- Section 1 (Layout + panel lifecycle): Tasks 3-9 cover layoutStore + reveal rules + chip + preset switcher.
- Section 4 (Aesthetic tokens): Task 2 covers radii, surfaces, shadows.
- Section 5 (Implementation boundaries): Tasks 3-9 touch only the files in the spec's "New" and "Modified" lists.
- Section 7 (Testing): Tasks 3, 5, 7 cover unit tests for the three new components; Task 9 Step 12 covers the manual Playwright-equivalent smoke.

**Gaps explicitly deferred to later plans:**
- Typography weight 380 via Geist Variable — Plan 4 (tied to final polish pass once all AI surfaces land).
- Reduced-motion screen-reader audit — Plan 4.
- Automated Playwright smoke — Plan 4 (requires Playwright install).

---

## Out of scope for this plan

- Any AI behavior changes (narration, error rewrite, ghost, compose) — deferred to Plans 2-4.
- Light theme color updates — keep light untouched.
- Monaco theme changes.
