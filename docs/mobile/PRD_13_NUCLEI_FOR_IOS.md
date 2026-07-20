# PRD 13 — Nuclei for iOS (Swift)

**Status:** Draft / proposal
**Author:** Planning spike (deep research over the Nuclei codebase, v0.13.0)
**Target platforms:** iPadOS 17+ (primary), iOS 17+ (companion), visionOS (stretch)
**Language:** Swift 6 / SwiftUI (native), with a shared `NucleiKit` Swift package

---

## 0. TL;DR

Nuclei is a desktop-and-web quantum workspace: a Monaco editor, live circuit
rendering, a Bloch sphere, histograms, an AI tutor/collaborator (Dirac), and — in
Research mode — declarative experiments, a QEC Studio, and eight hardware
providers. The quantum work happens in a **Python kernel** the frontend talks to
over a localhost WebSocket (protocol fully typed in `src/types/quantum.ts`); Dirac
is the Claude API called **directly from the client** with the user's own key.

**Recommendation:** build a **native Swift / SwiftUI universal app** — not a
WKWebView wrapper — organized around a reusable `NucleiKit` Swift package. Ship in
three tiers so we never block on backend infrastructure:

1. **Companion + Learn (no backend):** a native local Swift statevector simulator
   for small circuits, the full Learn curriculum, a touch/Pencil circuit composer,
   native Bloch/histogram, Dirac chat (BYOK, direct to `api.anthropic.com`), and —
   the standout companion feature — **hardware job monitoring with Live Activities
   and push**. Everything here works offline or with only Anthropic's API.
2. **Remote kernel (hosted backend):** a thin WebSocket client speaking the
   existing kernel protocol against a hosted, authenticated kernel gateway, which
   unlocks the *full* framework set (Qiskit, Cirq, CUDA-Q, Q#, Stim), real hardware
   submission, experiments, and QEC campaigns on device. This is literally the
   roadmap's **PRD 10 (remote kernel)** — iOS is its first-class beneficiary.
3. **Research on the go:** experiment-sweep and QEC-campaign monitoring, sweep /
   threshold / Λ plots, transpiler explorer, and reproducibility records, driven by
   the same hosted kernel and file objects.

The honest constraint that shapes everything: **iOS cannot run Python locally.**
There is no Tauri `start_kernel` subprocess and no supported Pyodide-in-WKWebView
path for the full stack. So we either (a) run a *native Swift* simulator for the
subset we implement ourselves, or (b) talk to a *remote* kernel. The plan does
both, and degrades honestly when neither is available.

---

## 1. Why an iOS app, and how it furthers quantum R&D

Nuclei's mission is "learn it, research it, run it on real hardware," free and
open-source, aimed first at students. An iOS app extends that mission along axes a
desktop app structurally cannot:

**It furthers *research and development* specifically by:**

1. **Untethering hardware jobs from the desk.** Real QPU jobs queue for *minutes to
   hours*. Today the desktop kernel persists jobs to `~/.nuclei/jobs.json` and you
   must sit at the machine to watch them. A phone with **Live Activities** (queue
   position on the Lock Screen) and **push notifications** ("IonQ Aria job complete,
   1,024 shots") turns dead queue time into ambient awareness. This is the single
   highest-value companion feature and it maps directly onto the existing
   `hardware_*` protocol and `JobHandle` model.
2. **Monitoring long sweeps and QEC campaigns.** A parameter sweep is capped at 500
   points and a sinter campaign runs Monte-Carlo to a shot/error budget — both are
   long-running. The runner already *streams* progress (`qec_campaign_progress`).
   Watching a sweep plot or a threshold/Λ curve fill in from a phone, and getting
   pinged when it finishes, is real research utility.
3. **A better circuit-composition modality.** On a desktop you type `qc.h(0)`. On an
   iPad with Apple Pencil you can *drag an H gate onto a wire*. A two-way
   touch↔code composer (round-tripping through `CircuitSnapshot`) is a genuinely
   superior authoring surface for exploration and teaching — the kind of thing
   Swift Playgrounds proved for programming.
4. **Lowering the on-ramp.** Learn mode is entirely self-contained content
   (`src/data/lessons/track0…track17`, challenges, glossary, concept map). On a
   phone it becomes commute-sized quantum education — the widest possible top of the
   funnel for the field.
5. **Dirac in your pocket.** The AI collaborator needs no backend — it's a direct
   BYOK call to Anthropic. Native voice input + context injection means you can ask
   "why did my two-qubit count triple on this backend?" against a live circuit
   anywhere.
6. **Continuity with the desktop.** Handoff and iCloud sync mean a circuit or
   experiment started on the desktop continues on iPad and vice-versa — the research
   loop follows the researcher.

**Who it's for:** students (Learn, playground, challenges), and working
researchers/engineers who want to *monitor and steer* long-running quantum work and
do lightweight authoring away from their workstation. It is a **companion and a
lightweight studio**, not a claim to replace the desktop IDE for heavy simulation.

---

## 2. Target devices & positioning

| Surface | Role | Emphasis |
|---|---|---|
| **iPad (11"/13", M-series)** | **Primary.** Full studio. | Pencil circuit composer, split-view editor + viz, Metal Bloch sphere, experiments/QEC monitoring, Stage Manager multi-panel |
| **iPhone** | Companion. | Hardware job monitoring, Live Activities, Dirac chat, Learn/challenges, quick simulate, widgets |
| **Mac (Catalyst / native)** | Optional. | The desktop app already exists (Tauri); a Catalyst build is a stretch, not a goal |
| **Apple Watch** | Stretch. | Job-complete notifications, queue-position complication |
| **visionOS** | Stretch. | A Bloch sphere and circuit you can place in space is a natural fit |

Positioning: **"The quantum workspace, in your hands."** iPad-first because the IDE
surface needs room; iPhone as the always-with-you research monitor.

---

## 3. Architecture options considered

Three viable shapes; we evaluated each against the codebase.

### Option A — WKWebView wrapper around the existing web build (hybrid)
Reuse `npm run build:web` (the Pyodide/Cirq browser build) inside a WKWebView and
add a third `PlatformBridge` implementation (`iosBridge`) alongside `tauriBridge` /
`webBridge` at `src/platform/bridge.ts`.

- **Pros:** lowest effort; every visualization (Three.js Bloch, SVG circuit,
  Recharts histogram, Monaco, the Q# `qsharp-lang` WASM language service) already
  runs in a webview; Dirac's `fetch` works unchanged; the `PlatformBridge` seam is
  purpose-built for exactly this.
- **Cons:** **only Cirq runs client-side** via Pyodide (Qiskit/CUDA-Q/Q# execution
  are unavailable in the web build — they translate to "download the desktop app").
  Pyodide is a multi-MB CDN download that App Store review dislikes and that starts
  slowly on device. Monaco has real touch-input problems on iOS. `webBridge` leans
  entirely on `localStorage`, which is unreliable in embedded webviews (there is
  already a code comment to this effect in `useKernel.ts`). The File System Access
  API isn't in WKWebView. It would never *feel* like an iOS app.
- **Verdict:** the fastest MVP, but a ceiling on quality and framework coverage. Good
  as a fallback or a v0 spike; not the product.

### Option B — Native Swift, thin client to a remote kernel
Reimplement the UI natively in SwiftUI and speak the kernel WebSocket protocol to a
**hosted** kernel.

- **Pros:** best feel; full framework set (the hosted kernel is real CPython with
  Qiskit/Cirq/CUDA-Q/Q#/Stim); protocol is already "network-clean" and fully typed.
- **Cons:** requires standing up backend infrastructure (see §9) *and* it means the
  app does nothing useful offline or before that backend exists.
- **Verdict:** the right *long-term* execution path, but can't be the whole plan —
  we shouldn't gate v1 on backend infra.

### Option C — Native Swift, local Swift simulator + optional remote kernel  ← **RECOMMENDED**
Native SwiftUI app. A shared `NucleiKit` package contains (1) Codable models
mirroring `src/types/quantum.ts`, (2) a WebSocket kernel client, and (3) a **native
Swift statevector simulator** that produces the *same* `CircuitSnapshot` /
`SimulationResult` shapes as the Python kernel for the gate set we support. The app
uses the local simulator when possible and the remote kernel when available.

- **Pros:** works offline and with zero backend for a real, useful subset (small
  circuits, all of Learn, the composer, Dirac). Native feel. The remote kernel is an
  *additive upgrade*, not a prerequisite. The local simulator is a bounded, testable
  piece of Swift (statevector over ≤ ~16 qubits is trivial on an M-series iPad).
- **Cons:** a native simulator is new code we must keep faithful to the kernel's
  output conventions (endianness, probability pruning, Bloch coords). Two execution
  backends to reconcile.
- **Verdict:** **chosen.** It honors "build it in Swift," ships value immediately,
  and cleanly absorbs the remote kernel later.

> **The seam that makes this clean:** Nuclei already abstracts execution behind a
> single interface. `KernelSession` (`src/services/kernelSession.ts`) has exactly
> two methods — `send(message)` and `close()` — and today has a WebSocket
> implementation and a Pyodide implementation. On iOS we add a **third**: a
> `LocalSimulatorSession` that answers `parse`/`execute` from native Swift. The rest
> of the app is written against the session interface, not the transport.

---

## 4. Recommended architecture (Option C in detail)

```
┌──────────────────────────── iOS App (SwiftUI) ───────────────────────────┐
│  App target: Nuclei (universal iPhone/iPad)                              │
│  ┌───────────────┬──────────────┬───────────────┬──────────────────────┐ │
│  │ Editor        │ Circuit      │ Bloch (Metal) │ Histogram (Swift     │ │
│  │ (Runestone)   │ Composer     │ SceneKit/RK   │  Charts)             │ │
│  ├───────────────┴──────────────┴───────────────┴──────────────────────┤ │
│  │ Dirac chat  │ Hardware monitor │ Experiments │ Learn / Challenges    │ │
│  └───────────────────────────────────────────────────────────────────── │ │
│                    State: @Observable stores (mirror Zustand)            │
│                                    │                                      │
│                         ┌──────────┴───────────┐                          │
│                         ▼                      ▼                          │
│              ┌────────────────────┐  ┌──────────────────────┐            │
│              │ NucleiKit (SwiftPM)│  │ DiracKit             │            │
│              │  • Protocol models │  │  • BYOK Anthropic     │            │
│              │  • KernelSession   │  │    client (URLSession)│            │
│              │    ├ Remote (WS)   │  │  • persona / routing  │            │
│              │    └ LocalSimulator│  │  • context injection  │            │
│              │  • JobStore        │  │  • tool executor      │            │
│              └─────────┬──────────┘  └──────────┬───────────┘            │
└────────────────────────┼────────────────────────┼───────────────────────┘
                         │ wss:// (protocol v1)    │ https://api.anthropic.com
                         ▼                          ▼
              ┌────────────────────────┐   ┌────────────────────┐
              │ Hosted Nuclei Kernel   │   │ Anthropic API      │
              │ Gateway (§9) — per-user│   │ (user's own key)   │
              │ kernel, auth, TLS      │   └────────────────────┘
              └────────────────────────┘
```

### 4.1 `NucleiKit` (Swift package) — the reusable core

The whole point: put everything transport- and platform-agnostic in a package so it
is unit-testable without UIKit and shareable across app, widget, and Watch targets.

- **`Protocol/`** — `Codable` structs mirroring `src/types/quantum.ts` **exactly**
  (see §8). This is the API contract; treat the TS file as the source of truth and
  keep them in lockstep.
- **`Session/`** — `protocol KernelSession { func send(_:) ; var events: AsyncStream<KernelResponse> }`.
  - `RemoteKernelSession` — `URLSessionWebSocketTask`, JSON frames, the streaming
    drain loop (read until the request's terminal message; relay interleaved
    `output`/`stderr`/`error`). Handles the 1 MiB frame cap, ping/pong, reconnect.
  - `LocalSimulatorSession` — answers `parse` → `snapshot` and `execute` → `result`
    from the native simulator; returns honest "not supported here" errors for
    hardware/QEC/transpile when no remote kernel is attached.
- **`Simulator/`** — the native Swift statevector engine (§5).
- **`Hardware/`** — a `JobStore` mirroring the kernel's persistence semantics
  (registry + terminal-job pruning) so monitoring survives app relaunches; the
  `hardware_*` request/response choreography.
- **`Experiments/`** — the `*.experiment.yaml` model and run-directory layout, for
  reading/monitoring runs synced from desktop or produced by the remote kernel.

### 4.2 App layer (SwiftUI)

- **State:** `@Observable` model objects (Swift Observation) that mirror the Zustand
  stores 1:1 in responsibility — `EditorModel`, `CircuitModel`, `SimulationModel`,
  `WorkspaceModel` (learn/research), `NavigationModel`, `HardwareModel`,
  `DiracModel`, `ExperimentModel`, `QecModel`, `SettingsModel`. Keeping the boundary
  identical to the web app's stores makes behavior parity checkable.
- **Navigation:** iPad uses `NavigationSplitView` (rail → content → inspector),
  mirroring the desktop's activity-bar/panel model computed in
  `src/layout/panelRegistry.ts`. iPhone uses a `TabView`. Panel-per-mode visibility
  is a direct port of `activityViewsForMode` / `resolveVisiblePanels`.
- **Workspace modes:** `learn` / `research`, persisted globally and per-project, a
  faithful port of `workspaceStore.ts` (including the "a project explicitly switched
  to Research reopens in Research" rule).

### 4.3 Tech stack (Swift specifics)

| Concern | Choice | Notes |
|---|---|---|
| UI | **SwiftUI** (Swift 6, strict concurrency) | iPad-first, `NavigationSplitView`, Stage Manager |
| Charts | **Swift Charts** | histograms, sweep plots, threshold/Λ curves — replaces Recharts |
| Bloch sphere | **SceneKit** (or RealityKit) over Metal | replaces Three.js; 120 fps ProMotion target |
| Circuit render | native **SwiftUI Canvas / SVG-equivalent** | port of the hand-rolled SVG in `CircuitRenderer.tsx` + `gates.tsx` |
| Detector graph (QEC) | SwiftUI `Canvas` | port of `DetectorGraphCanvas.tsx` |
| Code editor | **Runestone** (or CodeEditor / CodeMirror-in-WKWebView fallback) | Monaco does **not** port; needs a mobile-grade editor with Python/Q# highlighting |
| Networking | `URLSessionWebSocketTask` + `URLSession` | kernel WS + Anthropic HTTPS |
| Concurrency | Swift Concurrency (`async`/`await`, `AsyncStream`) | the streaming kernel model maps naturally |
| Secrets | **Keychain** | Anthropic key + any provider creds held on device |
| Persistence | SwiftData / files | projects, experiment run dirs, Dirac conversations |
| Sync | **iCloud (CloudKit / iCloud Documents)** + **Handoff** | continuity with desktop |
| Live status | **ActivityKit** (Live Activities) + **UserNotifications** | hardware/campaign status |
| Extensions | **WidgetKit**, **App Intents / Shortcuts**, **Spotlight** | daily challenge, job status, "simulate this" |
| Q# intelligence | `qsharp-lang` WASM in a hidden WKWebView worker (optional) | reuse the existing worker if we want Q# diagnostics |
| Local sim accel | Accelerate / Metal Performance Shaders (optional) | only if we push past ~16 qubits |

---

## 5. Native local simulator (the offline engine)

A bounded, faithful Swift statevector simulator so the app is useful with no
network. It must emit byte-compatible `CircuitSnapshot` / `SimulationResult`.

- **Scope v1:** universal single/two-qubit gate set from the gate registry
  (`src/data/gates.ts`) — H, X, Y, Z, S, T (+daggers), RX/RY/RZ, CNOT/CZ, SWAP,
  Toffoli, measurement. Up to ~16 qubits (65,536 amplitudes — trivial on M-series).
  A soft cap with an honest "run this on the kernel for N qubits" message beyond.
- **Inputs:** the **touch/Pencil composer** produces a `CircuitSnapshot` directly (no
  parsing needed) — this is the primary local path. Optionally, a small Python-subset
  or Q#-subset parse is out of scope for v1; code authored as text routes to the
  remote kernel.
- **Outputs, matching the kernel exactly (see `kernel/models/snapshot.py`):**
  `state_vector` (length 2ⁿ), `probabilities` (prune entries ≤ 1e-10), `measurements`
  (sampled counts over `shots`, honoring `seed`), `bloch_coords` (per qubit),
  `execution_time_ms`, `shot_count`, `metrics` ({}), and `seed_honored: true`
  (local sim can always seed).
- **Endianness:** pick one convention and document it; the kernel's own conventions
  differ per framework (Qiskit little-endian, Cirq/Q# big-endian) and keys are
  treated as opaque labels — the composer path lets us define our own and stay
  self-consistent.
- **Debugger/step-through:** the local engine can also emit the per-gate trajectory
  (`DebugTrace`: state after each gate) that powers step-through, cheaply, since it
  already walks gate by gate.

This is the piece that makes "built in Swift" real rather than a wrapper: we own a
correct quantum engine on device.

---

## 6. Feature specification

Organized by area, each mapped to the existing Nuclei feature it mirrors and marked
with the **tier** it lands in (T1 = companion/no-backend, T2 = remote kernel, T3 =
research on the go).

### 6.1 Circuit Composer & Editor
- **[T1] Touch/Pencil circuit composer.** A gate palette; drag gates onto qubit
  wires; tap to set parameters (rotation angles via a dial); pinch to add/remove
  qubits. Emits `CircuitSnapshot`; renders live. *New interaction, no desktop
  equivalent — the flagship iPad feature.*
- **[T1] Native circuit renderer.** Port of `CircuitRenderer.tsx` + `gates.tsx`:
  gate glyphs, layers, hover→tap tooltips, gate-explorer popup (matrix + Bloch
  interpretation from `src/data/gates.ts`), highlight, step-through graying.
- **[T1] Code editor.** Runestone-based, Python + Q# + `.stim` syntax highlighting.
  Two-way with the composer where feasible; otherwise code is authored as text and
  executed via kernel (T2).
- **[T2] Ghost completions & Cmd-K-equivalent inline edit.** Port `ghostCompletions`
  (Haiku) and `InlineEditWidget` (Sonnet) — both are just Anthropic calls, so they
  work in T1 too; grouped here because they matter most with real code.
- **[T2] Transpiler Explorer.** `transpile` → before/after snapshots, pass-by-pass
  deltas. Qiskit-only, needs the kernel.

### 6.2 Visualizations
- **[T1] Bloch sphere (Metal/SceneKit).** Port of `ClassicBlochSphere.tsx`; arrow =
  Bloch vector from `bloch_coords`, length < 1 signals mixed state; 120 fps.
- **[T1] Probability histogram (Swift Charts).** Port of `ProbabilityHistogram` /
  `MultiSeriesHistogram`; sampled-vs-ideal modes; step-view for the debugger.
- **[T1] Quantum Debugger.** Step Prev/Next/Play through the per-gate trajectory;
  Bloch + histogram show the state *at the cursor*. Local engine computes it offline.
- **[T3] QEC visualizations.** Timeline, code lattice, detector graph
  (`Canvas`-rendered), threshold/Λ plot. Read-only monitoring first; interactive
  decoder (a Swift port of the WASM decoder) is a stretch.

### 6.3 Dirac AI  (works in T1 — no backend)
- **[T1] Native chat.** Port `useDirac` orchestration: system prompt = persona +
  capabilities + injected context; streaming SSE parse; **native voice input**.
- **[T1] BYOK client.** `URLSession` POST to `https://api.anthropic.com/v1/messages`
  with `x-api-key`, `anthropic-version: 2023-06-01`. Key in **Keychain** (better than
  the web app's localStorage). Model IDs from `src/config/dirac.ts` (Haiku for fast /
  ghost, Sonnet for tools/compose/reasoning).
- **[T1] Model routing.** Direct port of `diracRouting.ts` (keyword heuristics →
  model/thinking/tools; user overrides `preferredModel`/`extendedThinking`/
  `contextDepth`).
- **[T1] Personas.** Port `diracPersona.ts` (Learn tutor / Research collaborator).
- **[T1] Context injection.** Port `buildContextBlock` — code, circuit summary,
  probabilities, Bloch, errors, hardware, experiment/QEC context per depth setting.
- **[T1] Chat tools** (client-side executor): `insert_code`, `run_simulation`
  (local or remote), `highlight_gate`, `step_to`, `create_exercise`,
  `verify_solution`, `glossary_lookup`, `challenge_hint`. `submit_hardware` is T2.
- **[T3] Compose (natural-language → full file).** Port `compose.ts` (Sonnet, forced
  `insert_code`).
- **Out of scope for iOS:** the **autonomous agent** (`agent-Dirac`) runs in a
  **Rust harness** in `src-tauri/src/dirac/` on desktop. The TS orchestrator
  (`src/services/agent/orchestrator.ts`) is platform-agnostic with injected ports, so
  a *future* iOS agent could run it in-process against the remote kernel — but its
  policy/budget/isolation guarantees are desktop-grade today. **Defer to a later PRD.**

### 6.4 Hardware — the companion killer feature
- **[T1, read-only] Job monitor.** Mirror the kernel's `JobStore`: a list of
  `JobHandle`s (id, provider, backend, status, queue_position, shots, submitted_at)
  synced from desktop via iCloud, or polled from a remote kernel. Status state
  machine per the hardware docs (queued→running→complete/failed, stale after
  restart).
- **[T1] Live Activities (ActivityKit).** Lock-Screen / Dynamic Island activity for
  an active job: provider logo, backend, queue position counting down, elapsed time;
  ends on completion. *This is the reason to have the app on your phone.*
- **[T1] Push / local notifications.** "Job complete," "queue position < 5," "job
  failed." Local notifications from client polling in T1; true **APNs push** in T2
  via the gateway (§9).
- **[T2] Submit to hardware.** Full `hardware_connect` / `hardware_submit` /
  `hardware_status` / `hardware_results` / `hardware_cancel` / `hardware_dismiss`
  flow against the remote kernel, all eight providers. **Credentials never live in
  the app** — they stay in the *kernel host's* OS keyring, exactly as today; the app
  only holds connected/disconnected booleans and triggers connects. (This is a
  crucial security property to preserve — see §10.)
- **[T2] Backend browser & connectivity map.** Port `BackendSelector` /
  `ConnectivityMap` / `ResultsComparison` (sim-vs-hardware dual bars).

### 6.5 Experiments & QEC (Research on the go)
- **[T3] Experiment monitor.** Read `*.experiment.yaml` and run directories (synced or
  remote); runs table, run detail, manifest diff, compare view, **sweep plots** —
  ports of the `experiments/` components. Reproducibility record front and center.
- **[T3] Launch/monitor sweeps & campaigns.** The runner logic
  (`experimentRunner.ts`, `qecCampaignRunner.ts`) is frontend-orchestrated with
  injected ports — portable to Swift, driving the remote kernel one point at a time.
  Stream `qec_campaign_progress`; Live Activity for campaign progress; **Λ / threshold
  panel** fills in live.
- **[T3] Resource Estimator.** Port `EstimatorPanel` over `qec_estimate`.

### 6.6 Learn mode (fully self-contained — T1)
- **[T1] Curriculum.** Ship `src/data/lessons/track0…track17` (Python, fundamentals,
  gates, algorithms, information theory, error correction, QML, chemistry, hardware,
  CUDA-Q, IBM, Cirq, real hardware, complexity, networking, history) as native lesson
  views — text/quiz/exercise/interactive-demo/video/paper blocks.
- **[T1] Challenges.** LeetCode-style problems (`src/data/challenges/`): Bell, GHZ,
  W-state, Grover, Bernstein-Vazirani, Simon, QPE, teleportation, MaxCut, BB84/E91).
  Test runner validates against the local simulator; hints (Dirac); submission
  history; performance panel.
- **[T1] Quantum Playground.** Port `QuantumPlayground` — zero-knowledge intro; the
  composer *is* the playground on iPad.
- **[T1] Glossary, Concept Map, Capstones, interactive Bloch.** All content-driven,
  all portable.
- **[T1] Progressive disclosure.** Port `uiModeStore` (beginner→advanced), Learn-only.

### 6.7 Platform integration (native superpowers)
- **[T1] Handoff + iCloud sync.** Continue a circuit/experiment across desktop ↔
  iPad ↔ iPhone.
- **[T1] Widgets (WidgetKit).** Daily challenge; active hardware job status.
- **[T1] App Intents / Shortcuts / Spotlight.** "Simulate this circuit," "Ask Dirac,"
  "Show my running jobs." Siri-accessible.
- **[T1] Share sheet & export.** Export circuit as image/OpenQASM/framework code;
  share results.
- **[Stretch] Apple Watch** complication + job-complete notifications.
- **[Stretch] visionOS** spatial Bloch sphere & circuit.

---

## 7. UX & visual design

Reuse Nuclei's identity: dark theme by default (navy `#0F1B2D`, teal `#00B4D8`
quantum accent, purple `#7B2D8E` for Dirac), light theme option, JetBrains Mono for
code, Inter for UI. Express it through native materials — SF Symbols where they fit,
Dynamic Type, full **accessibility (VoiceOver, WCAG 2.1 AA)** parity with the desktop
goal, and 60–120 fps animation for the Bloch sphere. iPad default layout mirrors the
desktop four-panel idea via `NavigationSplitView` + an inspector; iPhone collapses to
tabs.

---

## 8. Data model (Swift ⇄ protocol)

The kernel protocol is the contract. Mirror `src/types/quantum.ts` as `Codable`
Swift. Illustrative core (full set covers every `KernelMessage`/`KernelResponse`):

```swift
enum Framework: String, Codable { case qiskit, cirq, cudaq = "cuda-q", qsharp, stim }
enum KernelLanguage: String, Codable { case python, qsharp, stim }

struct Gate: Codable {
    let type: String            // "H", "CNOT", "RZ"…
    let targets: [Int]
    let controls: [Int]
    let params: [Double]        // radians
    let layer: Int
}

struct CircuitSnapshot: Codable {
    let framework: Framework
    let qubit_count: Int
    let classical_bit_count: Int
    let depth: Int
    let gates: [Gate]
}

struct Complex: Codable { let re: Double; let im: Double }
struct BlochCoord: Codable { let x, y, z: Double }

struct SimulationResult: Codable {
    let state_vector: [Complex]
    let probabilities: [String: Double]
    let measurements: [String: Int]
    let bloch_coords: [BlochCoord]
    let execution_time_ms: Double
    let shot_count: Int
    let metrics: [String: Double]      // v1.1, always present ({} when empty)
    let seed_honored: Bool?            // present only when a seed was requested
}

struct HardwareJob: Codable {           // mirrors HardwareJobDTO / JobHandle
    let id: String                      // kernel-local UUID, not the provider id
    let provider: String
    let backend: String
    let status: JobStatus               // queued|running|complete|failed|unknown|stale
    let queue_position: Int?            // -1 = provider can't say (e.g. Azure)
    let shots: Int
    let submitted_at: String            // ISO-8601 UTC
    let error: String?
}
```

Requests/responses model as enums with associated values, decoded on the `type`
discriminator. **Client rules to honor** (from the protocol docs): loop until the
request's *terminal* message; **ignore unknown fields and unknown response types**
(additive-change policy); handle the two hardware-failure shapes (bare `error`
envelope vs. `hardware_job_submitted` with `status:"failed"`); treat
`hardware_result.data.error` as the failure signal; code defensively for absent keys
(`seed_honored`, `traceback`, `dependency`, `framework`). Keep a snapshot test that
decodes the kernel's replay fixtures (`kernel/tests/…fixtures`) so the Swift models
stay in lockstep with the wire format.

---

## 9. Backend requirements (for T2/T3 — the hosted kernel gateway)

Today the kernel is explicitly **single-user, localhost-only, no auth** (it binds
`localhost`; the overview doc states `Auth | None`). User code runs with plain
`exec()` in-process, and provider credentials sit in the host's OS keyring. **You
cannot expose this to the internet as-is.** A hosted deployment needs a gateway in
front — this is the substance of roadmap **PRD 10 (remote kernel)**, and the iOS app
is its first client.

Minimum gateway responsibilities:

1. **TLS + auth.** Terminate `wss://`, authenticate the client (per-user token /
   OAuth / passkey), rate-limit. The kernel protocol itself is unchanged behind it.
2. **Per-user kernel isolation.** One kernel *process (or container)* per user —
   because hardware/credential state is process-global and shared across all
   connections to a kernel. Never multiplex distinct users onto one kernel.
3. **Sandboxing.** User code executes arbitrarily; run each kernel in a locked-down
   container (network egress policy, CPU/mem/wall limits, ephemeral FS). The existing
   `agent_worker.py` sandbox (`-I`, resource limits, import denylist, process-group
   isolation) is a model for the per-exec layer.
4. **Provider credentials.** Keep the "creds live kernel-side, never on the client"
   property. The gateway stores each user's provider secrets in a real secret manager
   and injects them into that user's kernel's keyring; the app only ever sends
   `hardware_connect` with fields the user typed, over TLS, and holds nothing.
5. **APNs relay.** A small service that watches job/campaign state transitions and
   sends **push** so the phone gets pinged even when the app is closed (T1's local
   polling only fires while the app runs).
6. **Cost & quotas.** Hosted compute isn't free; simulation minutes and hardware
   submission need quotas/billing. (Nuclei is free/open-source — so hosted execution
   is likely BYO-cloud or opt-in, not a default. See open questions.)

**Design principle:** the app must **degrade honestly** when no gateway is
configured — everything in T1 keeps working, and T2/T3 features show a clear
"connect a kernel" state rather than failing silently. A power-user escape hatch:
let advanced users point the app at *their own* kernel (e.g. their desktop reachable
over their LAN/Tailscale) via a `wss://` URL — no hosted infra required for them.

---

## 10. Security & privacy

- **BYOK Anthropic key** in the **Keychain** (upgrade over the web app's
  localStorage). Sent only to `api.anthropic.com`, only as `x-api-key`. No Nuclei
  server in the Dirac loop — same as desktop.
- **Provider credentials never touch the app** (T2). They live in the kernel host's
  secret store; the app holds only connection state. Preserve this invariant.
- **No secrets in the bundle.** Never bake `VITE_CLAUDE_API_KEY`-style keys into a
  shipped build (the web app explicitly warns about this).
- **App Store review:** avoid runtime download of executable code (rules out the
  Pyodide-from-CDN pattern of the web build for a native app — another reason for
  Option C). The native simulator is first-party code; the remote kernel is a
  network service, not downloaded code.
- **Data:** projects/experiments are the user's; iCloud sync is user-scoped. Be
  explicit in a privacy manifest about the Anthropic and kernel-gateway network
  calls.

---

## 11. Phased roadmap

Each phase is shippable. T1 needs **no backend**.

### Phase 0 — Foundations (2–3 wks)
- Xcode project (universal), `NucleiKit` SwiftPM package skeleton.
- Codable protocol models + fixture-replay decode tests against
  `kernel/tests` fixtures.
- Design system (colors, type, dark/light), `NavigationSplitView`/`TabView` shell,
  `@Observable` store scaffolding mirroring the Zustand stores.

### Phase 1 — Local studio + Learn (MVP, no backend) (5–7 wks)
- Native local statevector **simulator** (§5) with parity tests vs kernel outputs.
- **Touch/Pencil circuit composer** → snapshot → local execute.
- Native **circuit renderer**, **Bloch sphere (SceneKit)**, **histogram (Swift
  Charts)**, **step-through debugger**.
- **Dirac chat** (BYOK, Keychain, routing, personas, context, voice, client tools).
- **Learn mode**: tracks, challenges (validated on local sim), glossary, playground,
  concept map, progressive disclosure.
- Handoff + iCloud documents; Shortcuts/Spotlight basics.
- **→ App Store v1.0: a genuinely useful offline quantum studio + tutor.**

### Phase 2 — Hardware companion (3–4 wks)
- `JobStore` + iCloud sync of desktop jobs; **job monitor**, **Live Activities**,
  local notifications.
- (Requires gateway for push + remote submit — but read-only monitoring of
  desktop-synced jobs ships without it.)
- **→ v1.x: the phone becomes the research monitor.**

### Phase 3 — Remote kernel (needs gateway) (parallel backend track + 3–4 wks client)
- Stand up the **kernel gateway** (§9): TLS/auth, per-user containers, sandbox, APNs
  relay, "point at your own kernel" mode.
- `RemoteKernelSession`; full framework execution, **hardware submission** (all
  providers), Transpiler Explorer, compose.
- **→ v2.0: full-framework quantum on device.**

### Phase 4 — Research on the go (3–4 wks)
- Experiments monitor (runs table, compare, sweep plots, manifest diff), QEC
  campaign monitor (progress, threshold/Λ, resource estimator), campaign Live
  Activities.
- **→ v2.x: monitor and steer real research from anywhere.**

### Phase 5+ — Stretch
- Apple Watch, visionOS spatial viz, on-device agentic Dirac (against remote kernel),
  interactive QEC decoder (Swift port of the WASM decoder), Mac Catalyst.

---

## 12. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **No local Python** — full frameworks need a backend | High | Tier the product: native Swift simulator + Learn need no backend (T1); remote kernel is additive |
| **Backend cost/ops** for hosted execution | High | Ship T1 first; make T2/T3 opt-in; support "point at your own kernel" so power users need no hosted infra; quotas |
| **Kernel has no auth / runs arbitrary code** | High (if exposed naively) | Never expose the raw kernel; per-user sandboxed containers behind an auth gateway; preserve creds-stay-kernel-side |
| **Simulator fidelity** drift from Python kernel | Med | Parity tests against kernel fixtures; document endianness; soft-cap qubits with honest fallback to kernel |
| **Monaco doesn't port**; mobile code editing is hard | Med | Composer-first authoring (no typing) for the local path; Runestone for text; keep code optional in T1 |
| **App Store review** on downloaded code / API keys | Med | First-party Swift sim (no CDN Python); BYOK key in Keychain; no baked secrets; clear privacy manifest |
| **Protocol drift** (kernel is additive-only but evolves) | Low | Ignore-unknowns rule; fixture-replay decode tests; keep Swift models pinned to a protocol version and bump deliberately |
| **Two execution backends** to reconcile | Low | Single `KernelSession` interface; the app is written against it, not the transport |
| **Scope creep** (Nuclei is enormous) | Med | Tiering + phase gates; Research features are explicitly later; agent is deferred |

---

## 13. Open questions (decisions needed)

1. **Companion-only vs full studio ambition?** T1 (recommended) ships a real studio
   with no backend. Do we commit to the hosted-kernel backend (T2/T3), or ship T1 +
   "point at your own kernel" and defer hosted infra? This is the biggest fork.
2. **iPhone vs iPad priority for v1?** Recommendation: build universal, but polish
   iPad first (the studio needs room); iPhone leads with the hardware monitor.
3. **Hosting model & cost** for the kernel gateway, given Nuclei is free/OSS. BYO-cloud?
   Opt-in hosted with quotas? Self-host recipe?
4. **Shared core vs full rewrite.** Recommendation: native Swift `NucleiKit` (no JS
   core). Do we want any of the platform-agnostic TS (e.g. the experiment/campaign
   runners, the agent orchestrator) reused via an embedded JS runtime later, or port
   everything to Swift? Recommendation: port to Swift; keep TS as the reference spec.
5. **Editor choice** — Runestone vs CodeEditor vs a CodeMirror-in-WKWebView island.
6. **visionOS / Watch** — in or out of the first two years?

---

## 14. Effort estimate (rough)

- **v1.0 (T1, no backend):** ~10–13 weeks, 1–2 iOS engineers. Highest-value, lowest-risk.
- **v1.x (T2 monitor, read-only):** +3–4 weeks client (push needs the gateway).
- **v2.0 (T3, hosted kernel):** backend is the long pole — a dedicated backend track
  for the gateway (auth, per-user sandboxed kernels, APNs), plus ~6–8 weeks client.
- **Research + stretch:** ongoing.

---

## Appendix A — Key source references (for the implementing team)

- **Protocol contract:** `src/types/quantum.ts` (mirror to Swift verbatim);
  `docs-site/src/content/docs/kernel-api/*` (message-by-message, with replay
  fixtures in `kernel/tests`).
- **Execution seam:** `src/services/kernelSession.ts` (`send`/`close`),
  `src/platform/bridge.ts` (`PlatformBridge`), `src/platform/PlatformProvider.tsx`
  (platform detection), `src/hooks/useKernel.ts` (the full client behavior to port).
- **Kernel/data models:** `kernel/models/snapshot.py`, `kernel/models/errors.py`,
  `kernel/server.py`, `kernel/executor.py`, `kernel/adapters/*`.
- **Hardware:** `kernel/hardware/*` (providers, manager, job store, credential
  store); `docs-site/src/content/docs/hardware/overview.mdx`.
- **Dirac (portable to iOS as-is):** `src/services/claudeClient.ts`,
  `compose.ts`, `diracPersona.ts`, `diracRouting.ts`, `src/hooks/useDirac.ts`,
  `src/config/dirac.ts`.
- **Agent (desktop-only today, defer):** `docs/dirac-agent/`,
  `src-tauri/src/dirac/`, `src/services/agent/orchestrator.ts`.
- **Visualizations to port:** `src/components/circuit/{CircuitRenderer,gates}.tsx`,
  `src/components/bloch/ClassicBlochSphere.tsx`,
  `src/components/histogram/*`, `src/components/qec/DetectorGraphCanvas.tsx`.
- **Research:** `src/services/experimentRunner.ts`, `qecCampaignRunner.ts`,
  `src/types/experiment.ts`, `src/types/qec.ts`;
  `docs-site/src/content/docs/research/*`.
- **Content (ships in-app):** `src/data/lessons/*`, `src/data/challenges/*`,
  `src/data/glossary.ts`, `src/data/conceptMap.ts`.
- **Layout/nav model:** `src/layout/panelRegistry.ts`,
  `src/components/layout/panelRegistry.ts`, `src/stores/workspaceStore.ts`.
- **Feasibility note:** `docs-site/src/content/docs/introduction/desktop-vs-web.mdx`
  (the capability matrix that rules out a pure-webview full-framework client).
```
