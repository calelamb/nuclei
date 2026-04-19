# Nuclei — AI-Native Progressive Reveal

**Status:** approved design, ready for implementation plan
**Date:** 2026-04-18
**Owner:** Cale Lamb

## Positioning

Beginner-first quantum computing IDE where AI is proactive across four surfaces, visualization panels are signal-only (never chrome), and expert power lives under progressive disclosure. Cursor aesthetic, QC depth. Primary audience remains students in their first quantum computing course, per `CLAUDE.md`.

## Constraints locked during brainstorming

- **Audience:** beginners stay primary. Expert features live under a progressive-disclosure toggle.
- **AI surfaces:** all four (ghost completion, error rewrite, narration, agentic compose) are implemented and individually togglable. Defaults are beginner-safe: ghost OFF, narration ON, error rewrite ALWAYS ON, compose always available.
- **Aesthetic:** Cursor-minimalist — softer corners, softer fonts, more breathing room, reduced hard contrast.
- **Histogram demotion:** histogram is not worth a dedicated panel. It becomes an inline 2-bar chip strip that appears only after a run.

## Non-goals

- Light theme refactor (use existing)
- Monaco theme deep customization (keep current)
- Multi-file projects
- Dirac memory / student model (Phase 5+)
- Real quantum hardware integrations (Phase 7)
- Unified canvas / scene-graph visualization (deferred V2 ambition)

---

## 1 — Layout and panel lifecycle

### Default view

```
┌─────┬─────────────────────────────────┬──────────────┐
│ Act │          Editor (full)          │ Dirac chat   │
│ Bar │                                 │ ~320 px      │
│ 48  │                                 │              │
└─────┴─────────────────────────────────┴──────────────┘
```

No circuit pane, no Bloch sphere, no histogram. Student sees only what they are actively working with.

### Reveal rules

Driven by a new `layoutStore` that derives panel visibility from circuit and simulation state. Components read visibility flags and animate accordingly.

| Panel | Reveal trigger | Collapse trigger |
|---|---|---|
| Circuit pane | `snapshot !== null && snapshot.gates.length > 0` | code goes empty again |
| Bloch sphere | first successful `SimulationResult` received | manual only |
| Histogram chip strip | first successful `SimulationResult` | manual dismiss or new run |
| Terminal | `output.length > 0 OR error received` | 3000 ms after success with no new output |

### Motion

- Panel reveal: fade + translate, 200 ms, `cubic-bezier(0.16, 1, 0.3, 1)`. Translate origin is the nearest edge: right-side panels slide 12 px from the right, the terminal slides 12 px from below. `opacity: 0 → 1`.
- Panel collapse: mirror of reveal, 160 ms, same curve.
- Sibling panels that must resize to accommodate a reveal animate `flex-basis` on the same 200 ms curve so nothing snaps.
- Reduced-motion: honor `prefers-reduced-motion: reduce` by replacing all transitions with instant state changes.

### Histogram compact variant

`ProbabilityHistogram` gains a `compact` prop. Compact form:
- 2–3 bars maximum (top outcomes by probability)
- Inline horizontal row, ~32 px tall
- No axis labels — just `|state⟩ %` and a small bar
- Rendered beneath the Bloch sphere inside the right pane, not a separate tabbed panel
- "Expand" icon swaps the chip for the full histogram if the student wants detail

### Layout presets

A `Layout` dropdown in the status bar gives users an escape hatch to pin things open:

- `Clean` (default): everything driven by reveal rules
- `Balanced`: circuit + Bloch always visible, histogram still chip-only
- `Full`: all panels persistent, bottom tab row restored (expert/preview mode)

Preset choice persists in `platform.setStoredValue('layout_preset', ...)`.

---

## 2 — Agentic Dirac (Composer parity)

### Entry points

- Chat message that the compose classifier scores as code-generation intent
- Explicit slash prefix: `/compose`, `/fix`, `/explain`
- Keyboard: **⌘I** opens a quick-ask modal anchored above the editor

### Composition flow

1. Classifier routes intent:
   - Code generation → compose flow (Sonnet + tools)
   - Explanation / Q&A → existing Dirac chat flow (Haiku for fast)
2. Compose flow calls Claude Sonnet 4.6 with tool access:
   - `insert_code(code: string, mode: 'replace' | 'append' | 'insert_at_cursor')`
   - `run_simulation()`
   - `highlight_gate(gate_index: number)`
   - `explain_concept(concept: string)`
3. System prompt includes current code, detected framework, circuit snapshot, visible panels, kernel status, and the last 5 narration events (time-ordered, newest last)
4. Code result is surfaced as an **inline diff overlay** above / under the affected region of the editor. The editor buffer is NOT mutated until acceptance.
5. Student hits **Enter** to accept, **Esc** to reject, **R** to request a revision ("more concise," "use different gates," etc.)
6. On accept: diff applies via Monaco edit operation, circuit panel reveals if it was hidden, optional auto-run if the compose explicitly requested it
7. Dirac posts a narration message: *"Here's a GHZ state — H on q0 creates superposition, CNOTs entangle q1 and q2."*

### Diff overlay UI

- Added lines: green-tinted background (accent hue at 12% opacity)
- Removed lines: red-tinted background
- Unchanged context: no tint
- Thin footer bar: `Accept ↵   Reject ⎋   Revise R   diff by Dirac`
- Can be dragged vertically if it covers code the student wants to see

### Safeguards

- If editor is dirty, compose that would replace large regions asks "Replace current buffer? You have unsaved changes."
- Maximum generated length: 200 lines — beyond that, compose refuses with "That's a big ask — try breaking it into smaller steps, or use Settings → Expert to raise the limit."
- Rate limit: 10 composes / hour in beginner mode, unbounded in expert mode.

---

## 3 — Four AI surfaces, one attention budget

| Surface | Trigger | Beginner default | Visual |
|---|---|---|---|
| Ghost completion | 400 ms debounce since last code change (not last keystroke) | off | grey inline text, Tab to accept, Esc to dismiss |
| Error rewrite | kernel emits error message | always on | replaces Python traceback with concept-level explainer + "Fix" button |
| Narration | successful parse or run | on | dim one-liner in Dirac sidebar + terminal: *"q0 is now in superposition"* |
| Compose / agent | ⌘I, chat intent, or slash prefix | always available | inline editor diff overlay, accept/reject |

### Coordination rules

- Only one "active" surface at a time to avoid attention noise
- If compose is generating, narration queue pauses
- If an error is mid-rewrite, ghost completions dim to 30% opacity
- Ghost completions suppress themselves during an active selection edit (⌘K)
- All toggles live under **Settings → AI**: global master toggle, per-surface toggle, per-surface model (Haiku vs Sonnet)

### Telemetry hooks

Emit a local event per surface invocation so future analytics / skill model can observe usage:
- `ai:ghost:shown`, `ai:ghost:accepted`, `ai:ghost:rejected`
- `ai:error:rewritten`, `ai:error:fix_clicked`
- `ai:narration:emitted`
- `ai:compose:requested`, `ai:compose:accepted`, `ai:compose:rejected`, `ai:compose:revised`

No network transmission unless the user opts into telemetry later.

---

## 4 — Aesthetic tokens (Cursor-minimalist)

Extend the existing `tokens.ts` / `tokens.css` from the A1 branch.

### Radii

| Element | Old | New |
|---|---|---|
| Chips, buttons, small inputs | 6 px | 10 px |
| Cards, panels | 4 px | 12 px |
| Modals | 8 px | 16 px |

### Spacing (gap scale)

Existing scale scales up ~30% to create more breathing room:

| Old | New |
|---|---|
| 4 | 6 |
| 6 | 8 |
| 12 | 16 |
| 16 | 20 |
| 24 | 28 |

### Typography

- UI font: Geist Variable. Default body weight shifts from 400 to 380 for a softer read.
- Code: JetBrains Mono, unchanged.
- Heading letter-spacing: -0.01em on 18–24 px, -0.02em above.
- Label letter-spacing: +0.04em for uppercase labels (status bar, sidebar headings).

### Color surfaces

- Dark background: shift from navy `#0F1B2D` to near-black with low chroma `oklch(14% 0.008 250)`. Reads softer, still in the same family.
- Elevated surface: `oklch(18% 0.01 250)`
- Border default: `oklch(95% 0 0 / 0.08)` — semi-transparent, dissolves hard edges
- Border strong: `oklch(95% 0 0 / 0.16)`
- Accent (teal): keep hue, drop saturation to 85% of current
- Secondary accent (violet for Dirac): saturation 60% of current

### Motion

- Panels: 200 ms `cubic-bezier(0.16, 1, 0.3, 1)`
- Hover: 120 ms ease-out
- Focus ring: instant appear, 80 ms fade-out
- No layout thrash: if a panel reveal changes sibling widths, sibling animates on the same curve

---

## 5 — Implementation boundaries

### New files

- `src/stores/layoutStore.ts` — Zustand store holding panel visibility, preset, motion prefs. Derived state via subscriptions to `circuitStore` and `simulationStore`.
- `src/components/layout/PanelReveal.tsx` — animation wrapper component (`<PanelReveal when={...}>`).
- `src/components/dirac/ComposeModal.tsx` — ⌘I quick-ask modal.
- `src/components/editor/DiffOverlay.tsx` — Monaco overlay that renders a proposed diff and handles accept / reject / revise.
- `src/components/histogram/HistogramChip.tsx` — compact inline histogram variant.
- `src/services/compose.ts` — Claude tool-use orchestration for compose flow. Streams tokens.
- `src/services/narration.ts` — pure function from `{code, snapshot, result}` to a short narration string. Haiku-powered.
- `src/services/classify.ts` — lightweight classifier that routes chat messages to compose vs explain.

### Modified files

- `src/components/layout/PanelLayout.tsx` — reads from `layoutStore`, drops bottom-panel histogram tab, defers to PanelReveal for animations.
- `src/components/histogram/ProbabilityHistogram.tsx` — add a `compact` prop switching to HistogramChip rendering.
- `src/hooks/useKernel.ts` — emit narration events (snapshot received, result received, error received) for the narration service to consume.
- `src/components/dirac/DiracSidePanel.tsx` — consume narration stream, add compose request flow, show one-liner narration messages.
- `src/stores/settingsStore.ts` — add `ai.ghost.enabled`, `ai.narration.enabled`, `ai.errorRewrite.enabled` flags with beginner-safe defaults.
- `tokens.ts` / `tokens.css` — radii, spacing, typography, surface updates.

### State machine changes

`layoutStore.getVisiblePanels()` returns:

```ts
interface VisiblePanels {
  circuit: boolean;       // gates.length > 0 OR preset.forces
  bloch: boolean;         // had a result OR preset.forces
  histogramChip: boolean; // had a result OR preset.forces
  histogramFull: boolean; // preset === 'full'
  terminal: boolean;      // has output OR preset.forces OR within 3s of error
}
```

### Compatibility

- Keeps existing panel logic for preset `Full` so experts who currently rely on the 3-panel default aren't regressed.
- Existing `CircuitRenderer`, `BlochPanel`, `ProbabilityHistogram` stay — they just gain reveal wrappers.
- Desktop build unaffected by classifier / compose services; they live in `services/` and are called from Dirac components.

---

## 6 — Error handling and graceful degradation

Every AI surface must survive its own failure without breaking the rest of the app.

| Failure | Behavior |
|---|---|
| Ghost completion API down or rate-limited | completion silently skipped; no UI change; console warn only |
| Error rewrite call fails | fall back to raw Python traceback with a small "Try explain again" link |
| Compose call fails | diff overlay shows error text; editor buffer unchanged; "Retry" button |
| Narration call fails | narration skipped for that event; kernel result still renders as normal |
| Classifier fails | default to "explain" flow (existing chat behavior) |
| Missing API key | all surfaces except error rewrite degrade cleanly with "Set API key in Settings" prompts; ghost stays off |

Rule: "the app still works without me" for every AI path. If the network is out, Nuclei is still a working local Pyodide IDE.

---

## 7 — Testing

### Playwright smoke

- Cold-load `/try/`
- Wait for Pyodide + Cirq ready
- Assert editor visible, Dirac visible, circuit panel NOT visible
- Type a Cirq `H` gate
- Assert circuit panel fades in within 1 s
- Click Run
- Assert histogram chip appears below Bloch
- Assert probabilities match expected Bell-state distribution (within sampling tolerance)

### Unit

- `layoutStore.getVisiblePanels` — table-driven: given snapshot and result state, assert expected visibility
- `compose` service — mock Claude API, assert tool calls are invoked in the expected order
- `classify` service — a handful of example prompts per class, assert routing
- `narration` service — given known fixtures, assert sentence shape

### Visual regression

- Screenshot three presets (`Clean` / `Balanced` / `Full`) at three breakpoints (1280, 1440, 1920)
- Both themes if light is enabled

### Accessibility

- Tab order is preserved across dynamically-revealed panels
- Reduced-motion honored
- Screen-reader labels on Dirac compose actions and diff overlay buttons

---

## Open questions (answer before implementation plan)

- **Streaming or block-and-render for compose?** Streaming feels more Cursor-like but adds complexity to the diff overlay. Recommend block-and-render for v1.
- **Ghost model: Haiku or Sonnet?** Haiku is fast enough; Sonnet is smarter. Recommend Haiku for v1 and measure acceptance rate before deciding.
- **Classifier: regex + prompt scoring or dedicated Haiku call?** Recommend a thin regex for slash prefixes + keyword heuristic; fall back to a Haiku call if inconclusive.

These are calls I can make during planning if you don't want to answer them now.
