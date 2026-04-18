# Nuclei Polish System — Design

**Date:** 2026-04-18
**Status:** Approved
**Scope:** App surface only (desktop-biased, both desktop and web supported). No landing page, no new features.

## Goal

A rolling polish backlog that makes Nuclei feel *intentionally designed* and *responsive to the touch*, worked one sitting at a time, without locking into a monolithic redesign. Visual-first, with behavioral gains as a byproduct.

## Non-goals

- **No behavior overhaul of Dirac.** Ghost completions, Cmd+K inline edit stay on the Phase 5 roadmap. Dirac stays a side panel this pass.
- **No new features.** If a PR adds a capability, it belongs in a different plan.
- **No dependency churn.** Keep Vite / Tauri / Monaco / R3F / Zustand. Design system is CSS tokens + small utility primitives, not a UI library swap.
- **No landing-page / marketing work.** App surface only.
- **No Bloch re-litigation for cosmetic reasons.** It just shipped. If a token pass touches it, it's incidental — no redesigns.

## Shape

Two parallel tracks. Pull from either one per sitting; never mix in one PR.

- **Track A — Design System.** A coherent visual system (tokens + a few primitives) applied surface by surface.
- **Track B — Responsiveness.** Measure, then fix perceived-latency hotspots.

Each sitting produces one small, single-purpose PR.

---

## Track A — Design System

### v1 design system

A single `src/styles/tokens.css` plus a handful of primitives under `src/components/ui/`. Monaco themes read from these tokens.

**Tokens.**

- **Color** — surfaces (`base` / `raised` / `overlay` / `sunken`), text (`primary` / `secondary` / `tertiary` / `disabled`), borders (`subtle` / `strong`), accents (quantum teal, Dirac purple, success, warning, danger), semantic kernel-status colors. Both themes, one file.
- **Depth** — shadow scale (`sm` / `md` / `lg`) + a `backdrop-blur` recipe for frosted surfaces (Dirac, command palette, modals).
- **Motion** — durations (`fast` 120ms / `normal` 200ms / `slow` 360ms), easings (`standard`, `emphasized-out`, `emphasized-in`), one "tactile press" recipe.
- **Spacing** — `4 / 8 / 12 / 16 / 20 / 24 / 32 / 48`, mapped to chrome-dense vs content-breathing contexts.
- **Typography** — role-based scale (`display` / `title` / `body` / `code` / `caption` / `chrome-label`) mapping Geist Sans + JetBrains Mono with intentional weights. Replace raw `fontSize: 13`-style values.
- **Radius** — `sharp` / `soft` / `round` / `pill`, applied consistently.

**Primitives** (`src/components/ui/`).

- `<Surface elevation>` — panel/card with deliberate elevation + border treatment.
- `<PanelChrome>` — top-of-panel header row with consistent height and typography.
- `<IconButton>` — consistent hit area, hover/focus/active states.
- `<StatusDot>` — semantic-color indicator.
- `<Empty>` — designed empty state for panels with nothing in them.

### Backlog (A1 is blocking; A2–A12 consume tokens and are otherwise independent)

1. **A1 — Token extraction.** `tokens.css` as single source of truth (both themes). Delete scattered inline hex/rgb/px across `src/`. Wire `monacoThemes.ts` to read from tokens.
2. **A2 — Typography pass.** Every chrome string on the role scale. No more raw `fontSize`/`fontWeight` literals in JSX.
3. **A3 — Surface depth pass.** Each panel gets a deliberate elevation + 1px border treatment. Kill mystery-surface-under-surface layering.
4. **A4 — Splash → loaded-app handoff.** Rewrite `SplashScreen` with tokens. Dissolve into real chrome. No cold cut, no layout jump.
5. **A5 — Activity bar + Sidebar.** Consistent widths, hit areas, hover/selected affordances.
6. **A6 — Editor tabs + breadcrumbs.** Dense, breathable, unambiguous active state.
7. **A7 — Status bar.** De-noise, cluster, semantic kernel-status color.
8. **A8 — Command palette.** Promote as the product's spine: result rows, section headers, keystroke chips, backdrop blur.
9. **A9 — Dirac panel.** Align to system (radius, typography, message density). Stays a side panel this pass.
10. **A10 — Empty states.** Every panel that can be empty gets a real designed empty state.
11. **A11 — Menus + modals.** Shortcuts, onboarding, settings — all on the same material.
12. **A12 — Monaco theme polish.** Selection, cursor, gutter, indent guides, diagnostics all reading from tokens.

---

## Track B — Responsiveness

### Principle

Measure first, fix second. The perf HUD ships before we start tuning.

### Backlog (B1 is blocking for B6/B7/B10; B2–B5 and B8/B9/B11/B12 independent)

1. **B1 — Dev-only perf HUD.** A keyboard chord (e.g. Cmd+Shift+Backtick) toggles an overlay showing FPS, kernel round-trip p50/p95, last render time per panel, bundle chunk load times. Ship this first.
2. **B2 — Splash → skeleton handoff.** Stop blocking on `loadBridge()`. Render chrome skeleton on first paint; bridge and kernel resolve behind a fading overlay. No "all or nothing" splash cut.
3. **B3 — Monaco local bundling + preload.** Pin `monaco-editor` via `loader.config` to local chunks (no CDN). Warm in parallel with bridge init. Replace "Loading…" with an editor-shaped skeleton.
4. **B4 — Code-split heavy surfaces.** Lazy-load Bloch (R3F stack), Histogram, Dirac, Command Palette, Onboarding, Shortcuts modal, Settings. Idle-time prefetch after first paint (`requestIdleCallback`).
5. **B5 — Kernel handshake states.** Binary `disconnected / connected` → `connecting → handshaking → ready → idle`. Dot animates, status bar reads truthful state.
6. **B6 — Debounce tuning by measurement.** Current 300ms code→kernel debounce is a guess. Measure p50/p95 parse. Target visible-feedback budget <150ms. Separate "lightweight parse for snapshot" from "full simulation on Cmd+Enter."
7. **B7 — Zustand selector audit.** Shallow selectors and per-slice subscriptions so typing doesn't re-render the whole right-hand panel column.
8. **B8 — R3F persistence across tab switches.** Keep Bloch canvas mounted, hide via CSS when off-screen. Pair with `frameloop="demand"` when idle.
9. **B9 — CSS containment on panels.** `contain: layout paint` on each panel root.
10. **B10 — Bundle slim pass.** Treeshake audit. Replace `recharts` with a ~60-line D3 histogram (D3 already in deps). Defer `maath` + `@react-three/postprocessing` until Bloch is visible. Target main chunk <200KB gz.
11. **B11 — Command palette latency.** Input→filter on `requestAnimationFrame`, virtualize results list over 30 items, precompile fuzzy-match scorer once.
12. **B12 — Stale-while-revalidate for snapshots.** Keep the last valid `CircuitSnapshot` on screen while the next one parses, instead of flashing empty/loading state.

---

## Workflow

Each sitting:

1. Pick one item from Track A *or* Track B — not both in one PR.
2. Branch named `polish/a<N>-<slug>` or `polish/b<N>-<slug>`.
3. Single-purpose diff. No drive-by refactors. No new features.
4. PR description includes:
   - For Track A: before/after screenshot of the affected surface (both themes if both change).
   - For Track B: perf HUD screenshot before/after, or a measured number (ms, KB, fps).
5. Tick the item in this spec. Add a one-line learning note if something surprised us.
6. Commit → PR → merge. Next sitting picks the next item.

**Scope guardrail.** If an item balloons past ~4 hours, stop and split. "Apply tokens to Sidebar" is one sitting; "redesign Sidebar" is not.

**Starting sequence.** A1 → B1 → A2. After that, pull by energy/mood.

**Dependencies.**
- A1 blocks A2–A12 (they consume tokens).
- B1 blocks B6, B7, B10 (they need measurements).
- Everything else independent.

---

## Acceptance per item

An item is "done" when:

- **Track A items:** the affected surface reads from the token system only; zero inline hex / px / rgb in that surface's source; before/after screenshot in PR shows a visible-to-the-eye improvement without regression in the other theme.
- **Track B items:** the specific metric (ms, KB, fps, re-render count) improved by a measurable, PR-documented amount. No regression on unrelated metrics per the perf HUD.

---

## Out of scope (explicitly deferred)

- Ghost completions, Cmd+K inline edit (Phase 5).
- Real hardware integration (Phase 7).
- Community / gallery / profiles (Phase 7).
- Landing-page polish.
- Any i18n work beyond what already exists.
- Accessibility overhaul beyond what's incidentally fixed when tokens land (focus rings, contrast).

When the backlog is exhausted, re-brainstorm a v2. Do not auto-extend this spec.
