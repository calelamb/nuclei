# Developer tools — Phase 4: editor depth

**Status:** proposed · **Date:** 2026-07-15 · **Slice:** fourth of the phased developer-tools initiative

Phases 1–3 gave developers a transpiler explorer, an agentic copilot, and a
debugger. Phase 4 closes the loop on the user's original ask — *"the editor needs
to feel like an elite code editor where the UI feels responsive, and there's no
bugs"* — by fixing the two editor-**correctness** gaps that most break that
feel, both confirmed by the code map:

1. **Per-file editor state is not preserved.** There is exactly one Monaco model,
   controlled via `value={code}`. Switching tabs swaps the text through that one
   model, so **undo/redo is shared across all tabs** (undo can cross tab
   boundaries) and **cursor/scroll are not per file**. On top of that, switching
   to a Research takeover view (transpiler/experiments) **unmounts** the editor,
   destroying all Monaco state. An elite editor never loses your place.

2. **No real diagnostics or formatting.** The only Python feedback is a single
   kernel parse error (one `MarkerSeverity.Error` at a time). There is no linter,
   no formatter — `ruff` isn't even a kernel dependency.

This phase is scoped to those two. The other deferred items (wiring the dead
code-action provider, a real Cmd+K diff) are AI/polish, not editor correctness —
deferred with rationale below.

---

## P4.1 — Per-tab Monaco models + keep the editor mounted

**Goal:** each open file keeps its own undo history, cursor, scroll, and folding
— preserved across tab switches *and* across Research view switches.

### The two fixes are one story
- **Keep-mounted (was P0.4):** in `PanelLayout.tsx`, `<QuantumEditor/>` is the
  `else` arm of a ternary that swaps it out for the transpiler/experiments views
  (`PanelLayout.tsx:829-847`). Render the editor+viz area **always** and hide it
  with CSS (`display:none`) when a Research takeover is active, rather than
  unmounting. Monaco's `automaticLayout` relayouts on show. This alone stops the
  worst state loss (every transpiler/debugger visit currently nukes undo).
- **Per-tab models:** stop treating the editor as a single controlled buffer.
  Per-tab content already lives in `projectStore.tabs[].content`, so no store
  migration is needed — the work is Monaco-side.

### Approach (to prototype-validate first)
`@monaco-editor/react`'s `<Editor>` supports a **`path` prop**: with a distinct
`path` per tab it maintains a **model per path** and, with `saveViewState`
(default on) + `keepCurrentModel`, saves/restores per-path view state (cursor,
scroll, folding) and preserves each model's undo stack across switches.

- Pass `path={filePath ?? 'untitled'}` to `<Editor>`, keep `keepCurrentModel`.
- The controlled `value={code}` stays (kernel/Dirac/AI all read
  `editorStore.code`), but because `useActiveTabSync` sets `editorStore.code` to
  the new tab's content *as* `filePath` changes, `value` already matches the
  switched-in model — so `@monaco-editor/react` does **not** call `setValue`, and
  the model's undo history survives. External edits (Dirac insert, file drop)
  still flow through `setCode` → the active model.
- **Prototype gate:** before building, confirm in a throwaway that (a) undo does
  not cross tabs, (b) cursor/scroll restore per tab, and (c) a Dirac
  `insert_code` still lands. If the controlled-`value` + `path` combo fights
  undo, fall back to manual model management (`monaco.editor.createModel` per
  path + `editor.setModel` on switch + explicit `saveViewState`/`restoreViewState`),
  which the map confirms is not present today.
- Preserve the extension→framework inference currently in
  `useActiveTabSync.ts:44-55` (per-tab language must still follow the file).
- Dispose models when a tab is **closed** (not on view switch) to avoid a leak
  as sessions accumulate tabs.

### Tests
- `useActiveTabSync` / interaction test: switching tabs and back preserves the
  second tab's content and does not merge undo (assert via the store bridge +
  a mocked editor exposing per-model undo, mirroring `qsharpLanguageService.test`'s
  mock-monaco pattern).
- A PanelLayout test that toggling a Research takeover view does not unmount the
  editor (the editor node persists in the tree).

---

## P4.2 — Python diagnostics + formatting via ruff

**Goal:** real, fast Python linting (warnings/errors inline) and one-keystroke
formatting — the table stakes of an "elite editor" — powered by
[`ruff`](https://docs.astral.sh/ruff/), which does both.

### Kernel (additive, mirrors the `transpile`/`debug_trace` message pattern)
- Add `ruff` to `kernel/requirements.txt` (new dependency; it's a single fast
  binary wheel).
- **`lint`** → `lint_result`: run `ruff check --output-format json -` over the
  code (stdin), off-thread, and return a diagnostics array
  `[{line, column, end_line, end_column, severity, code, message}]`. Ruff absent
  → an empty result with a one-time note, never an error that blocks typing.
- **`format`** → `format_result`: run `ruff format -` (stdin→stdout) and return
  `{formatted: string}` (or unchanged text if ruff is absent). Errors via
  `error_payload(error, "format")`.
- Both Python-only; other languages get an empty/declined result. (Q# already has
  its own compiler diagnostics via the QDK language service — untouched.)

### Frontend
- **A new `'ruff'` marker owner** (independent of the existing `'nuclei'` kernel-
  error owner, so they coexist — the map confirms owners don't collide). A small
  effect sets ruff markers from a `lintStore`, with real `MarkerSeverity`
  (Warning/Info, unlike the Error-only kernel path) and true ranges.
- Extend `EditorError` (or a new `Diagnostic` type) with `column`/`endLine`/
  `endColumn`/`severity` — the current type is line+message only
  (`editorStore.ts:4-7`).
- Debounced `lint` request on code change (reuse the parse-debounce cadence),
  desktop-only via the existing sender pattern (`transpileSender` sibling).
- **Formatting:** `registerDocumentFormattingEditProvider('python', …)` that
  round-trips the buffer through the `format` message (so `⇧⌥F` / the command
  palette "Format Document" works), plus an **opt-in format-on-save** setting
  wired into the existing save path (`getFileOps`).

### Tests
- Kernel: pytest for `lint` (a file with an obvious ruff violation returns a
  diagnostic with the right line/severity; clean code returns none) and `format`
  (unformatted → formatted; idempotent on already-formatted; ruff-absent
  passthrough). Guard with an availability check so CI without ruff still passes,
  or add ruff to the kernel test env.
- Frontend: pure mapper (ruff JSON → Monaco markers) unit-tested; a formatting-
  provider test that it returns the kernel's formatted text as a full-range edit.

---

## Non-goals (this slice, with rationale)

- **Wiring the dead code-action provider (`quantumCodeActions.ts`).** It's
  snapshot-driven and every action is `requiresApi` with `edit:null`, routing to
  Dirac — so it's an *AI feature*, not editor correctness, and its
  `'nuclei.codeAction'` command has no handler. It belongs with Dirac work, not
  this editor-correctness phase.
- **A real Cmd+K inline diff.** Polish; the existing `DiffPreview.tsx` (chat
  compose) is a reusable surface for it later. Cmd+K already applies edits
  correctly today — only its *preview* is a raw block.
- **A full Python language server (LSP)** — ruff covers lint+format at a fraction
  of the complexity; a pyright/pylsp integration is a much larger, separate bet.

## Sequencing

1. **P4.1** per-tab models + keep-mounted — prototype the `path`-prop approach
   first, then build + test. Land first (pure frontend, highest felt impact).
2. **P4.2** ruff lint + format — kernel messages + dependency, then the frontend
   markers/formatting.

Likely **2 PRs**. P4.1 is the riskier one (Monaco model lifecycle) and gets the
prototype gate; P4.2 is additive and lower-risk. Docs: an editor/diagnostics note
if warranted; the `lint`/`format` messages in the kernel-API + protocol changelog.
