# Nuclei for iOS — Phase 0 & 1 implementation plan

Companion doc to [`PRD_13_NUCLEI_FOR_IOS.md`](./PRD_13_NUCLEI_FOR_IOS.md). This is
the concrete build sheet for the **no-backend MVP** (Tier 1): a native quantum
studio + tutor that ships to the App Store without any server standing up.

Phase 0 lays the foundation and the protocol contract. Phase 1 delivers a usable
app. Everything here is offline-capable or needs only the user's Anthropic key.

---

## Repository layout (this PR seeds it)

```
ios/
├── NucleiKit/                      # SwiftPM package — the reusable core (started here)
│   ├── Package.swift
│   ├── Sources/NucleiKit/
│   │   ├── Protocol/               # Codable mirror of src/types/quantum.ts  ✅ seeded
│   │   ├── Session/                # KernelSession + Remote + Local           ✅ seeded
│   │   └── Simulator/              # native statevector engine + debugger     ✅ seeded
│   └── Tests/NucleiKitTests/       # protocol-decode + simulator parity tests ✅ seeded
└── NucleiApp/                      # the SwiftUI app target                    ⬜ Phase 1
    ├── App/                        # entry, navigation shell, theme
    ├── Features/                   # composer, viz, dirac, learn, hardware
    ├── Models/                     # @Observable stores (mirror Zustand)
    └── Resources/                  # lessons/challenges/glossary JSON, assets
```

`NucleiKit` has **no UIKit/SwiftUI dependency** so it stays unit-testable on the
command line (`swift test`) and shareable with the widget/Watch targets later.

---

## Phase 0 — Foundations (2–3 weeks)

**Goal:** a compiling package, a locked protocol contract, and an empty-but-navigable app shell.

### 0.1 NucleiKit package  ✅ *seeded in this PR*
- [x] `Protocol/` — Codable structs/enums mirroring `src/types/quantum.ts`:
  `Framework`, `KernelLanguage`, `Gate`, `CircuitSnapshot`, `Complex`,
  `BlochCoord`, `SimulationResult`, `KernelEnvironment`, `HardwareJob`/`JobStatus`,
  `KernelErrorFrame`, and the `KernelMessage`/`KernelResponse` envelopes.
- [x] `Session/` — `KernelSession` protocol + `request(_:)` drain helper,
  `RemoteKernelSession` (WebSocket), `LocalSimulatorSession`, `ResponseHub`.
- [x] `Simulator/` — `StatevectorSimulator`, `Complex` math, `SeededRNG`, `DebugTrace`.
- [x] Tests — protocol decode (incl. absent `seed_honored`, unknown types) and
  simulator parity (Bell, GHZ, |+⟩, seeded reproducibility, debugger alignment).

### 0.2 Protocol fidelity harness
- [ ] Copy the kernel's replay fixtures (`kernel/tests/*fixtures*`,
  `docs-site/.../fixtures/*.json`) into `Tests/Fixtures/` and add a test that
  decodes each — the guarantee that Swift models never drift from the wire.
- [ ] A CI job (`swift test`) on macOS runners; add to the repo's Actions matrix.
- [ ] Document the **one rule**: the TypeScript `quantum.ts` is the source of
  truth; a protocol bump updates it first, then NucleiKit.

### 0.3 App shell
- [ ] Xcode project `NucleiApp` (universal iPhone/iPad), min iOS 17, add
  `NucleiKit` as a local package dependency.
- [ ] Design tokens: navy `#0F1B2D`, teal `#00B4D8`, Dirac purple `#7B2D8E`,
  teal-biased slate neutrals; light + dark; JetBrains Mono (bundled) for code,
  system UI face for chrome. A `Theme` environment object.
- [ ] Navigation: `NavigationSplitView` (rail → content → inspector) on iPad,
  `TabView` on iPhone. Port the rail model from `panelRegistry.ts`
  (`activityViewsForMode`) and `workspaceStore` (learn/research, persisted).
- [ ] `@Observable` store scaffolding, one per Zustand store we need in T1:
  `EditorModel`, `CircuitModel`, `SimulationModel`, `WorkspaceModel`,
  `NavigationModel`, `DiracModel`, `SettingsModel`.

**Exit criteria:** `swift test` green; app launches to an empty themed shell that
switches Learn/Research and light/dark.

---

## Phase 1 — Local studio + Learn (5–7 weeks)

**Goal:** App Store v1.0 — a genuinely useful offline quantum studio and tutor.

### 1.1 Execution plumbing
- [ ] `ExecutionCoordinator` in the app: owns a `KernelSession`. In T1 it holds a
  `LocalSimulatorSession`; the composer pushes the live `CircuitSnapshot` via
  `setCircuit(_:)`, ⌘↵/Run sends `.execute`, results fan into `SimulationModel`.
- [ ] Wire `unsupportedGates(in:)` / `tooManyQubits` into a clear "run this on a
  kernel" banner (the honest-degradation contract).

### 1.2 Circuit composer (the flagship iPad feature)
- [ ] Gate palette (from the canonical set in `src/data/gates.ts`): H, X, Y, Z,
  S/T (+dg), RX/RY/RZ, P, CNOT/CZ, SWAP, CCX, measure.
- [ ] Drag a gate onto a qubit wire; Pencil + touch; tap to set rotation params
  via a dial; pinch/＋ to add/remove qubits; drag controls onto a gate.
- [ ] Emits `CircuitSnapshot` directly → `CircuitModel` → local execute. No parser
  needed for this path.
- [ ] Undo/redo, copy/paste, clear.

### 1.3 Native visualizations
- [ ] **Circuit renderer** (SwiftUI `Canvas`) — port `CircuitRenderer.tsx` +
  `gates.tsx`: wires, layered gate glyphs, control lines, tap tooltip + gate
  explorer popup (matrix + Bloch interpretation from the gate registry),
  highlight, step-through graying.
- [ ] **Bloch sphere** (SceneKit) — port `ClassicBlochSphere.tsx`: axes, the
  Bloch-vector arrow from `bloch_coords`, length < 1 → mixed-state hint; 120 fps.
- [ ] **Histogram** (Swift Charts) — port `ProbabilityHistogram`; sampled-vs-ideal
  toggle; step view for the debugger.
- [ ] **Debugger** — Prev/Next/Play over `StatevectorSimulator.trace(...)`; Bloch +
  histogram read the state *at the cursor* (trace computed once, cached).

### 1.4 Dirac (BYOK — no backend)
- [ ] `DiracKit` (or a `Dirac/` folder in the app): `URLSession` POST to
  `https://api.anthropic.com/v1/messages`, headers `x-api-key`,
  `anthropic-version: 2023-06-01`; SSE streaming parse (text/thinking/tool_use).
- [ ] Key in **Keychain** (not localStorage); Settings screen to enter/validate
  (`sk-ant-` prefix). Model IDs from `src/config/dirac.ts`.
- [ ] Port `diracRouting.ts` (Haiku/Sonnet + thinking + tools heuristics) and
  `diracPersona.ts` (Learn tutor / Research collaborator) verbatim in spirit.
- [ ] `buildContextBlock` port: inject code/composer circuit, probabilities,
  Bloch, errors per the `contextDepth` setting.
- [ ] Client-side chat tools: `insert_code`, `run_simulation` (local),
  `highlight_gate`, `step_to`, `glossary_lookup`, `create_exercise`,
  `verify_solution`. Native **voice input** (Speech framework).

### 1.5 Learn mode (content-driven, fully offline)
- [ ] Bundle `src/data/lessons/track0…track17`, `src/data/challenges/*`,
  `glossary.ts`, `conceptMap.ts` as JSON resources (write a small TS→JSON export
  script so content stays single-sourced from the web app).
- [ ] Lesson views: text/quiz/exercise/interactive-demo/interactive-Bloch blocks;
  `LearningPathSidebar`/`TrackSelector` equivalents; progress persisted (SwiftData).
- [ ] Challenges: problem browser + workspace; the test runner validates against
  the **local simulator**; hints via Dirac; submission history.
- [ ] Quantum Playground = the composer with a guided first-run overlay.
- [ ] Progressive disclosure: port `uiModeStore` (beginner→advanced), Learn-only.

### 1.6 Platform polish
- [ ] Handoff + iCloud documents (continue a circuit desktop ↔ iPad).
- [ ] Shortcuts / App Intents: "Simulate this circuit", "Ask Dirac".
- [ ] Accessibility pass (VoiceOver labels on gates/Bloch/charts, Dynamic Type).
- [ ] Privacy manifest declaring the Anthropic network call; no baked secrets.

**Exit criteria:** compose a Bell/GHZ circuit by touch, run it offline, see the
Bloch sphere + histogram + step-through, ask Dirac about it, complete a lesson and
a challenge — all with no backend beyond the user's Anthropic key. Ship v1.0.

---

## What Phase 2+ adds (recap, for sequencing)

- **Phase 2 — Hardware companion:** `JobStore` + iCloud sync of desktop jobs,
  monitor UI, **Live Activities**, notifications. Read-only monitoring ships with
  no backend; push + submission need the gateway.
- **Phase 3 — Remote kernel:** the gateway (auth, per-user sandboxed kernels,
  APNs) + `RemoteKernelSession` for full frameworks and hardware submission.
- **Phase 4 — Research on the go:** experiments + QEC campaign monitoring.

See the PRD's roadmap (§11) and backend requirements (§9).

---

## Testing strategy

- **NucleiKit:** `swift test` — protocol decode against kernel fixtures; simulator
  parity (analytic states + a golden-value set captured from the Python kernel for
  a handful of circuits, so the Swift engine is provably faithful).
- **App:** snapshot tests for the composer→snapshot mapping and the visualization
  renders; a Learn-mode content-integrity test (every lesson/challenge JSON loads).
- **Dirac:** mock the `URLSession` to test routing/persona/context assembly without
  spending tokens (mirrors how `diracRouting.test.ts` etc. are structured today).
