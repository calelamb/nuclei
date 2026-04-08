# Nuclei — Phase 1 PRD: Foundation

## Phase Goal

Deliver a working quantum computing IDE where a user can write Qiskit or Cirq code in a dark-themed Monaco editor, see a circuit diagram update live as they type, press Cmd+Enter to simulate, view measurement results as a histogram, and ask a basic AI assistant (Dirac) quantum computing questions — all inside a native Tauri desktop app.

## Timeline

Weeks 1–4 (4 sprints)

---

## Sprint 1: Project Scaffold + Editor + Panel Layout

### Objective

Open the app and see a dark-themed IDE with a Monaco code editor, placeholder panels, a status bar, and resizable dividers.

### Requirements

**Project Initialization**
- Scaffold a Tauri 2.x + React 19 + TypeScript project using `npm create tauri-app@latest`
- Install core dependencies: `@monaco-editor/react`, `zustand`, `three`, `@types/three`, `d3`, `@types/d3`, `recharts`
- Create directory structure per CLAUDE.md: `src/components/{editor,circuit,bloch,histogram,dirac,terminal,layout}`, `src/stores`, `src/hooks`, `src/types`, `kernel/adapters`, `kernel/models`

**TypeScript Contracts (locked — implement exactly)**

These types are the contract between the Python kernel and the React frontend. They must be implemented in `src/types/quantum.ts` exactly as specified:

```typescript
export type Framework = 'qiskit' | 'cirq' | 'cuda-q';

export interface Gate {
  type: string;          // 'H', 'CNOT', 'RZ', etc.
  targets: number[];     // qubit indices
  controls: number[];    // control qubit indices
  params: number[];      // rotation angles, etc.
  layer: number;         // depth position (column in circuit diagram)
}

export interface CircuitSnapshot {
  framework: Framework;
  qubit_count: number;
  classical_bit_count: number;
  depth: number;
  gates: Gate[];
}

export interface Complex {
  re: number;
  im: number;
}

export interface BlochCoord {
  x: number;
  y: number;
  z: number;
}

export interface SimulationResult {
  state_vector: Complex[];
  probabilities: Record<string, number>;
  measurements: Record<string, number>;
  bloch_coords: BlochCoord[];
  execution_time_ms: number;
}

export type KernelMessage =
  | { type: 'parse'; code: string }
  | { type: 'execute'; code: string; shots: number };

export type KernelResponse =
  | { type: 'snapshot'; data: CircuitSnapshot }
  | { type: 'result'; data: SimulationResult }
  | { type: 'error'; message: string; traceback?: string }
  | { type: 'output'; text: string };
```

**Zustand Stores**
- `editorStore` — tracks `code`, `framework`, `filePath`, `isDirty`
- `circuitStore` — tracks `snapshot`, `isLoading`, `error`
- `simulationStore` — tracks `result`, `isRunning`, `shots`, `terminalOutput`
- Default code should be a Bell State example in Qiskit

**Monaco Editor Component**
- Language: Python
- Custom dark theme ("nuclei-dark") with these colors:
  - Editor background: `#0F1B2D`
  - Foreground: `#E0E0E0`
  - Line highlight: `#1A2A42`
  - Cursor: `#00B4D8`
  - Keywords: `#00B4D8` (teal)
  - Strings: `#98C379`
  - Numbers: `#D19A66`
  - Comments: `#6A737D` italic
- Font: JetBrains Mono, 14px
- Minimap disabled
- Register Cmd+Enter keybinding (wired in Sprint 2)
- Bracket pair colorization enabled

**Panel Layout**
- Four-panel layout:
  - Left (60%): Monaco editor
  - Right top (60% of right): Circuit diagram placeholder
  - Right bottom (40% of right): Bloch sphere placeholder
  - Bottom (collapsible, ~200px): Tabbed panel — Terminal, Histogram, Dirac AI
- All panel dividers resizable via mouse drag
- Status bar at top: NUCLEI brand, framework indicator, qubit count, circuit depth, sim status
- Background: `#0F1B2D`, borders: `#1A2A42`, accents: `#00B4D8`
- UI font: Inter, code font: JetBrains Mono

**Tauri Window Config**
- Title: "Nuclei"
- Default size: 1400×900, min 900×600
- Resizable, with native decorations

### Acceptance Criteria
- [ ] `npm run tauri dev` opens Nuclei with the full panel layout
- [ ] Monaco editor loads with Bell State starter code and custom dark theme
- [ ] All panels are visible with placeholder content
- [ ] Panel dividers can be dragged to resize
- [ ] Status bar displays framework as "Qiskit"
- [ ] Cmd+Enter keybinding is registered (logs to console for now)

---

## Sprint 2: Python Kernel + WebSocket Bridge

### Objective

The editor sends code to a Python kernel process over WebSocket. The kernel parses the code, detects the framework (Qiskit or Cirq), extracts a CircuitSnapshot, and returns it to the frontend. Cmd+Enter triggers full simulation.

### Requirements

**Python Kernel — `kernel/`**

WebSocket Protocol (locked):
- Server binds to `ws://localhost:9742`
- JSON messages follow the `KernelMessage` / `KernelResponse` types defined in Sprint 1
- `parse` message → kernel extracts CircuitSnapshot without simulation, returns `snapshot` response
- `execute` message → kernel runs full simulation, returns `result` response
- Errors return `error` response with message and optional traceback
- stdout/stderr captured and sent as `output` responses

`kernel/server.py` — WebSocket server
- Accept connections on port 9742
- Parse incoming JSON, route to executor
- Handle disconnects gracefully

`kernel/executor.py` — Code execution engine
- Execute Python code in a sandboxed namespace
- Capture stdout/stderr
- Auto-detect framework from import statements: `from qiskit import` → qiskit, `import cirq` → cirq, `import cudaq` → cuda-q
- After execution, find circuit objects in the namespace and route to the appropriate adapter
- For `parse` mode: extract CircuitSnapshot only (no simulation) — must complete in <50ms
- For `execute` mode: run simulation with specified shot count, return SimulationResult

`kernel/adapters/base.py` — Abstract adapter interface
```python
from abc import ABC, abstractmethod
from kernel.models.snapshot import CircuitSnapshot, SimulationResult

class FrameworkAdapter(ABC):
    @abstractmethod
    def extract_snapshot(self, circuit_obj) -> CircuitSnapshot:
        """Extract gate sequence without simulation."""
        pass

    @abstractmethod
    def simulate(self, circuit_obj, shots: int) -> SimulationResult:
        """Run full simulation and return results."""
        pass
```

`kernel/adapters/qiskit_adapter.py` — Qiskit adapter
- Extract gates from `QuantumCircuit.data`
- Map Qiskit gate names to canonical names (see gate mapping in CLAUDE.md)
- Simulate using `AerSimulator`

`kernel/adapters/cirq_adapter.py` — Cirq adapter
- Extract gates from `cirq.Circuit.all_operations()`
- Map Cirq gate names to canonical names
- Simulate using `cirq.Simulator`

`kernel/models/snapshot.py` — Data models
- Python dataclasses matching the TypeScript `CircuitSnapshot` and `SimulationResult` interfaces
- JSON serialization methods

**Tauri Kernel Manager — `src-tauri/src/commands/kernel.rs`**
- Tauri command to spawn the Python kernel process (`python kernel/server.py`)
- Track the process PID
- Kill cleanly on app close
- Expose `start_kernel` and `stop_kernel` as Tauri IPC commands

**Frontend WebSocket Hook — `src/hooks/useKernel.ts`**
- Connect to `ws://localhost:9742` on mount
- On code change: debounce 300ms, send `parse` message
- On Cmd+Enter: send `execute` message with current shot count
- Dispatch `snapshot` responses to `circuitStore`
- Dispatch `result` responses to `simulationStore`
- Dispatch `error` responses appropriately
- Dispatch `output` responses to `simulationStore.terminalOutput`
- Handle reconnection if WebSocket drops

**Terminal Panel**
- Display `terminalOutput` from simulationStore
- Show errors with red styling
- Show stdout/stderr from kernel execution
- Auto-scroll to bottom

### Acceptance Criteria
- [ ] Python kernel starts automatically when the app launches
- [ ] Typing code sends parse requests after 300ms debounce
- [ ] Kernel returns CircuitSnapshot for valid Qiskit code
- [ ] Kernel returns CircuitSnapshot for valid Cirq code
- [ ] Cmd+Enter runs simulation, results arrive in simulationStore
- [ ] Terminal panel shows stdout/stderr
- [ ] Errors display with traceback in terminal
- [ ] Kernel process shuts down cleanly when app closes
- [ ] Parse responses complete in <50ms for typical circuits (<20 gates)

---

## Sprint 3: Live Circuit Diagram

### Objective

The circuit diagram panel renders a live SVG visualization from CircuitSnapshot data, updating in real time as the user types.

### Requirements

**Circuit Renderer Component — `src/components/circuit/`**

Rendering Specification:
- Qubit wires: horizontal lines, evenly spaced vertically, labeled `|0⟩`, `|1⟩`, etc. on the left
- Gates placed left-to-right by `layer` value from the snapshot
- Single-qubit gates: rounded rectangle with label text (H, X, Y, Z, S, T, Rz, Ry, Rx, etc.)
- CNOT/CX: filled circle on control qubit, ⊕ (circle-plus) on target qubit, vertical line connecting them
- Toffoli/CCX: two filled circles on control qubits, ⊕ on target
- Measurement: meter/gauge icon on the qubit wire
- SWAP: two × symbols connected by vertical line
- Parameterized gates (Rz, Ry, Rx): show parameter value below the gate label

Color Scheme:
- Single-qubit gates: teal `#00B4D8`
- Multi-qubit gates: indigo `#1E3A5F`
- Measurement: gray `#6A737D`
- Wires: `#3D5A80`
- Labels: `#E0E0E0`

Behavior:
- Auto-scale to fit panel width (zoom to fit)
- Hover on any gate shows tooltip: gate name, matrix representation, qubit targets
- Smooth transition when gates are added/removed (animate layout changes)
- Classical bit wires rendered as double-lines below qubit wires (when measurement exists)

**Status Bar Updates**
- Display live qubit count from snapshot
- Display live circuit depth from snapshot

### Acceptance Criteria
- [ ] Circuit diagram renders correctly for a Bell State (H + CNOT)
- [ ] Diagram updates live as user types (within 300ms debounce + render)
- [ ] All single-qubit gates render with correct symbols
- [ ] CNOT renders with control dot + target circle-plus
- [ ] Measurement gates render with meter icon
- [ ] Hover tooltips show gate info
- [ ] Diagram auto-scales to fit the panel
- [ ] Status bar shows live qubit count and depth
- [ ] Empty/invalid code shows a clean empty state (not an error)

---

## Sprint 4: Simulation Results + Histogram

### Objective

Cmd+Enter runs the circuit and displays measurement probabilities as a bar chart in the histogram panel.

### Requirements

**Probability Histogram — `src/components/histogram/`**
- Bar chart showing measurement outcome probabilities
- X-axis: basis states (|00⟩, |01⟩, |10⟩, |11⟩, etc.)
- Y-axis: probability (0 to 1) or count
- Bars colored in teal `#00B4D8`
- Hover on bar shows exact probability/count
- Shot count control: slider or input, range 100 to 100,000, default 1024
- Toggle between ideal (theoretical) and sampled (shot-based) distributions
- Export options: copy as PNG, export as CSV

**Simulation Flow Integration**
- Cmd+Enter triggers execute with current shot count
- Status bar shows "Running..." with spinner during simulation
- Status bar shows execution time after completion
- Results populate histogram in the bottom panel
- Automatically switch to histogram tab when results arrive

**Error Handling**
- If simulation fails, show error in terminal panel
- Status bar resets to "Ready" on error

### Acceptance Criteria
- [ ] Cmd+Enter runs simulation for both Qiskit and Cirq code
- [ ] Histogram renders correct probabilities for Bell State (~50% |00⟩, ~50% |11⟩)
- [ ] Shot count slider adjusts number of shots
- [ ] Ideal vs. sampled toggle works
- [ ] Status bar shows "Running..." during simulation
- [ ] Status bar shows execution time after completion
- [ ] Bottom panel auto-switches to histogram tab on results
- [ ] Errors display in terminal, status bar resets

---

## Sprint 5: Basic Dirac AI Chat

### Objective

A basic AI chat panel (Dirac) lives in the bottom tab bar. Dirac is a Claude API wrapper — not a custom model. It's Claude called via the Anthropic API with a system prompt that gives it the "Dirac" persona and the user's current code injected as context. Users can ask quantum computing questions and get helpful, beginner-friendly explanations.

### Requirements

**Dirac Chat Panel — `src/components/dirac/`**
- Chat interface in the "Dirac AI" tab of the bottom panel
- Message list with user messages and Dirac responses
- Input field with send button and Enter-to-send
- Dirac's messages styled with purple accent `#7B2D8E`
- User messages styled with subtle background
- Auto-scroll to latest message
- "Dirac is thinking..." indicator during API calls
- Markdown rendering in Dirac's responses (code blocks, bold, lists)

**Claude API Integration — `src/hooks/useDirac.ts`**

Dirac is implemented as a thin wrapper around the Anthropic API. All intelligence comes from Claude — Dirac's behavior is shaped entirely by the system prompt and injected context.

- Call Anthropic API with `claude-haiku` model (fast responses for basic Q&A)
- System prompt defines the Dirac persona — this is what makes Claude behave as "Dirac":
  - Named after Paul Dirac
  - Quantum computing tutor for beginners
  - Explains concepts in plain English first, then math if needed
  - Encouraging, patient, never condescending
- Context injection on each API call:
  - User's current code from editorStore
  - Current framework
  - (Later phases add: CircuitSnapshot, SimulationResult, errors, StudentModel)
- Streaming responses via the Anthropic SDK for perceived speed
- No custom training, fine-tuning, or RAG — just Claude + a good prompt

**API Key Configuration**
- API key is hardcoded in a config file (`src/config/dirac.ts` or environment variable)
- No API key entry UI — the developer sets it during build
- For open-source distribution, users will set their own key via environment variable or config file before building
- Do NOT build any API key entry flow, modal, or setup wizard

**Dirac Zustand Store — `src/stores/diracStore.ts`**
- Message history (role + content)
- isLoading state
- addMessage, clearHistory actions

### Acceptance Criteria
- [ ] Dirac AI tab shows a chat interface
- [ ] User can type a question and get a response from Claude
- [ ] Dirac's responses render markdown correctly
- [ ] Dirac can see and reference the user's current code
- [ ] Responses stream in for better UX
- [ ] API key loads from config file or environment variable (no UI needed)
- [ ] "Dirac is thinking..." indicator appears during calls
- [ ] Conversation history maintained within session

---

## Phase 1 Definition of Done

When Phase 1 is complete, a user can:
1. Open Nuclei and see a professional dark-themed IDE
2. Write Qiskit or Cirq code with syntax highlighting and autocomplete
3. See a circuit diagram update live as they type
4. Press Cmd+Enter to run the simulation
5. View measurement results as a probability histogram
6. Ask Dirac basic quantum computing questions and get helpful answers
7. Resize panels to customize their workspace

## Dependencies & Assumptions

- User has Rust, Node.js 18+, and Python 3.10+ installed
- User has `qiskit`, `qiskit-aer`, `cirq`, and `websockets` Python packages installed
- User has a Claude API key for Dirac functionality
- macOS is the primary development target (Tauri builds .dmg)
- CUDA-Q support is deferred to Phase 2

## Non-Goals for Phase 1
- Bloch sphere visualization (Phase 2)
- CUDA-Q adapter (Phase 2)
- Light theme (Phase 2)
- Dirac tool use / code insertion (Phase 3)
- Exercise mode (Phase 3)
- Gate step-through debugging (Phase 3)
- File save/open (Phase 2)
- Layout persistence (Phase 2)
