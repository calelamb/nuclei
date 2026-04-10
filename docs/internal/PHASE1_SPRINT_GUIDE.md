# Nuclei — Phase 1 Sprint Guide

## Overview

Phase 1 gets the core loop working: **editor → kernel → visualization**. By the end, you can type Qiskit code and see a circuit diagram update live, then run the circuit and see measurement results.

---

## Prerequisites

Install these before starting:

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Node.js (v18+)
# Already installed if you have it for DoorDrill

# Tauri CLI
cargo install tauri-cli

# Python 3.10+ with quantum frameworks
pip install qiskit qiskit-aer cirq websockets

# CUDA-Q (optional — skip for now if you don't have NVIDIA GPU)
# pip install cuda-quantum
```

---

## Sprint 1: Project Scaffold + Editor

**Goal:** Open the app and type Python code in a Monaco editor with the panel layout roughed in.

### Step 1: Scaffold the Tauri + React project

```bash
# Create the project
npm create tauri-app@latest nuclei -- --template react-ts

cd nuclei

# Install frontend dependencies
npm install

# Install key packages
npm install @monaco-editor/react zustand three @types/three d3 @types/d3 recharts

# Verify it works
npm run tauri dev
```

You should see a Tauri window with the default React template. Kill it once confirmed.

### Step 2: Set up the project structure

Create the directory structure from CLAUDE.md:

```bash
# Frontend directories
mkdir -p src/components/{editor,circuit,bloch,histogram,dirac,terminal,layout}
mkdir -p src/stores src/hooks src/types

# Kernel directory
mkdir -p kernel/adapters kernel/models

# Clean up template files
rm src/App.css
```

### Step 3: Define TypeScript types

Create `src/types/quantum.ts` — this is the contract between kernel and frontend:

```typescript
// src/types/quantum.ts

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

// WebSocket message types
export type KernelMessage =
  | { type: 'parse'; code: string }
  | { type: 'execute'; code: string; shots: number };

export type KernelResponse =
  | { type: 'snapshot'; data: CircuitSnapshot }
  | { type: 'result'; data: SimulationResult }
  | { type: 'error'; message: string; traceback?: string }
  | { type: 'output'; text: string };
```

### Step 4: Create Zustand stores

```typescript
// src/stores/editorStore.ts
import { create } from 'zustand';
import type { Framework } from '../types/quantum';

interface EditorState {
  code: string;
  framework: Framework;
  filePath: string | null;
  isDirty: boolean;
  setCode: (code: string) => void;
  setFramework: (framework: Framework) => void;
  setFilePath: (path: string | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  code: `from qiskit import QuantumCircuit

# Create a Bell State
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])
`,
  framework: 'qiskit',
  filePath: null,
  isDirty: false,
  setCode: (code) => set({ code, isDirty: true }),
  setFramework: (framework) => set({ framework }),
  setFilePath: (filePath) => set({ filePath, isDirty: false }),
}));
```

```typescript
// src/stores/circuitStore.ts
import { create } from 'zustand';
import type { CircuitSnapshot } from '../types/quantum';

interface CircuitState {
  snapshot: CircuitSnapshot | null;
  isLoading: boolean;
  error: string | null;
  setSnapshot: (snapshot: CircuitSnapshot) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

export const useCircuitStore = create<CircuitState>((set) => ({
  snapshot: null,
  isLoading: false,
  error: null,
  setSnapshot: (snapshot) => set({ snapshot, isLoading: false, error: null }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  clear: () => set({ snapshot: null, error: null }),
}));
```

```typescript
// src/stores/simulationStore.ts
import { create } from 'zustand';
import type { SimulationResult } from '../types/quantum';

interface SimulationState {
  result: SimulationResult | null;
  isRunning: boolean;
  shots: number;
  terminalOutput: string[];
  setResult: (result: SimulationResult) => void;
  setRunning: (running: boolean) => void;
  setShots: (shots: number) => void;
  addOutput: (line: string) => void;
  clearOutput: () => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  result: null,
  isRunning: false,
  shots: 1024,
  terminalOutput: [],
  setResult: (result) => set({ result, isRunning: false }),
  setRunning: (isRunning) => set({ isRunning }),
  setShots: (shots) => set({ shots }),
  addOutput: (line) => set((s) => ({ terminalOutput: [...s.terminalOutput, line] })),
  clearOutput: () => set({ terminalOutput: [] }),
}));
```

### Step 5: Build the Monaco Editor component

```typescript
// src/components/editor/QuantumEditor.tsx
import { useRef, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useEditorStore } from '../../stores/editorStore';

export function QuantumEditor() {
  const { code, setCode } = useEditorStore();
  const editorRef = useRef<any>(null);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    
    // Cmd+Enter to run simulation (we'll wire this up in Sprint 2)
    editor.addAction({
      id: 'run-circuit',
      label: 'Run Circuit',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        // TODO: Send execute command to kernel
        console.log('Run circuit');
      },
    });

    editor.focus();
  };

  const handleChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setCode(value);
    }
  }, [setCode]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Editor
        defaultLanguage="python"
        theme="nuclei-dark"
        value={code}
        onChange={handleChange}
        onMount={handleMount}
        options={{
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          padding: { top: 16 },
          lineNumbers: 'on',
          renderWhitespace: 'none',
          bracketPairColorization: { enabled: true },
          automaticLayout: true,
          tabSize: 4,
        }}
        beforeMount={(monaco) => {
          // Define Nuclei dark theme
          monaco.editor.defineTheme('nuclei-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
              { token: 'comment', foreground: '6A737D', fontStyle: 'italic' },
              { token: 'keyword', foreground: '00B4D8' },
              { token: 'string', foreground: '98C379' },
              { token: 'number', foreground: 'D19A66' },
              { token: 'type', foreground: '48CAE4' },
            ],
            colors: {
              'editor.background': '#0F1B2D',
              'editor.foreground': '#E0E0E0',
              'editor.lineHighlightBackground': '#1A2A42',
              'editor.selectionBackground': '#264F78',
              'editorCursor.foreground': '#00B4D8',
              'editorLineNumber.foreground': '#3D5A80',
              'editorLineNumber.activeForeground': '#00B4D8',
            },
          });
        }}
      />
    </div>
  );
}
```

### Step 6: Build the panel layout

```typescript
// src/components/layout/PanelLayout.tsx
import { useState } from 'react';
import { QuantumEditor } from '../editor/QuantumEditor';

// Placeholder panels — we'll build these in later sprints
function CircuitPanel() {
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#3D5A80',
      fontSize: 14,
      fontFamily: 'Inter, sans-serif',
    }}>
      Circuit diagram will render here
    </div>
  );
}

function BottomPanel() {
  const [activeTab, setActiveTab] = useState<'terminal' | 'histogram' | 'dirac'>('terminal');
  
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #1A2A42',
        backgroundColor: '#0A1220',
      }}>
        {(['terminal', 'histogram', 'dirac'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 16px',
              background: activeTab === tab ? '#0F1B2D' : 'transparent',
              color: activeTab === tab ? '#00B4D8' : '#3D5A80',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #00B4D8' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'Inter, sans-serif',
              textTransform: 'capitalize',
            }}
          >
            {tab === 'dirac' ? 'Dirac AI' : tab}
          </button>
        ))}
      </div>
      <div style={{
        flex: 1,
        padding: 12,
        color: '#6A737D',
        fontSize: 13,
        fontFamily: "'JetBrains Mono', monospace",
        overflow: 'auto',
      }}>
        {activeTab === 'terminal' && <div>Terminal output will appear here</div>}
        {activeTab === 'histogram' && <div>Probability histogram will render here</div>}
        {activeTab === 'dirac' && <div style={{ fontFamily: 'Inter, sans-serif' }}>Dirac AI assistant will live here</div>}
      </div>
    </div>
  );
}

export function PanelLayout() {
  const [leftWidth, setLeftWidth] = useState(60); // percentage
  const [bottomHeight, setBottomHeight] = useState(200); // pixels
  const [isDraggingH, setIsDraggingH] = useState(false);
  const [isDraggingV, setIsDraggingV] = useState(false);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDraggingH) {
      const pct = (e.clientX / window.innerWidth) * 100;
      setLeftWidth(Math.max(30, Math.min(80, pct)));
    }
    if (isDraggingV) {
      const fromBottom = window.innerHeight - e.clientY;
      setBottomHeight(Math.max(100, Math.min(500, fromBottom)));
    }
  };

  const handleMouseUp = () => {
    setIsDraggingH(false);
    setIsDraggingV(false);
  };

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#0F1B2D',
        overflow: 'hidden',
        userSelect: isDraggingH || isDraggingV ? 'none' : 'auto',
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Status bar */}
      <div style={{
        height: 28,
        backgroundColor: '#0A1220',
        borderBottom: '1px solid #1A2A42',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 16,
        fontSize: 12,
        fontFamily: 'Inter, sans-serif',
      }}>
        <span style={{ color: '#00B4D8', fontWeight: 600 }}>NUCLEI</span>
        <span style={{ color: '#3D5A80' }}>|</span>
        <span style={{ color: '#48CAE4' }}>Qiskit</span>
        <span style={{ color: '#3D5A80' }}>Qubits: —</span>
        <span style={{ color: '#3D5A80' }}>Depth: —</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: '#3D5A80' }}>Ready</span>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left panel — Editor */}
        <div style={{ width: `${leftWidth}%`, height: '100%' }}>
          <QuantumEditor />
        </div>

        {/* Horizontal resize handle */}
        <div
          style={{
            width: 4,
            cursor: 'col-resize',
            backgroundColor: isDraggingH ? '#00B4D8' : '#1A2A42',
            transition: isDraggingH ? 'none' : 'background-color 0.15s',
          }}
          onMouseDown={() => setIsDraggingH(true)}
          onMouseEnter={(e) => {
            if (!isDraggingH) (e.target as HTMLElement).style.backgroundColor = '#264F78';
          }}
          onMouseLeave={(e) => {
            if (!isDraggingH) (e.target as HTMLElement).style.backgroundColor = '#1A2A42';
          }}
        />

        {/* Right panel — Circuit + Bloch */}
        <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, borderBottom: '1px solid #1A2A42' }}>
            <CircuitPanel />
          </div>
          <div style={{
            height: '40%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#3D5A80',
            fontSize: 14,
            fontFamily: 'Inter, sans-serif',
          }}>
            Bloch sphere will render here
          </div>
        </div>
      </div>

      {/* Vertical resize handle */}
      <div
        style={{
          height: 4,
          cursor: 'row-resize',
          backgroundColor: isDraggingV ? '#00B4D8' : '#1A2A42',
          transition: isDraggingV ? 'none' : 'background-color 0.15s',
        }}
        onMouseDown={() => setIsDraggingV(true)}
      />

      {/* Bottom panel */}
      <div style={{ height: bottomHeight, overflow: 'hidden' }}>
        <BottomPanel />
      </div>
    </div>
  );
}
```

### Step 7: Wire up App.tsx

```typescript
// src/App.tsx
import { PanelLayout } from './components/layout/PanelLayout';

function App() {
  return <PanelLayout />;
}

export default App;
```

### Step 8: Configure Tauri window

In `src-tauri/tauri.conf.json`, update the window configuration:

```json
{
  "app": {
    "windows": [
      {
        "title": "Nuclei",
        "width": 1400,
        "height": 900,
        "minWidth": 900,
        "minHeight": 600,
        "decorations": true,
        "resizable": true
      }
    ]
  }
}
```

### Step 9: Run it

```bash
npm run tauri dev
```

You should see the Nuclei IDE with:
- Monaco editor on the left with the Bell State starter code
- Placeholder panels on the right (circuit + Bloch sphere)
- Tabbed bottom panel (terminal, histogram, Dirac)
- Status bar with framework indicator
- Dark theme with navy/teal color scheme
- Resizable panel dividers

### What you have after Sprint 1:

✅ Tauri + React + TypeScript project scaffold
✅ Monaco editor with Python syntax highlighting and Nuclei dark theme
✅ Four-panel layout with resizable dividers
✅ Zustand stores for editor, circuit, and simulation state
✅ TypeScript type definitions for all kernel ↔ frontend contracts
✅ Status bar with framework indicator
✅ Cmd+Enter keybinding registered (not yet wired to kernel)
✅ Starter Bell State code loaded by default

---

## Sprint 2: Python Kernel + WebSocket Bridge

**Goal:** Send code to the Python kernel and get execution results back.

### What to build:

1. **`kernel/server.py`** — WebSocket server (port 9742) that receives JSON messages and routes them to the executor
2. **`kernel/executor.py`** — Executes Python code in a sandboxed namespace, captures stdout/stderr
3. **`kernel/adapters/base.py`** — Abstract base class defining the adapter interface
4. **`kernel/adapters/qiskit_adapter.py`** — Extracts CircuitSnapshot from Qiskit QuantumCircuit objects
5. **`kernel/models/snapshot.py`** — CircuitSnapshot and SimulationResult dataclasses with JSON serialization
6. **`src-tauri/src/commands/kernel.rs`** — Tauri command that spawns the Python kernel process
7. **`src/hooks/useKernel.ts`** — React hook that manages the WebSocket connection, sends code on debounce, and dispatches responses to Zustand stores

### Key implementation notes:

- The kernel should auto-detect the framework by scanning for import statements (`from qiskit import`, `import cirq`, `import cudaq`)
- For the parse command (live circuit updates), the kernel should NOT run the full circuit — only extract the gate sequence. This keeps updates under 50ms.
- For the execute command (Cmd+Enter), run the full simulation with the specified shot count.
- The WebSocket protocol uses JSON. Each message has a `type` field. See the `KernelMessage` and `KernelResponse` types in `src/types/quantum.ts`.
- The Rust kernel manager should track the Python process PID and kill it cleanly on app close.

### After Sprint 2 you have:

✅ Python WebSocket server running and managed by Tauri
✅ Code sent to kernel on each edit (300ms debounce)
✅ Kernel parses Qiskit code and returns CircuitSnapshot
✅ Cmd+Enter sends execute command, kernel returns SimulationResult
✅ Terminal panel shows stdout/stderr from kernel
✅ Error messages displayed when code fails

---

## Sprint 3: Live Circuit Diagram

**Goal:** Render the circuit diagram from CircuitSnapshot data in real time.

### What to build:

1. **`src/components/circuit/CircuitRenderer.tsx`** — Main component that takes CircuitSnapshot and renders SVG
2. **`src/components/circuit/gates.tsx`** — Individual gate components (H, X, Y, Z, CNOT, RZ, Measure, etc.) as SVG elements
3. **`src/components/circuit/QubitWire.tsx`** — Horizontal qubit wire with label
4. **Gate tooltip on hover** — Shows gate name, matrix, description

### Rendering rules:

- Qubit wires are horizontal lines, evenly spaced vertically
- Gates are placed left-to-right by their `layer` value
- Single-qubit gates: rounded rectangle with label (H, X, Y, Z, Rz, etc.)
- CNOT: filled circle on control qubit, ⊕ on target qubit, connected by vertical line
- Measurement: meter icon
- Color scheme: single-qubit gates in teal (#00B4D8), multi-qubit in indigo (#1E3A5F), measurement in gray
- Wire labels: |0⟩, |1⟩, etc. on the left side
- Circuit should auto-scale to fit the panel width

### After Sprint 3 you have:

✅ Circuit diagram renders from live code
✅ Updates in real time as user types (300ms debounce)
✅ All standard gates rendered with correct notation
✅ Hover tooltips with gate info
✅ Status bar shows qubit count and circuit depth

---

## Sprint 4: Simulation + Histogram

**Goal:** Run simulation on Cmd+Enter and display results as a probability histogram.

### What to build:

1. **`src/components/histogram/ProbabilityHistogram.tsx`** — Bar chart showing measurement probabilities using D3 or Recharts
2. **Shot count slider** — Control in the histogram panel (100 to 100,000)
3. **Ideal vs. sampled toggle** — Switch between theoretical distribution and sampled results
4. **Export** — Copy as PNG or CSV

### After Sprint 4 you have:

✅ Cmd+Enter runs the circuit
✅ Probability histogram renders in the bottom panel
✅ Shot count is adjustable
✅ Can toggle between ideal and sampled distributions
✅ Status bar shows "Running..." during simulation

---

## After Phase 1 is complete:

You have a working quantum computing IDE where you can:
1. Write Qiskit code in a beautiful dark-themed editor
2. See the circuit diagram update live as you type
3. Press Cmd+Enter to simulate
4. View measurement results as a histogram
5. Resize and rearrange panels

**Next:** Phase 2 adds the Bloch sphere, Cirq + CUDA-Q adapters, and visual polish. Phase 3 adds Dirac.
