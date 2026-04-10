# Nuclei — Phase 2 PRD: Visualization & Polish

## Phase Goal

Elevate Nuclei from functional prototype to polished IDE. Add the Bloch sphere for quantum state visualization, support CUDA-Q as a third framework, implement light/dark theming, make file operations work, persist user layout, and upgrade Dirac to be context-aware — seeing the circuit, simulation results, and errors alongside the code.

## Timeline

Weeks 5–8 (4 sprints)

## Prerequisites

Phase 1 complete: editor, kernel (Qiskit + Cirq), live circuit diagram, histogram, basic Dirac chat.

---

## Sprint 1: Bloch Sphere Visualization

### Objective

Render an interactive 3D Bloch sphere in the right-bottom panel that shows qubit states after simulation.

### Requirements

**Bloch Sphere Component — `src/components/bloch/`**

Rendering Specification:
- Three.js 3D scene with a unit sphere
- Three axis arrows: X (red), Y (green), Z (blue) with labels |+⟩/|-⟩, |+i⟩/|-i⟩, |0⟩/|1⟩
- State vector rendered as an arrow from origin to the Bloch coordinates
- Semi-transparent sphere with wireframe latitude/longitude lines
- Background matches the app theme

Interaction:
- Click-and-drag to rotate the view (OrbitControls)
- Scroll to zoom in/out
- Reset view button to snap back to default angle
- Multi-qubit support: tab selector to view each qubit individually (Bloch sphere shows one qubit at a time)

Data Flow:
- After simulation (Cmd+Enter), `SimulationResult.bloch_coords` populates the sphere
- Each qubit gets its own Bloch coordinates from the kernel
- Smooth animation when state vector moves to new position

Visual Polish:
- 60fps animation target
- Subtle ambient lighting + directional light for depth
- State vector arrow glows teal `#00B4D8`
- Grid lines subtle `#1A2A42`

**Kernel Updates**
- Ensure `bloch_coords` is populated in SimulationResult for all frameworks
- For Qiskit: use `Statevector` to compute Bloch coordinates per qubit
- For Cirq: compute from the final state vector

### Acceptance Criteria
- [ ] Bloch sphere renders in the right-bottom panel after simulation
- [ ] State vector arrow points to correct position for |0⟩, |1⟩, |+⟩, |-⟩ states
- [ ] Click-drag rotates the sphere smoothly at 60fps
- [ ] Multi-qubit circuits show tab selector for each qubit
- [ ] Animation plays when transitioning between states
- [ ] Reset view button works

---

## Sprint 2: CUDA-Q Adapter + Framework Switcher

### Objective

Add CUDA-Q as a third supported framework and build a polished framework detection/switching experience.

### Requirements

**CUDA-Q Adapter — `kernel/adapters/cudaq_adapter.py`**
- Extract gates from CUDA-Q kernel definitions
- Map CUDA-Q gate names to canonical names (see gate mapping in CLAUDE.md)
- Simulate using `cudaq.sample()`
- Handle the case where CUDA-Q is not installed (graceful skip with helpful error)

**Framework Detection Enhancement**
- Auto-detect framework from imports (existing behavior, extended to CUDA-Q)
- Status bar framework indicator updates in real time
- If detection is ambiguous, default to Qiskit
- Add framework selector dropdown in status bar for manual override

**Starter Code Templates**
- When user creates a new file or on first launch, offer framework-specific starter templates:
  - Qiskit: Bell State with `QuantumCircuit`
  - Cirq: Bell State with `cirq.Circuit`
  - CUDA-Q: Bell State with `@cudaq.kernel`
- Template selector accessible from File menu or Cmd+N

**Gate Mapping Registry — `src/types/gateRegistry.ts`**
- Centralized mapping between canonical gate names and framework-specific names
- Used by circuit renderer for consistent display regardless of framework
- Includes gate metadata: matrix, description, qubit count, parameter count

### Acceptance Criteria
- [ ] CUDA-Q code parses and returns CircuitSnapshot
- [ ] CUDA-Q simulation runs and returns results
- [ ] Framework auto-detection works for all three frameworks
- [ ] Manual framework override works from status bar
- [ ] Starter templates available for each framework
- [ ] Graceful error when CUDA-Q is not installed

---

## Sprint 3: File Operations + Theme System

### Objective

Users can open, save, and create quantum code files. Light and dark themes are available.

### Requirements

**File Operations — `src-tauri/src/commands/filesystem.rs`**
- Tauri commands: `open_file`, `save_file`, `save_file_as`, `new_file`
- File dialog integration for open/save-as
- Track file path in editorStore
- Dirty indicator (dot on title bar or tab) when unsaved changes
- Keyboard shortcuts: Cmd+O (open), Cmd+S (save), Cmd+Shift+S (save as), Cmd+N (new)
- File watcher: detect external changes and prompt to reload
- Recent files list (stored in Tauri's app data)

**Window Title**
- Format: `filename.py — Nuclei` (or `untitled — Nuclei` for new files)
- Add dirty dot: `● filename.py — Nuclei` when unsaved

**Theme System**
- Dark theme (default): current navy/teal scheme
- Light theme: white background, dark text, teal accents preserved
- Theme toggle in status bar or settings
- Theme preference persisted via Tauri storage
- Monaco editor theme switches with app theme
- All components respect the current theme (use CSS variables or a Zustand theme store)

Light Theme Colors:
- Background: `#FFFFFF`
- Editor background: `#FAFBFC`
- Text: `#1A1A2E`
- Borders: `#E1E4E8`
- Accent: `#0096B7` (slightly darker teal for contrast on white)
- Code comments: `#6A737D`
- Dirac accent: `#6B21A8` (slightly adjusted purple)

**Settings Persistence**
- Use Tauri's `tauri-plugin-store` or equivalent
- Persist: theme preference, recent files, shot count, panel layout dimensions

### Acceptance Criteria
- [ ] Cmd+O opens a file dialog and loads a .py file into the editor
- [ ] Cmd+S saves the current file (prompts for path if untitled)
- [ ] Dirty indicator shows when unsaved changes exist
- [ ] Cmd+N creates a new file with framework template selector
- [ ] Window title reflects current file name
- [ ] Light theme is visually polished and consistent across all panels
- [ ] Theme toggle works and preference persists across restarts
- [ ] Recent files list populates and works

---

## Sprint 4: Context-Aware Dirac (v2) + Layout Polish

### Objective

Upgrade Dirac to see the user's code, circuit snapshot, simulation results, and errors. Polish the panel layout system.

### Requirements

**Dirac v2 — Richer Context Injection**

Dirac is still just Claude via the Anthropic API. What changes in v2 is what we inject into each API call. The system prompt and user message context now include live IDE state:

- Current code from editorStore
- Current CircuitSnapshot (JSON summary — gate count, qubit count, framework)
- Latest SimulationResult if available (probabilities summary)
- Latest errors from the terminal
- Current framework

Context injection strategy:
- Inject as a structured context block in the system prompt (or as a user message prefix)
- Update context on each new Dirac message (not on every code change)
- Keep context compact — summarize large outputs rather than including raw data (aim for <2000 tokens of context)
- Model routing logic in `useDirac.ts`: use Haiku for quick Q&A, auto-escalate to Sonnet for complex conceptual questions (detect based on question length, keywords like "explain", "why", "how does")

New Dirac Capabilities:
- "Explain this circuit" — Dirac describes what the current circuit does step by step
- "Why did I get this error?" — Dirac sees the error traceback and explains in plain English
- "What do these results mean?" — Dirac interprets the histogram/simulation results
- Dirac proactively notices common beginner mistakes and suggests fixes

**Panel Layout Polish**
- Double-click divider to reset to default position
- Collapse/expand panels via chevron buttons
- Bottom panel fully collapsible (click tab header to toggle)
- Minimum panel sizes enforced during resize
- Layout dimensions persist across sessions via Tauri storage
- Smooth resize with no layout flickering

**Status Bar Enhancements**
- Clickable framework badge opens framework selector
- Qubit count and depth update reactively
- Connection indicator for kernel WebSocket (green dot = connected, red = disconnected)
- Click on kernel indicator to restart kernel

### Acceptance Criteria
- [ ] Dirac can accurately describe the current circuit when asked
- [ ] Dirac explains errors by referencing the actual traceback
- [ ] Dirac interprets simulation results meaningfully
- [ ] Haiku/Sonnet model selection works based on complexity
- [ ] Panels collapse and expand smoothly
- [ ] Layout persists across app restarts
- [ ] Double-click divider resets position
- [ ] Kernel connection indicator works in status bar

---

---

## Cross-Cutting: PlatformBridge Abstraction

### Objective

Introduce a platform abstraction layer so the React frontend never calls Tauri APIs directly. This is essential groundwork for the Phase 4 web version and should be woven into Phase 2 as existing Tauri calls are refactored.

### Requirements

**PlatformBridge Interface — `src/platform/bridge.ts`**
```typescript
export interface PlatformBridge {
  // Kernel management
  startKernel(): Promise<void>;
  stopKernel(): Promise<void>;

  // File operations
  openFile(): Promise<{ path: string; content: string } | null>;
  saveFile(path: string, content: string): Promise<void>;
  saveFileAs(content: string): Promise<{ path: string } | null>;

  // Storage (settings, preferences)
  getStoredValue(key: string): Promise<string | null>;
  setStoredValue(key: string, value: string): Promise<void>;

  // Platform info
  getPlatform(): 'desktop' | 'web';
}
```

**TauriBridge Implementation — `src/platform/tauriBridge.ts`**
- Implements PlatformBridge using Tauri IPC commands
- This is the only file that imports from `@tauri-apps/api`

**Bridge Provider — `src/platform/PlatformProvider.tsx`**
- React context that provides the bridge to all components
- In Phase 2, always provides TauriBridge
- In Phase 4, will conditionally provide WebBridge

**Refactoring**
- All existing Tauri command calls from Phase 1 (kernel management) move behind the bridge
- All new file operations (Sprint 3) go through the bridge from the start
- All storage calls (Sprint 3 theme persistence, Sprint 4 layout persistence) go through the bridge

### Acceptance Criteria
- [ ] No component imports directly from `@tauri-apps/api` — all access goes through PlatformBridge
- [ ] TauriBridge implementation passes all existing functionality tests
- [ ] Bridge interface is documented for Phase 4 WebBridge implementation

---

## Phase 2 Definition of Done

When Phase 2 is complete, Nuclei is a polished IDE where a user can:
1. Write quantum code in Qiskit, Cirq, or CUDA-Q
2. See live circuit diagrams and a 3D Bloch sphere after simulation
3. Open, save, and manage quantum code files
4. Switch between dark and light themes
5. Ask Dirac context-aware questions about their code, errors, and results
6. Enjoy a smooth, responsive panel layout that remembers their preferences

## Dependencies & Assumptions

- Phase 1 complete and stable
- CUDA-Q is optional — adapter should handle the case where it's not installed
- Three.js OrbitControls available (import from three/addons or three/examples)
- Tauri plugin store available for persistence

## Non-Goals for Phase 2
- Dirac tool use / code insertion (Phase 3)
- Exercise mode (Phase 3)
- Gate step-through (Phase 3)
- Collaborative features (Phase 4)
- Web version (Phase 4)
- Python bundling / conda-pack (Phase 4)
