# Changelog

All notable changes to Nuclei will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.0] - 2026-07-15

Developer-tools release, part two: the Dirac agent becomes a developer copilot,
and step-through becomes a real Quantum Debugger.

### Added — Quantum Debugger

- **Step through a circuit and see the quantum state at each gate.** The
  existing step-through cursor (Prev/Next/Play, Dirac's `step_to`) now drives
  real state inspection: the **Bloch sphere** and **histogram** show the state
  *at the cursor* — each qubit's Bloch vector and the probability distribution
  after the highlighted gate. Qiskit and Cirq.
- The whole per-gate trajectory is computed in one kernel call on entering step
  mode, then cached, so scrubbing back and forth is instant.

### Added — Dirac dev-copilot

- A **developer persona** for the autonomous agent: Research-mode runs get a
  terse expert-peer voice (Learn mode keeps the original). Every safety rule and
  the verify-first discipline are retained.
- A **`transpile_explore` agent tool** — Dirac can now inspect the transpiler's
  pass-by-pass behavior (which passes added the routing SWAPs), not just the
  headline metrics, so it can explain *why* a circuit grows for a device.

### Added — Kernel protocol (additive)

- `debug_trace` → `debug_trace_result`: the per-gate state trajectory (Qiskit /
  Cirq, bounded to 12 qubits / 200 gates). See the
  [protocol changelog](https://getnuclei.dev/docs/reference/protocol-changelog/).
- `transpile_explore` agent worker action, mirroring the `transpile` action's
  Qiskit-only rules.

## [0.11.0] - 2026-07-14

The first developer-tools release: a Transpiler Explorer that shows exactly what
the compiler does to a circuit, plus editor-responsiveness fixes.

### Added — Transpiler Explorer

- **"godbolt.org for quantum"**: a Research-mode **Transpiler** view that
  transpiles the editor's circuit for a target device and shows it **before vs.
  after, pass by pass** — with the routing SWAPs and basis rewrites attributed
  to the pass that added them. The passes that add entangling gates are
  highlighted (the "why did my two-qubit count triple on hardware" answer).
  Qiskit-only (the only framework with an introspectable compiler).
- Controls (target device + optimization level 0–3) live in the sidebar; the
  before/after visualization is a main-area view. Target basis gates and
  coupling map come from any connected hardware backend, or the all-to-all
  simulator default.

### Added — Kernel protocol (additive)

- New `transpile` message → `transpile_result`: runs a Qiskit preset
  `PassManager` with a per-pass callback that diffs consecutive DAGs. Returns
  before/after `CircuitSnapshot`s, depth/two-qubit/gate-count deltas, and
  pass-by-pass data. Non-Qiskit circuits get a `transpile_unsupported_framework`
  error. See the [protocol changelog](https://getnuclei.dev/docs/reference/protocol-changelog/).

### Fixed — Editor responsiveness

- Closing an unsaved file from the Open Files sidebar now raises the
  unsaved-changes dialog instead of silently discarding the buffer.
- Ghost completions are debounced and send only a window around the cursor
  (not the whole file), and the inline-completion provider registers once.
- The editor subtree re-renders only on the fields it uses, cutting churn.

## [0.10.0] - 2026-07-14

A QEC Studio release: the detector graph is faster, far more visual, and now
interactive — plus the groundwork (and shipping WASM) for research-scale codes.

### Added — Interactive decoder

- An **Interactive** mode on the detector graph: click detectors to build a
  syndrome and watch a decoder re-solve the matching **instantly, in-app**, with
  no kernel round-trip — a live "what would the decoder do, and is it a logical
  error?" tool. Runs a Rust decoder compiled to WebAssembly; complements the
  accurate kernel "Sample a shot" path (PyMatching), it doesn't replace it.

### Added — Render arbitrarily large detector graphs

- Graphs too big for the render cap can now be drawn **in full, client-side**:
  the kernel forwards the flattened DEM text (only when truncated), and a WASM
  parser renders the whole thing with no edge cap. Falls back to the kernel path
  if the accelerator isn't available.

### Changed — Detector graph is a canvas now

- The detector graph renders on a **canvas** instead of thousands of SVG lines —
  it scales smoothly to tens of thousands of edges. Edges are **heat-colored and
  weighted by error probability** (fragile "hotspots" glow), boundary edges are
  dashed, observable-flipping edges carry an accent, and **hovering a detector**
  inspects it. A legend explains the encoding.

### Performance

- Building the detector graph on the kernel is **~2.6× faster** on large codes
  (parse Stim's DEM text instead of walking the model object-by-object) — the
  live-edit path no longer stalls on a distance-11 surface code.

## [0.9.0] - 2026-07-14

A major upgrade to the practice challenges (the "quantum LeetCode"): solutions
are now graded on the actual quantum state and scored on efficiency, and the
algorithm problems can no longer be cheated by hardcoding the answer.

### Added — Efficiency metrics & ★ tiers

- Every accepted circuit submission now gets a **performance panel**: two-qubit
  (entangling) gate count and circuit depth as the headline hardware-cost
  metrics, plus total gates, qubits, and execution time.
- Problems can define an optimal **par**; a solution is tiered Optimal /
  Efficient / Accepted, and hitting every target earns a **★** shown in the
  panel, the problem list, and submission history.

### Added — State-fidelity grading

- New `state_fidelity` grading compares your prepared quantum state to a hidden
  reference (`|⟨reference|solution⟩|²`), so phase and entanglement matter — a
  hardcoded product state can't fake an entangled or phase-specific target.
- **Bell State** now requires the exact requested state (Φ⁺ vs Φ⁻ are
  distinguished); **Uniform Superposition** likewise.

### Added — GHZ and W state challenges

- **GHZ State** (fidelity-graded, honest n−1 entangling-gate par) and **W State**
  (fidelity-graded) — genuinely multi-qubit entanglement, ungameable.

### Added — Oracle-injection (query model)

- **Bernstein–Vazirani, Grover, and Simon** now hand you an opaque **oracle**
  instead of the secret, so you must *query* it rather than read the answer;
  the secret varies across hidden tests. Graded by state fidelity, scored on
  **oracle queries** (BV/Simon single-query, Grover ⌊π/4·√N⌋).
- A green **"State-verified"** badge marks challenges graded this way, so it's
  clear which ★ can't be gamed.

### Fixed

- Per-test scores read as a true 0–100% (a passing case shows 100%, not its
  weight); QKD problems show the correct value contract; a kernel-boot spinner
  replaces the silent first-run hang.

## [0.8.1] - 2026-07-14

A UX and accessibility patch: several dialogs, chips, and forms got the polish
they were missing.

### Fixed

- **Modals** can now be dismissed with **Escape** — the hardware credential
  prompt, the unsaved-changes guard (Escape maps to Cancel, never a destructive
  discard), the framework setup, keyboard shortcuts, and the noise-model
  library.
- The **hardware credential dialog** no longer renders *behind* the update
  banner or command palette; its help text is a real link and its inputs are
  announced by screen readers.
- **Long names no longer overflow**: backend ids in the selector, experiment /
  campaign names in the status bar (which could push the kernel and theme
  controls off-screen), and the launcher's active-file pill now truncate.
- **Keyboard navigation**: run-history rows, community circuit cards, glossary
  entries, and the launcher's drop zone are now focusable and activate with
  Enter/Space; search fields are labeled for screen readers.
- The **shots field** in the launch dialog can be cleared and retyped instead of
  snapping to 1 on the first keystroke.
- A **blank Seed or sweep-range** field in a new experiment is now flagged
  instead of silently becoming 0.
- The hardware **jobs panel** no longer blanks out if the kernel reports an
  unexpected job status.

## [0.8.0] - 2026-07-14

A features-and-polish release on top of QEC Studio: a real plugin authoring
system, in-app environment setup, a rebuilt Learn-mode navigation, and a broad
UX bug sweep.

### Added — Plugin authoring system

Nuclei plugins are now real, not a mock marketplace. A developer can scaffold,
load, and run a local plugin that adds a live panel to the app.

- A zod-validated `plugin.json` manifest and an `activate(api)` entry contract;
  the loader reads a plugin folder, validates it, and runs the plugin with the
  capability API (registered panels now actually render, themes actually
  apply). Reload / enable / disable / uninstall, plus boot-time restore of the
  plugins you loaded.
- **Load plugin…** and **Create plugin…** in the plugins view (the scaffold
  writes a working starter), two example plugins, and a full authoring guide.
- **Honest security posture:** plugins are local, user-authored, trusted code
  and run with the app's privileges — they are **not** sandboxed in v1, and the
  docs say so plainly rather than implying a sandbox.

### Added — In-app environment setup

Set up your Python toolchain from inside Nuclei, no terminal:

- A **Settings → Environment** panel: install Python via the OS package manager
  (Homebrew / winget) when it's missing or too old, install/remove quantum
  frameworks into the managed venv, repair a wedged environment, and copy a
  diagnostics report.
- A **missing-dependency banner**: run Qiskit code without Qiskit and a
  one-click "Install Qiskit" appears instead of a dead-end traceback.

### Changed — Learn mode navigation

- A new in-lesson navigation sidebar shows the track (the overarching topic),
  the full lesson list with your progress, and a scroll-spy outline of the
  current lesson — so you always know where you are.
- A real breadcrumb and a within-lesson progress bar; the Learn rail and the
  full view now use **one** track/lesson model (the old parallel paths/modules
  hierarchy is gone).

### Fixed

- **Scrolling**: a systemic flexbox bug (a scroll container missing
  `min-height: 0`) that clipped content instead of scrolling — fixed in ~20
  places, including tall circuits, long Dirac conversations, the runs table,
  and most side panels.
- **Stuck spinners**: the Resource Estimator and detector-graph "Sample a shot"
  no longer spin forever when the kernel isn't connected.
- **Hardware**: a credential save no longer shows a false "connected"; a
  connect attempt now times out instead of hanging on "Connecting…"; and
  "Run on Hardware" no longer queues a duplicate job per click.
- **Editor**: Dirac inline suggestions render in Dirac violet, the selection is
  on-brand, the active file is unmistakable across tabs/tree/open-files, and
  ⌘K inline edit surfaces errors instead of failing silently.
- Confirmations on destructive actions (uninstall plugin, reset settings, clear
  jobs); the update banner can no longer trap you on a stalled download; and
  the fabricated community leaderboard / gallery / plugin listings were removed
  in favor of honest empty states.

## [0.7.0] - 2026-07-13

### Added — QEC Studio: quantum error correction as a first-class research surface

Research mode gains a full quantum-error-correction workflow, built on the
experiment object from 0.6.0. It's the headline of this release.

- **QEC campaigns.** A `qec_campaign` experiment (schema v2) sweeps a
  stabilizer code over a noise grid and collects logical error rates with
  [Stim](https://github.com/quantumlib/Stim) + [sinter](https://pypi.org/project/sinter/).
  Circuits come from a built-in generator (`generate:`) or — the honest
  path — a **real, editable Python entry** (`nuclei_circuits(noise)`) you
  own and can change. Campaigns run as managed kernel jobs with a live
  progress chip, and a stopped campaign **resumes without re-sampling**
  from the stats it already has. Sampling is Monte-Carlo and unseedable by
  design; the protocol refuses to imply otherwise.
- **Visualizations no other desktop tool has:** a moment-by-moment circuit
  timeline, a code-lattice view from qubit coordinates, and an interactive
  **detector graph** with a "sample a shot" overlay that shows the fired
  detectors and the decoder's matching. Every degenerate case is a designed
  state, never a blank box.
- **Threshold / Λ analysis.** Logical error rate vs physical error on
  log-log axes, per distance and decoder, with Wilson confidence intervals
  and the fitted error-suppression factor Λ. Entry-source campaigns join the
  fit via a `d=<n>` circuit-label convention.
- **Resource Estimator.** A new Research panel wraps the Azure Quantum
  Resource Estimator (via the `qdk` package) over Q# and Qiskit circuits,
  leading with the headline fault-tolerant cost — physical qubits, runtime,
  code distance, T-factory count — with a full document and JSON export.
- **New QEC experiment templates** (repetition + rotated surface memory)
  and a **noise model library** (list, view, duplicate-to-edit, and diff
  built-in and project `noise/*.noise.yaml` models — files stay the truth).
- **Dirac** gains QEC campaign context (source, noise model, detector error
  model, capped stats rows, Λ) and QEC vocabulary in its research persona.

Protocol **v1.2** adds `qec_generate`, `qec_snapshot`, `qec_campaign_*`,
`qec_decode_sample`, `qec_materialize`, and `qec_estimate` — all additive;
old clients are unaffected.

### Added — Workspace navigation and mode identity

- **Command palette, registry-driven.** Every rail view has a *Go to* command
  and every panel a *Toggle* command, generated from the panel registry so
  the palette can never drift from the UI. Plus *Switch workspace mode*,
  *Run experiment <name>* (fuzzy), *Open run folder*, and tour replay.
- **Keyboard navigation.** `⌘⇧M` switches workspace mode; `⌘1`…`⌘9` jump to
  the Nth top-rail view (mode-aware). Rail tooltips show the binding.
- Mode identity carries a teal (Learn) / violet (Research) accent through the
  activity bar and status bar.

### Changed — Brand

Nuclei is now presented as **the open-source quantum workspace** — "Learn it.
Research it. Run it on real hardware." The landing page leads with a two-door
Learn/Research chooser mirroring the in-app mode picker, and a capabilities
strip (4 frameworks · QEC campaigns · 8 hardware providers · local &
private). No absolute claims — capability is shown, not asserted.

## [0.6.0] - 2026-07-11

### Added — Research mode and experiments as first-class objects

Nuclei splits into two workspaces over one shared core. **Learn** is
everything Nuclei has always been — lessons, challenges, Dirac as tutor,
progressive disclosure — completely unchanged, and still the default a
fresh install lands in. **Research** is a new workspace for people *doing*
quantum computing: a multi-file project view, an Experiments panel, and
Dirac as a terse research collaborator instead of a patient tutor. Switch
between them from the first-launch chooser, the command palette ("Switch
workspace mode"), or a status-bar pill — no buried settings toggle. The
mode you pick sticks per project.

- **Experiments** are plain, git-friendly files, not a database: a
  `*.experiment.yaml` you can write by hand or generate from a form
  declares an entry file, a backend, shots, a seed, and an optional
  parameter sweep (a numeric `range` or an explicit `values` list per
  parameter; the full grid is the cartesian product, hard-capped at 500
  points). Hit Run and each point streams into a sortable, virtualized runs
  table as it completes — status, duration, seed, and every recorded or
  derived metric as columns. A failed point doesn't stop the sweep; a
  cancel button stops after the current point and keeps everything already
  written.
- **Reproducibility, honestly.** Every run writes a `manifest.json`:
  params, seed, a hash of the exact code that ran, the git commit and a
  `dirty` flag, and the framework/app versions in play. Re-running a
  simulator point with the same seed reproduces identical measurements
  (verified for Qiskit and Cirq). Where determinism genuinely can't be
  guaranteed — real hardware noise, simulators without a seeding hook, an
  uncommitted working tree — the manifest says so explicitly
  (`seed_honored: false`, `git: null`) instead of implying a precision that
  isn't there. A sweep against real hardware warns with the total
  point × shot count first, and above 10 hardware points requires typing
  the experiment's name to confirm.
- **Comparison and sweep plots.** Select two or more runs to overlay their
  histograms, diff their manifests (only the differing fields highlighted),
  and compare their metrics side by side. For a swept experiment, plot any
  metric against any swept parameter, grouped by a second parameter when
  the grid is two-dimensional — an energy-vs-theta curve per circuit depth,
  without leaving the IDE. Both views export SVG and CSV.
- **Dirac, research collaborator.** In Research mode, Dirac's persona drops
  the tutor framing for a terser, more precise one — assumes graduate-level
  quantum mechanics, states uncertainty plainly, and (when the Experiments
  panel is focused) sees the active experiment's YAML and selected runs'
  manifests and metrics. Tone and context only in this release — no new
  tools or autonomy.
- **Kernel protocol v1.1** (fully additive — nothing here changes behavior
  for a client that doesn't use it): `execute` accepts optional `params`
  (injected as a `params` dict for Python, bound by name to Q# entry-point
  arguments) and `seed`; its `result` response gains `metrics` (via a new
  `record_metric(name, value)` function available in Python) and
  `seed_honored`. A new `environment` message reports the kernel's Python
  version, platform, and installed framework versions. Note for Q# authors:
  a swept entry operation cannot be named `Main` — qdk's own compiler
  rejects a parameterized `Main`; name it anything else (`Rotate`, etc.).
- New developer docs at
  [getnuclei.dev/docs/research](https://getnuclei.dev/docs/research/workspace-modes/):
  workspace modes, the full experiment schema reference, and an honest
  accounting of what reproducibility does and doesn't guarantee.

Research mode is desktop-only in this release; the web build continues to
show Learn mode only.

## [0.5.1] - 2026-06-10

### Added — developer docs at getnuclei.dev/docs

Nuclei now has a full developer documentation site at
[getnuclei.dev/docs](https://getnuclei.dev/docs) — API/SDK-style docs for
researchers and developers, not a user manual. 27 pages across seven
sections: Introduction, Kernel API, Frameworks, Hardware, Dirac AI,
Extending, and Reference.

- The kernel WebSocket protocol and data schemas are documented as a
  public **v1** API. Every request/response example lives as a JSON
  fixture replayed against the live kernel by
  `kernel/tests/test_docs_fixtures.py`, so protocol drift breaks CI,
  not readers.
- Runnable Python and TypeScript client examples
  (`docs-site/fixtures/clients/`), validated in the test suite.
- Built with Astro Starlight (`docs-site/`), themed to match
  nuclei.dev, with build-time Pagefind full-text search and a
  sitemap.
- Internal links are validated at build time
  (`starlight-links-validator`) — a broken link fails the docs build
  in CI.
- A root `robots.txt` now ships with the Vercel deploy and points
  crawlers at the docs sitemap.

### Fixed — stale failed jobs no longer haunt the launch strip

- A simulator job that failed weeks ago could still sit in the LaunchStrip
  banner with a live elapsed timer reading "56309m 29s". Three causes,
  three fixes:
- The job store's 7-day TTL for terminal jobs only ran inside `save()` —
  a user who never submitted another job never triggered a write, so
  expired records survived forever and were re-served to the frontend on
  every connect. The prune now also runs in `load()` at kernel start, and
  rewrites the file (atomically) when anything was dropped.
- Dismiss was frontend-only: it cleared the local store but no protocol
  message removed the kernel's persisted record, so dismissed jobs
  reappeared next session. New additive `hardware_dismiss` message
  (reply: `hardware_job_dismissed`) deletes the record from the registry
  and `jobs.json` for good — bookkeeping only, it never cancels
  provider-side work (that's still `hardware_cancel`).
- Terminal jobs (`failed`/`complete`/`stale`) no longer render a ticking
  elapsed-since-submit counter; they show a static relative age instead
  ("failed · 5w ago"). Running and queued jobs keep the live timer.

### Fixed — runaway Q# programs no longer silently wedge the kernel

- All Q# interpreter work runs on one dedicated thread (the qdk
  interpreter context is thread-pinned), and callers blocked on it with
  **no timeout**. A runaway Q# program (an infinite loop) hung the
  calling request forever — and every future Q# request queued silently
  behind it while the kernel looked perfectly healthy (the heartbeat
  never notices a wedged interpreter), until a kernel restart.
- Q# calls now have a watchdog budget: **30 s** for parse and QIR
  compilation (compiler-only work) and **300 s** for execute (user
  programs at user shot counts). On expiry the caller gets a `timeout`
  error explaining, in plain language, that the program is still
  running and the kernel needs a restart — check for infinite loops.
- Honest about the limits: qdk offers no cancellation, so the watchdog
  frees the *caller*, not the interpreter — the runaway program keeps
  the interpreter thread busy. The kernel now tracks that wedged state:
  subsequent Q# requests fail **fast** (instead of waiting a full
  budget each) with a "previous Q# run is still occupying the
  interpreter — restart the kernel" message, and the wedge clears
  automatically if the runaway run eventually finishes on its own.
  Python frameworks (Qiskit, Cirq, CUDA-Q) are unchanged.

### Fixed — Dirac settings knobs now do what they say

- Settings → Dirac AI displayed and persisted **Preferred Model**,
  **Extended Thinking**, and **Context Depth**, but no routing code
  ever read them. They are wired now, scoped to the chat surface
  (ghost completions, narration, and error rewrite stay on Haiku for
  latency; compose and Cmd+K stay on Sonnet for generation quality):
  - **Preferred Model** — `haiku`/`sonnet` force that model for chat
    Q&A; `auto` (default) keeps the heuristic. Tool-use and `/think`
    turns still run Sonnet because they require it.
  - **Extended Thinking** — off stops reasoning-keyword
    auto-escalation to the thinking variant; an explicit `/think`
    always works.
  - **Context Depth** — Minimal sends code + circuit summary +
    recent errors only; Standard (default) is exactly the previous
    assembly; Full adds detail (top-16 probabilities, last 10 stderr
    lines).
- Defaults are unchanged and the default route is identical to the
  previous behavior — the chat routing heuristics moved verbatim into
  `src/services/diracRouting.ts`, where unit tests pin the
  defaults-equivalence.

### Fixed — Quantinuum connect now validates the token (pytket-quantinuum<0.26 only)

- `connect()` accepted any non-empty string as a Nexus API token: it
  stored the token, constructed a backend object, and returned `true`
  without ever talking to Quantinuum — auth failures surfaced only at
  submit time, and confusingly, because the token never reached
  pytket's auth at all (pytket-quantinuum authenticates through its
  own `QuantinuumAPI` handler and credential storage, not a token
  kwarg). `connect()` now seeds an in-memory credential store with
  the token (id-token slot only — seeding the refresh slot with the
  same value made the SDK's mid-session renewal fail silently), makes
  one authenticated device-list call through that handler — failing
  fast with a clear hint when the token is rejected — and reuses the
  validated handler for submission, polling, and cancellation.
- Honest version reality: the credential-storage seam this rides on
  (`MemoryCredentialStorage`, `QuantinuumAPI(token_store=...)`) only
  exists in **pytket-quantinuum < 0.26**. Modern releases replaced it
  with Quantinuum's own login flow / the qnexus package, and their
  `QuantinuumAPI` is an offline alias whose device list needs no auth
  — so there is nothing there a token could be validated against. On
  a modern SDK, `connect()` now says exactly that (install
  `pytket-quantinuum<0.26`, or use Azure Quantum's Quantinuum
  targets, which work today) instead of the misleading "requires
  pytket-quantinuum" install hint it printed even when the package
  was installed. The setup wizard's catalog entry now pins
  `pytket-quantinuum<0.26` accordingly.

### Fixed — Bloch sphere showed Qiskit qubits in reversed order

- The Qiskit adapter traced the wrong statevector axis when computing
  per-qubit Bloch vectors: the shared partial-trace helper indexes
  C-order reshape axes (axis 0 = MSB), but Qiskit statevectors are
  little-endian (qubit 0 = LSB) — so `bloch_coords[i]` carried qubit
  `n−1−i` and the Bloch panel rendered Qiskit circuits mirrored. The
  adapter now traces axis `n−1−i` for display qubit `i`. Cirq and Q#
  were unaffected (their big-endian states already matched the
  helper's axis order), and symmetric states like Bell — every demo
  and fixture — masked the bug, which is how it survived.

### Fixed — credential dialog sent wrong keys for IBM and IonQ

- The desktop credential dialog (provider card → Connect) sent
  `apiToken` (IBM) and `apiKey` (IonQ), but the kernel reads
  `credentials.get("token")` — so connects from that dialog silently
  sent an empty token. The dialog now sends `token`, matching the
  documented kernel contract. The launch modal's inline key field was
  unaffected (it already sent `token`).

### Changed — kernel opts out of Microsoft qdk telemetry

- The optional `qdk` package (Q# support) ships Microsoft usage
  telemetry to Azure Application Insights, on by default. The kernel
  now sets `QDK_PYTHON_TELEMETRY=none` before qdk loads (in both
  `kernel/server.py` and the Q# adapter), so nothing phones home from
  a Nuclei install. Exporting the variable yourself before launch
  still wins — `setdefault` preserves explicit choices.

## [0.5.0] - 2026-06-09

### Added — Q# (Microsoft QDK), Nuclei's fourth framework

Q# lands alongside Qiskit, Cirq, and CUDA-Q — and it's the first
language in Nuclei that isn't Python. A student can now write Q#
in the editor, watch the circuit diagram, Bloch sphere, and
histogram update live, ask Dirac for help, get real compiler
diagnostics as they type, and launch the same program to Azure
Quantum hardware.

Q# source can't flow through the Python `exec` pipeline, so the
kernel grew a source-mode adapter concept: `AdapterSpec.source_mode`
routes raw Q# source to the new `kernel/adapters/qsharp_adapter.py`
instead of executing it as Python. Nuclei standardizes on the `qdk`
PyPI package (`from qdk import qsharp`) — the standalone `qsharp`
package is a deprecated shim and is deliberately avoided.

Everything is backward compatible: `parse` / `execute` /
`hardware_submit` messages gain an optional `language` field
(`'python' | 'qsharp'`), and the three Python frameworks see zero
changes.

### Added — kernel: source-mode Q# adapter

- Snapshots come from `qsharp.circuit()` JSON; simulation runs via
  `qsharp.run()` with `DumpMachine` state capture and a
  sampled-marginal fallback when the full state isn't available.
- `compile_qir()` lowers the current program to QIR for hardware
  submission.
- All interpreter work is serialized on a dedicated thread — the
  qdk interpreter is process-global and thread-pinned, so the
  adapter never touches it from two threads.
- Shared state-vector math extracted to `kernel/adapters/_math.py`
  for reuse across adapters.
- The optional `qdk` dependency is documented in
  `kernel/requirements.txt`; the setup wizard installs it
  (`pip install qdk`) via a new core catalog entry.

### Added — frontend: Q# as a first-class framework

- `Framework` union gains `'qsharp'`; `.qs` files open with
  framework inference, and the FrameworkSelector gains a
  "Q# (QDK)" entry.
- Q# Bell-state starter template, with a `DumpMachine` teaching
  comment explaining how state inspection works.
- Monaco `qsharp` language registration (Monarch tokenizer) for
  syntax highlighting.
- Gate explorer shows Q# syntax for all 14 gates.
- The web build shows a friendly desktop-only message for Q#
  execution instead of failing silently.

### Added — editor: the real QDK language service

The Monarch tokenizer was the floor, not the ceiling. Q# buffers
now get the same compiler the QDK ships: `qsharp-lang` WASM
running in a web worker provides live compiler diagnostics,
completions, hover docs, and signature help. The worker is
lazy-loaded only when a Q# buffer opens, so Python users pay
nothing.

### Added — Dirac speaks Q#

- A Q# style guide (`src/services/qsharpStyle.ts`) is injected
  into compose and inline-edit prompts, so generated code is
  idiomatic modern QDK 1.x Q#.
- Ghost completions are registered for Q# buffers with Q#-aware
  prompts.
- Error rewriting understands Q# compiler diagnostics and explains
  them in plain English.

### Added — hardware: Q# to Azure Quantum via QIR

- The Launch portal submits Q# to Azure Quantum: the kernel
  compiles to QIR (`base` profile; `adaptive_ri` for Quantinuum
  targets) and the existing AzureProvider submits it unchanged.
- The Local Simulator runs Q# directly; other providers reject Q#
  with a friendly message instead of a traceback.

### Fixed — Azure results coercion hardened

- Float probability distributions are scaled by shot count,
  array-style keys are normalized to bitstrings, and colliding
  keys are summed instead of overwritten.

## [0.4.17] - 2026-05-02

### Fixed — critical Local Simulator crash + white-page on click

Clicking Local Simulator → Launch in the submit tab caused the
entire IDE to white-page, and reloading kept it broken. Two bugs
compounded:

- `LaunchStrip` violated the Rules of Hooks: `useHardwareStore((s)
  => s.clearJob)` was called after the `if (!latestJob) return null`
  early return. The first render with `jobs=[]` ran 5 hooks; the
  moment `addJob` fired in response to a successful submit, the
  re-render needed 6 hooks and React threw "Rendered more hooks
  than during the previous render." Because `LaunchStrip` was not
  wrapped in an `ErrorBoundary`, the whole React tree unmounted.
  Fix: hoist the `clearJob` selector above the early return. Added
  a regression test (`LaunchStrip.test.tsx`) that mounts empty,
  dispatches `addJob`, and asserts no hooks-mismatch error fires.

- `kernel/server.py` was passing the post-`exec` circuit object to
  `SimulatorProvider.submit_job`, which then ran
  `code = circuit_obj if isinstance(circuit_obj, str) else ""` —
  every Local Simulator submission silently no-op'd. The simulator
  path now passes the raw code string straight through to the
  existing executor pipeline. Real-hardware adapters still receive
  a concrete circuit object.

- `LaunchStrip` is now wrapped in an `ErrorBoundary` in
  `PanelLayout` so any future render bug there degrades to an
  inline retry card instead of white-paging the IDE.

## [0.4.16] - 2026-04-20

### Fixed — managed venv auto-rebuilds from Python 3.10+

v0.4.14 and v0.4.15 landed the kernel bundle and the core-dep
install, but users whose managed venv had been created from Python
3.9 (Xcode's default `python3` on many Macs) still saw "loading
kernel..." forever — the kernel code uses PEP 604 union syntax
(`str | None`) in class bodies, which crashes at import time under
3.9 with `TypeError: unsupported operand type(s) for |: 'type' and
'NoneType'`. v0.4.15 exposed the traceback via stderr piping; this
release actually resolves it.

- New `find_best_python` probes candidates in newest-first order
  (`python3.13`, `python3.12`, ... `python3.10`, then generic
  `python3` / `python`) and only returns interpreters that are
  >= 3.10. A box with both 3.9 and 3.12 now always picks 3.12.
- `ensure_kernel_runtime` now checks the venv's Python version at
  every kernel spawn. Venvs built from < 3.10 are automatically
  rebuilt with a newer interpreter, with the user's previously-
  installed frameworks (Qiskit, Cirq, etc.) re-installed from the
  catalog so the setup wizard doesn't have to be re-run. The old
  venv is moved aside to `venv.broken` during the rebuild and
  removed on success.
- Fresh venv creation also requires 3.10+. If no suitable Python
  is found on PATH, the user gets a clear "install Python 3.10+
  from python.org" error instead of a silently-broken kernel.

### Changed — Dirac no longer uses emojis

Prompt tweak: Dirac's system prompt now explicitly forbids emojis
and decorative unicode (✨ 🎉 🚀 etc.) in chat responses. Inline
code, braket notation (|0⟩, |ψ⟩), and bullet lists stay because
they carry meaning. Also discourages the "Great question!"
preamble pattern so replies get to the point faster.

## [0.4.15] - 2026-04-20

### Fixed — kernel hung at "loading" after v0.4.14 update

v0.4.14 started bundling `kernel/` in the release (good) but the
Nuclei-managed venv was never installing the kernel's own runtime
deps — `websockets`, `numpy`, `keyring`. The framework wizard in
v0.4.7 taught the venv to install user-selected frameworks (Qiskit,
Cirq, etc.), but it never installed the kernel's core imports. On
v0.4.14 (the first release where the kernel actually launches from
that venv), Python died immediately on `import websockets` and the
frontend stared at a "loading kernel..." spinner forever.

- New `ensure_kernel_runtime` hook creates the venv if missing and
  installs `websockets`, `numpy`, `keyring` when they're not
  already there. Fast-checked via a `python -c 'import ...'` probe
  so the hot path is a ~50ms no-op when everything's satisfied.
  Called by the kernel spawn path every launch.
- Kernel stdout/stderr are now piped into the Rust logger. Prior
  releases left both handles piped but never read them, so Python
  crashes (like this one) left no breadcrumbs — just a defunct PID
  and a frontend reconnecting to a dead WebSocket forever. The
  next mystery kernel crash will leave a trail in `nuclei.log`.

## [0.4.14] - 2026-04-19

### Fixed — kernel is now actually shipped in the release bundle

Every release prior to this one built the `.dmg` / `.msi` / `.deb`
without the `kernel/` Python source inside it (no `resources` entry
in `tauri.conf.json`). The packaged app silently relied on whatever
stale kernel process happened to be running on the user's machine —
typically a zombie from an earlier install still holding port 9742.

Symptom users saw: `Error: Unknown message type:
hardware_connected_providers` (and similar for `hardware_list_jobs`),
because the zombie kernel was running pre-v0.4.12 server code and
didn't know about handlers added in v0.4.12 / v0.4.13.

- `tauri.conf.json` gains `resources: {"../kernel": "kernel"}` so
  the full kernel source ships inside every bundle at
  `<resource_dir>/kernel/`. The Rust kernel spawner in
  `src-tauri/src/commands/kernel.rs` was updated in tandem to read
  from `resource_dir.join("kernel")` rather than `resource_dir
  .parent()` (which was always wrong in production — the parent is
  `Contents/` on macOS and doesn't contain our source).
- Before spawning a new kernel, Rust now kills whatever is currently
  holding port 9742 (`lsof -ti :9742 | xargs kill -9` on unix,
  `netstat | taskkill` on windows). Best-effort — no-ops cleanly
  if the port is free — and eliminates the "first zombie wins"
  class of bug.

### Fixed — .py files greyed out in the macOS open dialog

The single `extensions: ['py']` filter on `openFile` was routed
through Cocoa's `NSOpenPanel.allowedFileTypes`, which greyed out any
file whose UTI didn't resolve to `public.python-script` — common on
freshly-imaged machines, for files with mis-tagged metadata, or for
Python files with uppercase extensions.

- `openFile` now offers a broader default group (`py`, `qasm`,
  `ipynb`, `json`, `txt`, `md`) plus an "All Files" fallback.
  macOS renders these as a dropdown at the bottom of the open
  panel, so users who still see their file greyed out can switch
  to "All Files" and select it.
- `saveFileAs` gained the same "All Files" fallback so you can
  name a destination with a non-default extension without the
  picker fighting you.

## [0.4.13] - 2026-04-19

### Added — Open Files section in the sidebar

Open editor tabs now show at the top of the Explorer sidebar. Clicking
a row switches to that tab; the hover-reveal X closes it; a dirty-dot
shows unsaved changes. The section is collapsible, shows the tab count
in the header, and self-hides when nothing is open. Pinned above the
file tree's scroll container so deep trees don't push it off-screen.

### Fixed — File > Open now registers a tab

File > Open loaded a file into the editor but never called
`projectStore.openTab`, so opening a second file orphaned the first
with no way to switch back from the sidebar. It now flows through
the same tab machinery as every other open path, so both the top
EditorTabs bar and the new sidebar section light up correctly.

## [0.4.12] - 2026-04-19

### Added — Terminal polish

Toolbar with clear, copy-all, auto-scroll toggle, timestamps toggle,
client-side filter, live line count. Typed terminal lines (stdout /
stderr / separator / info) render distinctly — stderr is italic and
red, separators dim, tracebacks-via-stdout highlighted. ANSI escape
codes stripped at the store layer. Execution separators
(`─── Run at HH:MM:SS ──────`) delimit multiple runs instead of
clearing history on each Cmd+Enter. New ⌘\` keyboard shortcut
toggles the bottom panel with focus on terminal. Kernel now emits
stderr as a separate WebSocket message type, captured and styled
independently from stdout.

### Added — Hardware pipeline hardening

- Mock-based test suite for all seven provider adapters (IBM, IonQ,
  Braket, Azure, Quantinuum, NVIDIA, Simulator) + the hardware
  manager — 104 tests, no network calls, runs in under 200ms. Gated
  in CI via a new kernel-tests workflow so future SDK upgrades that
  break provider integrations are caught on the PR, not weeks later
  when a user reports a broken submission.
- Quantinuum auto-converts Qiskit and Cirq circuits via
  pytket-extensions (or returns a clear install hint).
- Azure handles `workspace.get_targets(name=...)` returning None,
  empty list, multi-match list, or single Target.
- Braket surfaces ARN-not-found with a "refresh backend list" hint.
- IBM wraps `job.status()` in its own try/except so a deleted job
  returns status=`unknown` instead of breaking the polling loop.
- Server catches `KeyError` on stale job IDs with a friendly
  status=`stale` response, not a raw traceback.
- Every failed submit now populates `JobHandle.error` with a
  readable provider-specific message.

### Added — Credentials moved to OS keyring

Provider tokens no longer live in browser `localStorage`. The kernel
receives them over WebSocket, persists via the `keyring` package
(macOS Keychain / Windows Credential Manager / Linux Secret Service),
and auto-reconnects every previously-connected provider on kernel
start. A one-time migration on WS connect drains any legacy
`nuclei-hardware-*` localStorage entries into the keyring and wipes
them. `CredentialSetup` form layout unchanged.

### Added — Job persistence across kernel restarts

Jobs persist to `~/.nuclei/jobs.json` (override via `NUCLEI_DATA_DIR`).
Atomic temp-file-plus-rename writes, LRU cap at 200 entries, 7-day
TTL for terminal jobs. On kernel restart, non-terminal jobs
re-appear in JobTracker as `stale` — users see their history
instead of the list going empty.

### Added — Exponential polling backoff

Hardware job polling: 5s tier for 0–60s after submit, 15s to 5min,
60s to 30min, 5min past that. ±10% jitter, 24h stale cutoff, snap
back to fast tier on status change. A 1-hour queued IBM job now
fires ~30 status requests instead of 720.

### Added — Dirac conversation persistence

One conversation per project, auto-saved to
`<projectRoot>/.nuclei/dirac.json` with a default `.gitignore` so
AI chats don't get committed. Ephemeral fallback for work outside a
project — localStorage on web, platform key-value store on desktop.
300ms debounced writes with at-most-one-in-flight coalescing so
streaming responses don't thrash the disk. `DiracMessage` gained
required `id` and `timestamp` fields (auto-generated by the store).
Auto-restore on project open and app start. Past tool calls render
as display-only history on reload; never re-execute.
`clearHistory` now writes `messages: []` to disk while keeping
`conversation_id` stable (friendly to a future multi-conversation
feature). No UI changes — the Dirac side panel renders identically.

### Fixed — JobHandle.error, unknown/stale statuses surfaced to UI

`JobHandle` gained an optional `error` field and two new status
values (`unknown`, `stale`). `JobTracker` renders both distinctly.

## [0.4.11] - 2026-04-19

### Fixed — YouTube Error 153 actually resolved (previous fix didn't work)

v0.4.10 tried to fix Error 153 by dropping `enablejsapi=1` and
switching from `youtube.com/embed` to `youtube-nocookie.com/embed`.
That reasoning was wrong. YouTube's embed player validates the
parent document's origin regardless of which domain you embed from,
and Tauri's `tauri://localhost` (macOS) / `http://tauri.localhost`
(Win/Linux) webview origin is rejected either way. `nocookie` is
actually stricter than the regular embed, so the swap made the
failure mode more visible, not less.

In-iframe embedding cannot be fixed inside Tauri — the webview
origin is fixed by the runtime. Every major desktop app (Linear,
Slack, Notion, Discord) handles this the same way: poster thumbnail
in-app, video plays in the OS default browser.

- Added `tauri-plugin-shell` with a scoped `shell:allow-open`
  permission limited to `youtube.com` and `youtu.be`.
- Rewrote `VideoPlayer` as a click-to-play poster — YouTube
  thumbnail, play button overlay, "Opens in browser" hint.
  Chapter clicks open the video at the right timestamp via
  `?t=Ns`. Lesson view no longer mounts an iframe at all.
- `VideoLibrary` and `TrackSelector` now open the external browser
  directly when a video card is clicked; the iframe modals that
  couldn't load the videos anyway have been removed.
- CSP `frame-src` trimmed to `'self'` since no YouTube iframes
  remain; `img-src` still whitelists `img.youtube.com` for
  thumbnails.

## [0.4.10] - 2026-04-19

### Fixed — lesson videos failing with YouTube Error 153 (superseded by 0.4.11)

`VideoPlayer` was embedding lessons with `enablejsapi=1`, which makes
YouTube validate the parent origin before initializing the embed
player. Tauri's `tauri://localhost` webview origin doesn't satisfy
that check, so YouTube bailed out with "Error 153 — Video player
configuration error" on every lesson with an embedded video. Nothing
in the frontend actually uses the YouTube JS API (chapter clicks work
by re-rendering the iframe with a new `src`), so the flag was dead
weight anyway.

- Dropped `enablejsapi=1` from `VideoPlayer`.
- Standardized all three YouTube embeds (`VideoPlayer`,
  `VideoLibrary`, `TrackSelector`) to `youtube-nocookie.com`. The CSP
  already whitelists it, it's more lenient about embedded-origin
  checks, and it stops YouTube from setting tracking cookies on
  students who are just watching a lesson video.

Note: This fix did not actually resolve Error 153. See 0.4.11.

## [0.4.9] - 2026-04-18

### Changed — right rail is now Bloch-only

The gate-circuit diagram used to share the right rail with the Bloch
sphere, but it was clipping against the top of the panel and
competing with the sphere for vertical space. Removed from the rail
entirely so the interactive Bloch sphere gets the full right column
and nothing fights it for room.

- `CircuitRenderer` still exists (and still accepts clicks from
  Dirac tools like `highlight_gate`), but no longer renders in the
  default layout.

## [0.4.8] - 2026-04-18

### Fixed — Bloch sphere was blank inside the Tauri bundle

`@react-three/drei` `<Text>` uses troika-three-text, which fetches the
default Roboto font from `fonts.gstatic.com` when no `font` prop is
provided. Under Tauri's bundled `tauri://` origin that fetch fails,
troika throws inside Canvas suspense, and the whole WebGL scene stops
rendering — which is why v0.4.5–v0.4.7 shipped with an empty dark
panel where the Bloch sphere should have been.

- Swapped all 3D labels (X/Y/Z axes + |0⟩/|1⟩ basis labels) from
  drei `<Text>` to drei `<Html>`. HTML overlays project onto the
  sphere's 3D positions, track orbit rotation, and require no
  external font fetch. Works offline, works inside the bundle.

### Added — quick-create circuit chips in the empty explorer

- Empty-state sidebar now shows a **Quick start** row with Qiskit /
  Cirq / CUDA-Q chips below the "New Project…" button. One click
  creates an in-memory project + seeded tab with that framework's
  Bell-state starter. Removes the "click New Project, then click +"
  two-step for the common case.

## [0.4.7] - 2026-04-18

### Added — first-run framework installer

Nuclei now ships with a proper framework setup wizard instead of assuming the student has `python3`, `qiskit`, `cirq`, and `cudaq` already working on their system.

- **Managed Python environment.** Nuclei creates and maintains a private venv at `<appDataDir>/venv`. The kernel launches from this venv automatically, so frameworks installed through the wizard are always visible without the student touching PATH or activating anything.
- **Framework wizard.** On first launch, a modal appears with a checklist:
  - Core: Qiskit (recommended, ~220 MB), Cirq (recommended, ~60 MB), CUDA-Q (~500 MB, CPU sim everywhere, GPU on Linux+CUDA).
  - Hardware providers: IBM Runtime, IonQ, AWS Braket, Azure Quantum, Quantinuum (pytket).
  - Each row shows approximate download size and whether it's already installed.
  - Students pick what they want, click Install, get live per-framework progress events from the Rust side.
- **Settings → Quantum Frameworks** opens the same wizard any time, so students can add CUDA-Q later or install an extra provider mid-course without re-onboarding.
- **Graceful degradation.** If Python 3 isn't on the system PATH at all, the wizard shows a friendly "install Python 3.10+ from python.org" instead of failing silently. If a single framework install fails (network, wheel build), the rest still install and the failure summary names which ones need retry.

This is the groundwork for CUDA-Q support out of the box — you no longer need to have it pre-installed on your Mac for `@cudaq.kernel` to work.

## [0.4.6] - 2026-04-18

### Fixed — Bloch sphere labels no longer clip at panel edges

- **Camera reframed.** The v0.4.5 Bloch sphere had the camera at distance ~2.94 with a 38° FOV, giving a vertical half-extent of ~1.01 at origin — but the axis labels sat at radius 1.29 and the basis labels (|0⟩/|1⟩) at 1.32. Result: labels were getting clipped at the panel's top and bottom edges. Camera is now at distance ~4.07 with a 45° FOV (half-extent ~1.69), and label offsets pulled in to 1.05 × axis length and ±1.22 for the poles. Comfortable margin at narrow-rail aspects.
- **Zoom clamps.** `minDistance=2.2` (just past the sphere surface) and `maxDistance=6.5` (far enough for overview, close enough for the state arrow to stay legible).
- **BlochPanel bottom padding** dropped from 28px → 12px so the sphere sits centered in its rail instead of floating high.

## [0.4.5] - 2026-04-18

### Changed — in-memory New Project + classic interactive Bloch sphere

- **New Project is now an in-memory scratch, not a disk folder.** Previously the button opened Finder, made you name a project, and wrote a directory before you'd typed a single character. Wrong metaphor. Now clicking New Project opens an untitled `main.py` tab in memory with the current framework's starter code — no Finder, no disk. Write code, decide where to save it later with ⌘S. On save the tab re-paths to the real location and the sidebar tree flips from the "tab-only" view to the real filesystem view.
- **Bloch sphere replaced with a classic interactive sphere.** Ported the bits-and-electrons simulator style (https://github.com/bits-and-electrons/bloch-sphere-simulator) into React Three Fiber. Wireframe sphere, labeled X/Y/Z axes (red/green/blue matching the reference), |0⟩/|1⟩ basis labels at the poles, cyan state arrow that reacts to simulation results. Drag to rotate, scroll to zoom. Multi-qubit circuits render spheres side-by-side in the rail, each with its own OrbitControls.
- **Gate rail gets proper top padding.** The circuit wire diagram was rendering flush with the top edge of the panel; now has 16px breathing room so the top wire's `|0⟩` label isn't kissing the window chrome.

### Removed

- Deleted the floating-qubit constellation (Constellation.tsx, FloatingBlochQubit.tsx, CameraDirector.tsx, EntanglementTethers.tsx, BlochStage.tsx) and the useQubitLayout / useReducedMotion hooks that only that visual needed. The new classic sphere renders from the same kernel `bloch_coords` so nothing upstream changes.

## [0.4.4] - 2026-04-18

### Added — PyCharm-style project creation and framework-aware starters

- **New Project flow.** The empty-state panel now offers both "New Project…" and "Open Folder…". New Project prompts for a parent directory and a project name, scaffolds `<parent>/<name>/main.py` with the currently selected framework's starter Bell-state code, and seeds a `README.md` with the framework tagged. The new project immediately becomes the active folder and `main.py` opens in a tab.
- **New-item dropdown in the project toolbar.** Replaced the single "+" file icon with a PyCharm-style `+` menu containing:
  - **New File** — generic `.py` prefilled with `untitled.py`.
  - **New Circuit ▸ Qiskit / Cirq / CUDA-Q** — creates a framework-tagged Python file (`qiskit_circuit.py` etc.) prefilled with that framework's Bell-state starter and switches the editor framework to match.
  - **New Python Package** — folder + `__init__.py` (so imports work without extra ceremony).
  - **New Folder** — plain directory.
- **Shared starter templates.** Extracted Qiskit / Cirq / CUDA-Q Bell-state templates into `src/data/starterTemplates.ts` so the framework selector and the New Circuit menu stay in sync.

### Changed — switching framework now updates the starter code

- Picking a different framework from the top-bar selector (e.g. Qiskit → Cirq) now replaces the editor buffer with that framework's starter template, provided the buffer is untouched (empty, or still matching a known starter) and no file is open. If you've written real code or have a saved file open, the selector just flips the framework label and leaves your code alone — switching frameworks isn't a source transform.

## [0.4.3] - 2026-04-18

### Fixed — Dirac AI paths now use real model IDs and surface real errors

- **Compose fixed.** The "I couldn't draft code for that" error was caused by an invalid Sonnet model ID (`claude-sonnet-4-6-20250514`) in `src/services/compose.ts`. Anthropic rejected the request with HTTP 400, and the compose service swallowed the error and returned `null`, leaving the UI with a generic "is your API key set?" message. The ID is now `claude-sonnet-4-6`, the authoritative current Sonnet 4.6 snapshot.
- **Single source of truth for model IDs.** `src/config/dirac.ts` is now the only place any surface defines a Claude model. Added `OPUS_MODEL = 'claude-opus-4-7'` for future reasoning-mode paths. Haiku stays on `claude-haiku-4-5-20251001`.
- **InlineEdit (⌘K) switched to the shared config.** It was hardcoded to the old Sonnet 4.5 snapshot and therefore would silently fail the same way compose did. Now imports `SONNET_MODEL` and `DIRAC_API_URL` from `config/dirac`.
- **Honest error propagation.** `compose()` now returns a `ComposeResult` envelope (`{ ok: true, code, explanation } | { ok: false, error }`). 4xx responses are unpacked (`body.error.message`) and shown verbatim to the user, so bad API keys, bad model IDs, rate limits, and billing issues read true instead of a catch-all "set your key in Settings" hint.
- **ComposeModal (⌘I) and Dirac chat compose-intent** updated to consume the new envelope and display the real reason.

Net effect: Dirac's agentic compose, inline edit, and chat paths all hit valid endpoints now, and when something still fails, you see why.

## [0.4.2] - 2026-04-18

### Fixed — **hardware submission is now real**

Previously the Launch modal would surface "queued" jobs that never actually talked to a provider. `addJob()` wrote a local record; no WebSocket `hardware_submit` was ever sent to the kernel. The Connect button did the same — flipped a UI bool without validating the token. This release wires the full path end-to-end.

- **Credentials are validated** against the provider's real API. Connect now sends `hardware_connect` to the kernel, which calls `provider.connect(credentials)`; only on a real successful handshake does the UI mark the provider as connected. On failure, an inline error explains why.
- **Launch is gated.** The Launch button is disabled for credential-required providers until the provider is actually connected. No more fake queued jobs from providers with no token.
- **Jobs are recorded only after the kernel confirms them** — `hardware_job_submitted` with a real job_id from the underlying SDK (Qiskit Runtime, qiskit-ionq, Braket, Azure Quantum, pytket-quantinuum, or CUDA-Q) is the moment the UI learns the job exists.
- **Live status polling.** Every 5 seconds while jobs are active, the frontend sends `hardware_status` for each, and transitions the UI through queued → running → complete based on the provider's real status. When a job completes, `hardware_results` is auto-fetched and the histogram chip sprouts a second (purple) bar for hardware outcomes.
- **Cancel button everywhere.** LaunchStrip gets a Cancel / Dismiss control. LaunchPortal active-jobs list gets a Cancel per row. Cancel for queued/running jobs calls `hardware_cancel` on the kernel, which invokes `provider.cancel_job(handle)` — IBM, IonQ, Braket, Azure, Quantinuum all support real cancel via their SDKs. Local simulators / NVIDIA complete synchronously so cancel is a no-op. For already-completed records, the button becomes "Dismiss" and just removes the row.
- **"Clear all"** in the Recent Results section of the LaunchPortal wipes all local job records.
- **Circuit extraction from code.** `hardware_submit` on the kernel side now exec's the student's code and extracts the circuit object (QuantumCircuit / cirq.Circuit / CUDA-Q kernel) before handing it to the provider adapter — previously the raw string was passed through and every provider would have errored on type mismatch.

Net effect: the submission flow is now a real pipeline from editor → kernel → provider SDK → queue → results, with honest status, real errors, and a working cancel path.

## [0.4.1] - 2026-04-18

### Added

- **Inline BYOK in the Launch modal.** When you pick a provider that needs credentials (IBM Quantum, IonQ, Quantinuum), a compact one-field input sits at the top of the backend picker: paste your token, press Enter or click Connect, continue to submission. No separate credential-setup modal interrupts the flow for the common case.
- **Drop-to-launch.** Dropping a file into the sidebar Launch Portal now auto-opens the Launch modal on the provider picker. One-step action: drop, pick, go.
- **"Submitting: filename" banner.** The Launch modal shows a subtle chip confirming exactly which file is about to be launched, so there's no ambiguity between the active tab and the staged file.
- **Aggregator sub-provider chips.** When AWS Braket or Azure Quantum is selected, a row of small chips ("IonQ / Rigetti / QuEra / …") above the backend list filters the backends to that sub-provider. Clarifies the "this is a bundle" model without forcing a full 3-act drill-down.

### Changed

- Closing the Launch modal now also clears the selected sub-provider, so the next open starts clean.

## [0.4.0] - 2026-04-18

### Added

- **Launch Portal sidebar view.** New rocket icon in the ActivityBar opens a dedicated submission surface. Drop a `.py` / `.qasm` / `.ipynb` file into the drop zone (or click to browse) and it opens as a temp buffer in the editor. A provider grid underneath lets you pick a destination — clicking a card opens the full Launch modal with that provider pre-selected. Active jobs and recent results render below the grid with live status.
- **AWS Braket provider** (`kernel/hardware/braket_provider.py`) — real implementation via `amazon-braket-sdk`. A single integration unlocks IonQ, Rigetti, QuEra, IQM, OQC, Pasqal, and D-Wave. Backends appear in the Launch modal labeled with their sub-provider.
- **Azure Quantum provider** (`kernel/hardware/azure_provider.py`) — real implementation via `azure-quantum`. Unlocks Quantinuum, IonQ-via-Azure, Rigetti-via-Azure, Pasqal, and IQM.
- **Quantinuum direct provider** (`kernel/hardware/quantinuum_provider.py`) — via `pytket-quantinuum`. Highest-fidelity trapped-ion hardware, H1 and H2 devices.
- **Xanadu + D-Wave cards** in the Launch modal marked honestly as "different circuit model" — photonic and annealer paradigms don't accept gate-model circuits yet, but the cards surface the providers so students know they exist.
- Provider logos for Braket, Azure, Quantinuum, Xanadu, and D-Wave — inline single-color SVG monograms, no emojis.

### Changed

- `HardwareProviderType` expanded to `'ibm' | 'google' | 'ionq' | 'nvidia' | 'braket' | 'azure' | 'quantinuum' | 'xanadu' | 'dwave' | 'simulator'`.
- Credential setup flow covers every new provider with field lists and help links.

## [0.3.0] - 2026-04-18

### Added

- **Launch modal (⌘⇧R).** A dedicated full-screen surface for submitting to real quantum hardware. Provider cards with inline SVG logos (IBM, IonQ, NVIDIA CUDA-Q, Local, Google "Coming Soon"), each with pricing chip (Free / Paid / Credits / Local), status indicator, and tagline. Click a card → live backend list with queue length, error rate, and qubit count per backend. Shot stepper + prominent Launch button.
- **Launch strip.** Thin status bar at the top of the editor that surfaces the latest hardware job in-flight — provider logo, backend name, status icon, elapsed time. Click to reopen the launch panel. Replaces the buried JobTracker list.
- **Hardware-aware histogram chip.** When a hardware job completes, the inline histogram chip renders dual bars per outcome — classical simulator in accent color, hardware in Dirac purple — so students can see "real quantum matches the simulator (mostly)" at a glance.
- **Prominent Launch button** in the editor toolbar next to Run. ⌘⇧R keyboard shortcut.
- **NVIDIA CUDA-Q provider** (`kernel/hardware/nvidia_provider.py`). Exposes `nvidia`, `nvidia-fp64`, `nvidia-mgpu`, and `qpp-cpu` as CUDA-Q simulation targets. Students can submit a circuit to real GPU silicon with no credentials required beyond having `cudaq` installed.
- **IonQ provider** (`kernel/hardware/ionq_provider.py`). Real implementation via `qiskit-ionq`. Connect with an API token, list live backends, submit_job via IonQ's sampler, poll results. Mirrors the shape of the existing IBM provider.

### Changed

- Google Quantum AI is now explicitly a "Coming Soon" card in the launch UI until the provider adapter lands.

## [0.2.0] - 2026-04-18

### Added

- **Progressive-reveal layout.** Panels appear in response to code state. The circuit pane only shows up once the student has written at least one gate. Bloch sphere and a compact `|state⟩ %` histogram chip appear after a successful run. A new status-bar `Layout` dropdown lets experts pin `Clean` / `Balanced` / `Full` presets.
- **Ambient AI — narration.** Dirac automatically describes what your circuit is doing after every parse/run. One-liner narrations stream into the Dirac sidebar. Toggle in Settings → Dirac → `narration`.
- **Ambient AI — error rewrite.** When the kernel emits a Python traceback, Dirac replaces it with a concept-level explanation and (when possible) a one-click `Apply fix` button. Toggle in Settings → Dirac → `autoExplainErrors`.
- **Agentic Compose (⌘I).** Press ⌘I to open a quick-ask modal. "Create a 3-qubit GHZ state" → Sonnet writes the code → a diff preview overlays the editor → Enter applies, Esc rejects. Chat messages that look like code-generation intents route through the same flow automatically.
- **Zero-ceremony project management.** Any folder on disk is a valid Nuclei project — no config file required. Open a folder, get a live file tree, multiple tabs, per-tab dirty dots, inline rename (double-click), new-file button, and an unsaved-changes confirm when you close a tab. Last project + open tabs persist across sessions. Desktop only; web shows a "download desktop" nudge.
- **Prominent Run button + visible framework dropdown.** Moved out of the old 16 px status-bar chip and into a proper editor-tab toolbar with a ⌘↵ shortcut hint. Framework selector next to the file tab reads as a real dropdown; Qiskit / CUDA-Q options are marked "Desktop only" in the web build.

### Changed

- **Softer visual identity.** Radii, surfaces, and shadows tuned toward a Cursor-minimalist feel — more breathing room, less hard contrast.
- **Ghost completion default is now off** for beginners. Can be re-enabled via Settings → Dirac → `ghostCompletions`.
- **Histogram demoted.** No longer a full bottom-panel tab — renders as a compact chip below the Bloch sphere. Switch the layout preset to `Full` to restore the original bottom panel.

### Fixed

- **Browser IDE Cirq install.** Bumped `cirq-core` from 1.4.1 → 1.5.0 and loaded numpy before micropip resolution so the dependency graph resolves against Pyodide 0.27's bundled numpy 2.0.2 instead of trying to pull a pure-Python numpy 1.22 wheel that doesn't exist.
- **Editor null-guard** in the inline-edit widget for strict TypeScript builds.

## [0.1.3] - 2026-04-10

### Changed
- **App icon** — redesigned with a white background instead of navy. Same lucide-style atom glyph (three elliptical orbits, central nucleus) but now uses `#0891B2` teal on a white/off-white rounded-square tile, matching the IDE's light theme. Regenerated all sizes: `32x32`, `128x128`, `128x128@2x`, `icon.png` (1024), `icon.icns` (macOS iconset), `icon.ico` (Windows multi-size), Windows Store `Square*Logo` tiles, PWA `icon-192`/`icon-512`, and the landing page inline favicon.

## [0.1.2] - 2026-04-10

### Fixed
- **Web IDE blank screen** — Monaco editor (loaded from jsDelivr CDN) was pulling version 0.55.1 which throws `Illegal value for lineNumber` on init. Pinned to 0.52.2, the last confirmed stable release compatible with `@monaco-editor/react` 4.7.x. The web version now renders the full IDE (editor, circuit, Bloch sphere, Dirac panel, terminal).
- **React crash isolation** — added a reusable `ErrorBoundary` component and wrapped `QuantumEditor` with it in `PanelLayout`, so any future editor-level error falls back to a recoverable "Retry" panel instead of taking down the whole app.
- **Defensive line-number guards** — `QuantumEditor` now clamps kernel error line numbers to the current `model.getLineCount()` before calling `setModelMarkers`, and `ghostCompletions.provideInlineCompletions` returns empty when `position.lineNumber` is out of range, eliminating a second potential path to the `Illegal value for lineNumber` crash.

### Changed
- **macOS builds are now signed AND notarized** — re-enabled `APPLE_ID` and `APPLE_PASSWORD` env vars in the release workflow. Apple's notary service recovered from the 10-hour backlog that blocked v0.1.1. New `.dmg` downloads open without any Gatekeeper warning.

## [0.1.1] - 2026-04-10

### Added
- New atom-style app icon (lucide-inspired) on a navy rounded-square background
- macOS Gatekeeper bypass instructions in README and landing page
- Basic Vitest setup with editorStore smoke tests
- `.github/pull_request_template.md`
- `src/config/kernel.ts` — WebSocket port now configurable via `VITE_KERNEL_PORT`

### Changed
- Landing page reworked to light theme matching the IDE light mode
- Landing hero and bento cards now use the IDE light theme palette
- Reveal animations now JS-opt-in so content is visible without JavaScript
- Moved internal PRD and planning docs to `docs/internal/`
- Replaced PWA favicon and icons with new atom design

### Fixed
- Removed all `console.log/warn/error` from production code (dev-gated where needed)
- Fixed pre-existing type error in `QuantumEditor.tsx`
- Fixed misleading claims about Rust and Python test suites in README/CONTRIBUTING

## [0.1.0] - 2026-04-09

### Added
- Monaco code editor with quantum-aware syntax highlighting and autocomplete
- Live circuit visualization powered by D3.js (renders as you type)
- Interactive 3D Bloch sphere with Three.js
- Probability histogram display after simulation
- Dirac AI assistant powered by Claude (BYOK -- bring your own Anthropic API key)
- Ghost completions and inline AI edit (Cmd+K)
- Qiskit framework support with AerSimulator
- Cirq framework support with cirq.Simulator
- CUDA-Q framework support (requires NVIDIA GPU)
- IBM Quantum hardware backend integration
- Dark and light themes
- Keyboard shortcuts and command palette (Cmd+Shift+P)
- 17 structured learning tracks (Python basics through quantum history)
- Interactive exercises with AI-powered verification
- Capstone projects
- Challenge mode with community submissions
- Quantum gate explorer and glossary
- Step-through circuit debugging
- Web version via Pyodide (no local Python required)
- Platform abstraction layer (desktop via Tauri, browser via Pyodide)
- File operations (open, save, save-as)
- Beginner / Intermediate / Advanced UI complexity modes
- Internationalization support
