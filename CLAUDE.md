# CLAUDE.md — Nuclei

## Project Overview

Nuclei is a purpose-built desktop IDE for quantum computing. It combines a Monaco code editor with live circuit visualization, Bloch sphere animations, probability histograms, and an AI teaching assistant called Dirac (powered by Claude API). The primary audience is students taking their first quantum computing course.

**This is a free, open-source tool. No monetization. People download the .dmg and code on it.**

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Desktop Shell | **Tauri 2.x** (Rust) | ~10MB binary, handles process management, file I/O, IPC |
| Frontend | **React 19 + TypeScript** | Vite for bundling, all UI lives here |
| State Management | **Zustand** | Minimal boilerplate, reactive updates across panels |
| Code Editor | **Monaco Editor** | VS Code's engine — syntax highlighting, autocomplete |
| Circuit Rendering | **D3.js** + custom SVG | Live circuit diagrams that update as you type |
| 3D Rendering | **Three.js** | Bloch sphere visualization |
| Charts | **D3.js or Recharts** | Probability histograms |
| Python Kernel | **Managed subprocess + WebSocket** | Executes Qiskit/Cirq/CUDA-Q code; routes Q# source through the `qdk` package |
| Q# / QDK | **qdk (Python) + qsharp-lang (WASM)** | Source-mode kernel adapter; QDK language service in Monaco (diagnostics, completions, hover) |
| AI Assistant | **Claude API** (Haiku for fast, Sonnet for complex) | Dirac — Claude API wrapper with tutor persona, system prompt, context injection, and tool definitions |
| Build | **Vite + Tauri CLI** | HMR in dev, .dmg packaging for release |
| Python Bundling | **conda-pack** (later) | So users don't need Python installed |

## Architecture

Three-layer architecture:

### Layer 1: Tauri Shell (Rust) — `src-tauri/`
- Spawns and manages the Python kernel process
- File system operations (project open/save/watch)
- IPC bridge — typed commands between frontend and backend
- Auto-updater, native menus, system tray

### Layer 2: Frontend (React + TypeScript) — `src/`
- Monaco Editor with Python + Qiskit/Cirq/CUDA-Q aware IntelliSense
- Circuit diagram renderer (D3.js SVG)
- Bloch sphere (Three.js)
- Probability histogram
- Dirac AI chat panel
- Panel layout system (resizable, rearrangeable)
- Zustand stores for circuit state, editor state, simulation results

### Layer 3: Python Kernel — `kernel/`
- WebSocket server that receives code from the frontend
- Framework adapters that convert Qiskit/Cirq/CUDA-Q circuits into a universal CircuitSnapshot format
- Simulation execution and result serialization
- Auto-detects framework from imports

## Key Data Structures

```typescript
// Sent from kernel to frontend on every code change (lightweight, no simulation)
interface CircuitSnapshot {
  framework: 'qiskit' | 'cirq' | 'cuda-q' | 'qsharp';
  qubit_count: number;
  classical_bit_count: number;
  depth: number;
  gates: Array<{
    type: string;          // 'H', 'CNOT', 'RZ', etc.
    targets: number[];     // qubit indices
    controls: number[];    // control qubit indices
    params: number[];      // rotation angles, etc.
    layer: number;         // depth position
  }>;
}

// Sent from kernel to frontend after explicit execution (Cmd+Enter)
interface SimulationResult {
  state_vector: Array<{ re: number; im: number }>;
  probabilities: Record<string, number>;
  measurements: Record<string, number>;
  bloch_coords: Array<{ x: number; y: number; z: number }>;
  execution_time_ms: number;
}
```

## Data Flow (Critical Path)

1. User types code in Monaco Editor
2. On change (300ms debounce), frontend sends code to Python kernel via WebSocket
3. Kernel parses code, detects framework, builds circuit object
4. Kernel extracts CircuitSnapshot (gate list, qubit count — NO simulation) and returns JSON
5. Frontend renders circuit diagram from snapshot in real time
6. User presses Cmd+Enter → kernel runs full simulation → returns SimulationResult
7. Frontend updates Bloch sphere + histogram panels

Q# follows the same path but routes through a source-mode adapter: the kernel hands raw Q# source to the `qdk` interpreter and never runs it through Python `exec`.

## Project Structure

```
nuclei/
├── src-tauri/                   # Rust backend
│   ├── src/
│   │   ├── main.rs              # Entry point, window setup
│   │   ├── commands/            # Tauri IPC commands
│   │   │   ├── kernel.rs        # Python process management
│   │   │   ├── filesystem.rs    # File I/O operations
│   │   │   └── settings.rs      # User preferences
│   │   └── kernel/
│   │       └── manager.rs       # Kernel lifecycle management
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                         # React frontend
│   ├── components/
│   │   ├── editor/              # Monaco wrapper
│   │   ├── circuit/             # Circuit diagram renderer
│   │   ├── bloch/               # Bloch sphere (Three.js)
│   │   ├── histogram/           # Probability charts
│   │   ├── dirac/               # AI assistant panel
│   │   ├── terminal/            # Output terminal
│   │   └── layout/              # Panel system & drag-drop
│   ├── stores/                  # Zustand state stores
│   │   ├── circuitStore.ts
│   │   ├── editorStore.ts
│   │   └── simulationStore.ts
│   ├── hooks/                   # Custom React hooks
│   ├── types/                   # TypeScript type definitions
│   └── App.tsx
├── kernel/                      # Python kernel
│   ├── server.py                # WebSocket server entry point
│   ├── executor.py              # Code execution engine
│   ├── adapters/
│   │   ├── base.py              # Abstract adapter interface
│   │   ├── _math.py             # Shared state-vector math helpers
│   │   ├── qiskit_adapter.py
│   │   ├── cirq_adapter.py
│   │   ├── cudaq_adapter.py
│   │   └── qsharp_adapter.py    # Source-mode Q# adapter (qdk package)
│   ├── models/
│   │   ├── snapshot.py          # CircuitSnapshot + SimulationResult dataclasses
│   │   └── errors.py            # KernelError dataclass
│   └── requirements.txt
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Framework Abstraction

Each quantum framework has an adapter in `kernel/adapters/` that converts framework-specific circuit objects into the universal CircuitSnapshot format. The kernel auto-detects which framework the user is using by analyzing imports (or Q# syntax — auto-detection is not limited to Python imports). Q# is a source-mode framework: `AdapterSpec.source_mode` routes raw Q# source straight to the adapter, never through Python `exec`.

| Framework | Circuit Object | Simulator | Adapter |
|-----------|---------------|-----------|---------|
| Qiskit | QuantumCircuit | AerSimulator | qiskit_adapter.py |
| Cirq | cirq.Circuit | cirq.Simulator | cirq_adapter.py |
| CUDA-Q | cudaq.kernel | cudaq.sample() | cudaq_adapter.py |
| Q# | (source-mode — Q# source, no Python circuit object) | qsharp (qdk package) sparse simulator | qsharp_adapter.py |

## Gate Mapping (Universal Registry)

| Canonical | Qiskit | Cirq | CUDA-Q | Q# |
|-----------|--------|------|--------|----|
| H | qc.h(q) | cirq.H(q) | h(q) | H(q) |
| CNOT | qc.cx(c, t) | cirq.CNOT(c, t) | cx(c, t) | CNOT(c, t) |
| RZ | qc.rz(θ, q) | cirq.rz(θ)(q) | rz(θ, q) | Rz(θ, q) |
| Measure | qc.measure(q, c) | cirq.measure(q) | mz(q) | M(q) / MResetZ(q) |
| Toffoli | qc.ccx(c1, c2, t) | cirq.TOFFOLI(c1,c2,t) | x.ctrl(c1, c2, t) | CCNOT(c1, c2, t) |

## UI Layout

Default four-panel layout:
- **Left panel (60%):** Monaco code editor
- **Right panel (40%):** Circuit diagram (top) + Bloch sphere (bottom), stacked
- **Bottom panel (collapsible):** Tabs — Terminal, Histogram, Dirac chat
- **Status bar:** Framework indicator, qubit count, circuit depth, sim status

All panels resizable and rearrangeable. Layout persists across sessions.

## Visual Design

- **Dark theme** by default (navy background #0F1B2D, teal accents #00B4D8)
- Light theme option
- **Code font:** JetBrains Mono
- **UI font:** Inter
- **Quantum elements:** Teal (#00B4D8)
- **Dirac AI elements:** Purple (#7B2D8E)
- 60fps animation target for Bloch sphere

## Dirac (AI Assistant)

Dirac is a Claude API wrapper with a quantum computing tutor persona. Named after Paul Dirac. There is no custom model — Dirac is Claude (Haiku for fast interactions, Sonnet for complex reasoning and tool use) called through the Anthropic API with a system prompt, context injection pipeline, and tool definitions that shape its behavior.

**What makes Dirac "Dirac":**
- A system prompt that establishes the tutor persona (patient, beginner-friendly, named Dirac)
- Context injection: the user's current code, CircuitSnapshot, SimulationResult, errors, and framework are injected into each API call
- Tool definitions passed to Claude's tool use API that let Dirac act on the IDE
- Student model data (Phase 5+) injected into the system prompt so Dirac adapts to skill level

**Capabilities (via system prompt + tools):**
- Context-aware help (sees current code, circuit, simulation results)
- Concept explanations calibrated for beginners
- Code generation and insertion
- Error diagnosis with plain-English explanations
- Gate explorer (explain any gate with matrix + Bloch sphere interpretation)
- Exercise mode (generate challenges, verify solutions)

**Tools (passed to Claude's tool use API):**
- `insert_code` — insert code at cursor or replace selection
- `run_simulation` — execute current circuit
- `highlight_gate` — highlight a gate in the visualization
- `step_to` — advance step-through to a specific gate
- `create_exercise` — generate a quantum exercise
- `verify_solution` — check student's answer

**Model selection:** Haiku for fast Q&A and ghost completions. Sonnet for tool use, code generation, reasoning mode, and complex explanations. Selection logic lives in the frontend — route based on detected intent.

## Workspace Modes (Learn / Research)

Nuclei is one app with two workspaces over a shared core, chosen via
`src/stores/workspaceStore.ts` (`mode: 'learn' | 'research'`, persisted
globally and per-project — a project explicitly switched to Research
reopens in Research):

- **Learn** — everything Nuclei has always been: lessons, challenges, Dirac
  as tutor, progressive disclosure via `uiModeStore` (beginner→advanced).
  Unchanged and still the default; byte-compatibility is enforced by a
  panel-registry snapshot test.
- **Research** — a workspace for people *doing* quantum computing:
  multi-file projects, the Experiments panel (declarative parameter sweeps,
  runs table, run detail, comparison, sweep plots — see below), and Dirac
  as a terse collaborator instead of a tutor. `uiModeStore` is ignored in
  Research — it's always "advanced".

Panel visibility per mode is computed once in
`src/components/layout/panelRegistry.ts` (`activityViewsForMode`), not via
scattered conditionals. Entry points: the first-launch/no-project chooser
("Learn quantum computing" / "Research workspace"), the command palette
("Switch workspace mode"), and a status-bar toggle pill. Dirac's persona
per mode lives in `src/services/diracPersona.ts` (`personaPreamble(mode)`),
threaded through `compose.ts`, `errorRewrite.ts`, `narration.ts`, ghost
completions, and the chat panel.

## Experiments (Research Mode)

An **experiment** is a named, declarative, git-friendly object — plain
files in the project directory, no database — capturing code + parameters
+ backend + seed + environment + results. Source of truth is a hand- or
GUI-editable YAML file; everything downstream (runs, manifests, plots) is
generated from it.

```
myproject/
├── vqe_h2.py                        # ordinary user code, any framework
├── experiments/
│   ├── theta-sweep.experiment.yaml  # experiment definition (source of truth)
│   └── theta-sweep/runs/
│       └── 20260712-141530-a3f9/
│           ├── manifest.json        # reproducibility record (see below)
│           ├── result.json          # SimulationResult or hardware result
│           ├── snapshot.json        # CircuitSnapshot for this point
│           ├── metrics.json         # derived + user-recorded metrics
│           ├── stdout.txt
│           └── stderr.txt
```

`*.experiment.yaml` (schema `1`): `name`, `entry` (file to run), `language`
(`python` | `qsharp`, inferred from extension), `backend` (`{provider,
target}`, `simulator` or any hardware provider id), `shots`, `seed` (base;
point *i* runs with `seed + i`), an optional `sweep` (map of parameter name
→ `range: [start, stop, step]` or `values: [...]`; cartesian product across
parameters, first-declared varies fastest, hard-capped at **500 points**),
and optional `notes`. Grid expansion and the full schema live in
`src/types/experiment.ts`; the sequential sweep runner (frontend
orchestrates, kernel stays dumb — one `execute`/`hardware_submit` per
point) lives in `src/services/experimentRunner.ts`.

Parameters reach code via a `params` dict always injected into the Python
exec namespace (`{}` outside experiments — `params.get("theta", default)`
is the portable pattern), or by name-binding to a Q# entry operation's
declared `Double`/`Int` arguments. **A parameterized Q# entry operation
must not be named `Main`** — qdk's compiler itself rejects a parameterized
`Main` (`entry point cannot have parameters`); use any other name (e.g.
`Rotate`). Full schema reference, `manifest.json` shape, metrics, and the
`range` epsilon semantics: `docs-site/src/content/docs/research/experiments.mdx`.
Reproducibility guarantees and honest limits (hardware noise, unseedable
backends, the `dirty` git flag): `docs-site/src/content/docs/research/reproducibility.mdx`.

## Kernel Protocol v1.1

Additive-only extensions to the `execute` message and one new message type,
introduced for Research-mode experiments but usable from any client:

- `execute` request gains optional `params: {string: number}` and
  `seed: number`.
- `execute`'s `result` response gains optional `metrics: {string: float}`
  (accumulated via a `record_metric(name, value)` function injected into
  the Python exec namespace; empty when nothing was recorded) and
  `seed_honored: boolean` (present only when a `seed` was requested —
  `false` for hardware and any simulator backend that can't be seeded,
  honest by design).
- New message `environment` → response reporting the kernel's Python
  version, platform string, and installed framework versions
  (`importlib.metadata`; absent keys mean "not installed").

Old clients that never send `params`/`seed` see no behavior change. Full
wire-level detail: `docs-site/src/content/docs/kernel-api/messages-execution.mdx`
and `docs-site/src/content/docs/reference/protocol-changelog.mdx`.

## PRD Series (Research Direction)

PRD 09 (this document's workspace/experiments work) is the foundation for
Nuclei's research direction; later PRDs build on the Experiment object it
defines:

- **PRD 09** — Research Mode & Experiments-as-First-Class-Objects (Learn/
  Research workspaces, the Experiment object, sweep runner, comparison and
  sweep plots).
- **PRD 10** — Simulation backends + remote kernel (GPU/tensor-network/Stim
  backends; kernels not on localhost).
- **PRD 11** — Hardware fleet benchmarking (multi-backend fan-out of one
  experiment; the schema's `backend` is validated as a list-of-one in v1
  specifically so this can widen it without a breaking change).
- **PRD 12** — Dirac research agent (an agentic Dirac that designs and
  launches experiments autonomously; PRD 09 only injects experiment context
  into Dirac, no tools/autonomy).

## Development Phases

### Phase 1: Foundation (Weeks 1–4)
Editor → kernel (Qiskit + Cirq) → circuit visualization → histogram → basic Dirac chat

### Phase 2: Visualization & Polish (Weeks 5–8)
Bloch sphere, CUDA-Q adapter, file operations, themes, context-aware Dirac v2, PlatformBridge abstraction

### Phase 3: Dirac Full Integration (Weeks 9–12)
Tool use (insert code, run sim), gate explorer, step-through, exercises, onboarding, error diagnosis

### Phase 4: Web Version & Community (Post-launch)
Browser version (Pyodide), learning paths, circuit sharing/export, plugin system, Python bundling

### Phase 5: Inline AI Editor + Intelligent Dirac (Weeks 13–18)
Ghost completions, Cmd+K inline edit, Dirac memory & student model, reasoning mode, smart code actions, multi-file projects

### Phase 6: UX Polish, Learning Identity & Zero-to-Quantum (Weeks 19–24)
Zero-knowledge onboarding (Quantum Playground), progressive disclosure UI (beginner→advanced modes), micro-interactions & animation system, command palette, visual identity refinement, accessibility (WCAG 2.1 AA), performance optimization

### Phase 7: Real Hardware, Community & Scale (Ongoing)
Real quantum hardware integration (IBM/Google/IonQ), community gallery & profiles, capstone projects, concept map, educator/classroom tools, plugin marketplace, localization, CI/CD for macOS/Windows/Linux

## Commands

```bash
# Dev
npm run tauri dev          # Start dev server with hot reload

# Build
npm run tauri build        # Build .dmg for distribution

# Kernel (standalone testing)
cd kernel && python server.py   # Start kernel WebSocket server

# Test
npm test                   # Frontend tests
cargo test                 # Rust backend tests
cd kernel && pytest        # Kernel tests
```

## Conventions

- All TypeScript, no plain JS
- Functional React components with hooks only
- Zustand for all shared state — no prop drilling
- All kernel ↔ frontend communication via WebSocket JSON messages
- Python kernel code uses type hints and dataclasses
- Rust code follows standard Tauri patterns
- Commit messages: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
