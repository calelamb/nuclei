# Nuclei — Phase 3 PRD: Dirac Full Integration

## Phase Goal

Transform Dirac from a context-aware chat into an agentic coding partner — still just a Claude API wrapper, but now using Claude's tool use API. We define tools (insert_code, run_simulation, highlight_gate, etc.) and pass them to the Anthropic API alongside the system prompt and context. Claude decides when to call them. The frontend executes the tool calls and returns results. This is standard Claude tool use — no custom agent framework needed.

## Timeline

Weeks 9–12 (4 sprints)

## Prerequisites

Phase 2 complete: Bloch sphere, all three framework adapters, file operations, themes, context-aware Dirac v2.

---

## Sprint 1: Dirac Tool Use — Code & Simulation

### Objective

Dirac can insert code into the editor and trigger simulations. Implementation: pass tool definitions to the Anthropic API's `tools` parameter. Claude decides when to invoke them. The frontend handles execution.

### Requirements

**Tool Definitions (passed to Anthropic API `tools` parameter)**

These are standard Claude tool use definitions — JSON schemas that describe what each tool does. Claude sees them and decides when to call them:

`insert_code` — Insert or replace code in the editor
```
Parameters:
  - code: string (the code to insert)
  - position: 'cursor' | 'replace_selection' | 'replace_all' | 'append'
  - description: string (what the code does — shown to user before insertion)
```
Behavior:
- Dirac proposes code with a description
- Frontend shows a diff preview before applying
- User can accept, modify, or reject the insertion
- Accepted code is inserted at the specified position
- Editor scrolls to show the inserted code

`run_simulation` — Execute the current circuit
```
Parameters:
  - shots: number (optional, defaults to current setting)
```
Behavior:
- Triggers the same flow as Cmd+Enter
- Dirac can then reference the results in follow-up messages
- Useful for Dirac to verify its own suggestions work

**Dirac Coding Agent Behavior**
- When user asks Dirac to write code, Dirac uses `insert_code` tool
- Dirac explains what the code does before and after insertion
- If Dirac writes code that produces errors, it sees the error (from context injection) and can self-correct
- Dirac can chain: write code → run simulation → explain results

**Tool Use UX**
- When Dirac wants to use a tool, show a distinct UI element in the chat:
  - Code insertion: collapsible code block with "Apply" / "Dismiss" buttons
  - Simulation: "Dirac is running your circuit..." indicator
- Tool use actions are logged in the chat history so the user sees what happened

**Model Routing (in `useDirac.ts`)**
- Use `claude-sonnet` for all API calls that include tool definitions (Sonnet handles multi-step tool orchestration better)
- Use `claude-haiku` for simple Q&A (no tools passed)
- Routing logic: if the user's message implies code action ("write", "fix", "show me", "insert", "change"), call Sonnet with tools. Otherwise, call Haiku without tools.

### Acceptance Criteria
- [ ] Dirac can insert code into the editor via `insert_code` tool
- [ ] Diff preview shows before code is applied
- [ ] User can accept or reject code insertions
- [ ] Dirac can run simulations and reference the results
- [ ] Dirac can chain: write code → run → explain results
- [ ] Dirac self-corrects when inserted code produces errors
- [ ] Tool use actions are visible in the chat UI

---

## Sprint 2: Gate Explorer + Circuit Highlighting

### Objective

Dirac can highlight specific gates in the circuit visualization and provide an interactive gate explorer.

### Requirements

**Additional Tool Definitions (added to the Anthropic API `tools` parameter)**

`highlight_gate` — Highlight a gate in the circuit diagram
```
Parameters:
  - gate_index: number (index in the gates array)
  - style: 'pulse' | 'glow' | 'outline'
  - duration_ms: number (how long to highlight, 0 = persistent until cleared)
```
Behavior:
- The specified gate in the circuit SVG gets a visual highlight
- Useful when Dirac says "The Hadamard gate on qubit 0 puts it in superposition" — it highlights that H gate
- Multiple gates can be highlighted simultaneously
- Clear all highlights when user types new code

`step_to` — Step-through mode
```
Parameters:
  - gate_index: number (advance to this gate)
```
Behavior:
- Circuit enters step-through mode
- Gates up to `gate_index` are rendered normally, gates after are grayed out
- Bloch sphere shows the quantum state at that point in the circuit
- Histogram shows probabilities at that point
- Step controls appear: Previous, Next, Play (animate through), Reset
- Dirac can narrate each step: "After applying H to qubit 0, we're in the |+⟩ state..."

**Gate Explorer Panel**
- Accessible from the circuit diagram (right-click a gate → "Explore this gate")
- Or ask Dirac: "What does the Hadamard gate do?"
- Shows for any gate:
  - Gate name and symbol
  - Matrix representation (rendered with proper math notation)
  - Bloch sphere effect (animated arrow showing before → after)
  - Plain-English explanation
  - Framework-specific syntax for Qiskit, Cirq, CUDA-Q
  - Related gates (e.g., H is related to X, Z)
- Can be rendered inline in Dirac's chat or as a popup panel

**Gate Database — `src/data/gates.ts`**
- Comprehensive database of quantum gates with:
  - Canonical name, aliases
  - Matrix (2×2 or 4×4)
  - Bloch sphere rotation (axis + angle)
  - Category (single-qubit, multi-qubit, rotation, measurement)
  - Description (beginner-friendly)
  - Framework syntax for each supported framework

### Acceptance Criteria
- [ ] Dirac highlights specific gates when explaining circuits
- [ ] Step-through mode works — gates gray out progressively
- [ ] Bloch sphere updates at each step to show intermediate states
- [ ] Step controls (prev/next/play/reset) work smoothly
- [ ] Gate explorer shows matrix, description, and Bloch effect for any gate
- [ ] Right-click on a gate in the circuit opens the explorer
- [ ] Gate database covers all common quantum gates (H, X, Y, Z, S, T, Rx, Ry, Rz, CNOT, CZ, SWAP, Toffoli, Measure)

---

## Sprint 3: Exercise Mode

### Objective

Dirac can generate quantum computing exercises, provide hints, and verify solutions — turning Nuclei into a learning platform.

### Requirements

**Additional Tool Definitions for Exercises**

`create_exercise` — Generate a quantum exercise
```
Parameters:
  - topic: string (e.g., "superposition", "entanglement", "teleportation", "grover")
  - difficulty: 'beginner' | 'intermediate' | 'advanced'
  - framework: Framework (which syntax to use)
```
Behavior:
- Dirac generates an exercise with:
  - Problem description (what to build)
  - Expected output (target histogram or state)
  - Starter code (partial, with TODOs)
  - Hints (progressive, revealed on request)
- Exercise appears in a distinct UI panel or mode within the Dirac chat
- Starter code is inserted into the editor
- Target histogram/state shown as a ghost overlay on the visualization panels

`verify_solution` — Check the student's answer
```
Parameters: none (uses current code and simulation results)
```
Behavior:
- Dirac runs the student's code
- Compares results against the exercise's expected output
- Provides feedback: correct, partially correct, or incorrect
- If incorrect, offers a hint without giving the answer
- If correct, celebrates and suggests a follow-up challenge
- Tracks exercise completion (stored locally)

**Exercise UI**
- Exercise mode indicator in status bar
- Target state shown as ghost/dimmed overlay on histogram and Bloch sphere
- "Check Solution" button prominent in the Dirac panel during exercises
- Progress tracker: exercises completed, current streak
- Exercise categories: Basics, Superposition, Entanglement, Algorithms, Error Correction

**Built-in Exercise Sets**
- Pre-built set of ~20 exercises covering core quantum computing concepts
- Stored as JSON in `src/data/exercises/`
- Dirac can also generate exercises dynamically based on what the student is working on
- Difficulty progression: each category has beginner → intermediate → advanced

### Acceptance Criteria
- [ ] Dirac generates exercises with clear problem descriptions
- [ ] Starter code loads into the editor with TODOs
- [ ] Target histogram shows as ghost overlay
- [ ] "Check Solution" verifies correctness and gives feedback
- [ ] Hints are progressive (don't give away the answer immediately)
- [ ] At least 20 built-in exercises across 5 categories
- [ ] Exercise completion tracked locally
- [ ] Dirac can generate custom exercises on-the-fly

---

## Sprint 4: Onboarding + Error Diagnosis

### Objective

New users get a guided onboarding experience, and Dirac provides smart error diagnosis with fix suggestions.

### Requirements

**Onboarding Flow**
- First launch experience:
  1. Welcome screen introducing Nuclei
  2. Quick framework selection (Qiskit/Cirq/CUDA-Q) with installation check
  4. Guided tour: Dirac walks the user through the IDE panels
  5. First exercise: "Build a Bell State" with Dirac guiding step-by-step
- Onboarding can be replayed from Help menu
- Onboarding state stored in Tauri settings

**Smart Error Diagnosis**

When the kernel returns an error:
- Dirac automatically analyzes the error (opt-in toggle in settings)
- Classifies the error type:
  - Syntax error → highlight the line, suggest fix
  - Import error → suggest installing the package
  - Quantum error (e.g., measuring a qubit twice, wrong qubit count) → explain the quantum computing concept
  - Framework-specific error → translate to beginner-friendly explanation
- Dirac proactively offers to fix the error using `insert_code`
- Error annotations appear inline in the Monaco editor (red squiggly + hover message)

**Inline Error Annotations**
- Monaco editor decorations for errors returned by the kernel
- Red underline on the problematic line
- Hover shows error message + "Ask Dirac" quick action
- Click "Ask Dirac" pre-fills the chat with the error context

**Keyboard Shortcuts Panel**
- Cmd+/ or Help menu → show keyboard shortcuts overlay
- All shortcuts documented: Cmd+Enter (run), Cmd+S (save), Cmd+N (new), etc.
- Shortcut customization (stretch goal)

### Acceptance Criteria
- [ ] First-launch onboarding guides the user through setup and a first exercise
- [ ] Onboarding can be replayed from Help menu
- [ ] Dirac auto-diagnoses errors when they occur
- [ ] Error explanations are beginner-friendly (not raw tracebacks)
- [ ] Dirac offers to fix errors with code suggestions
- [ ] Inline error annotations appear in the editor
- [ ] "Ask Dirac" quick action works from error annotations
- [ ] Keyboard shortcuts panel is accessible and complete

---

## Phase 3 Definition of Done

When Phase 3 is complete, Nuclei is a full learning environment where a user can:
1. Have Dirac write, insert, and fix quantum code for them
2. Step through circuits gate-by-gate with Dirac narrating
3. Explore any quantum gate interactively (matrix, Bloch effect, explanation)
4. Work through structured exercises with progressive hints
5. Get smart error diagnosis in plain English with fix suggestions
6. Complete a guided onboarding that teaches them the IDE

## Dependencies & Assumptions

- Phase 2 complete and stable
- Anthropic API supports tool use (current as of 2025)
- Sonnet used for API calls with tool definitions, Haiku for simple Q&A
- Bloch sphere can render intermediate states (partial circuit simulation)
- No custom model or fine-tuning — all Dirac behavior comes from system prompt, context injection, and tool definitions

## Non-Goals for Phase 3
- Web version (Phase 4)
- Collaborative features (Phase 4)
- Circuit sharing/export (Phase 4)
- Plugin system (Phase 4)
- Curriculum / learning paths (Phase 4)
