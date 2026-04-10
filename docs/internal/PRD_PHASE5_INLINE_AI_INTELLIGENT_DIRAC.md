# Nuclei — Phase 5 PRD: Inline AI Editor + Intelligent Dirac

## Phase Goal

Make Nuclei the Cursor of quantum computing. The Claude API integration moves from the side panel into the editor itself — ghost completions as you type (Haiku, fast), Cmd+K to rewrite selected code in natural language (Sonnet, powerful). The system prompt and context injection get significantly richer: a persistent student model is injected so Claude adapts to the learner's level, and extended thinking is enabled for complex reasoning tasks. All of this is still Claude via the Anthropic API — the intelligence upgrade comes from better prompts, richer context, and smarter model routing.

## Timeline

Weeks 13–18 (6 sprints — this phase is meaty)

## Prerequisites

Phase 4 complete: web version, learning paths, sharing, plugin foundation.

---

## Sprint 1: Ghost Completions (Inline Autocomplete)

### Objective

As the user types quantum code, Dirac suggests the next line(s) as translucent ghost text. Tab to accept, Esc to dismiss. Like GitHub Copilot, but tuned for quantum circuits.

### Requirements

**Completion Engine — `src/components/editor/completions/`**

Trigger Logic:
- Activate after the user pauses typing for 500ms (longer than the 300ms parse debounce — completions shouldn't fight circuit updates)
- Also activate immediately after typing a newline at the end of a statement
- Do NOT trigger inside comments, strings, or when cursor is mid-token
- Suppress while the user is actively dismissing suggestions (cooldown of 2s after Esc)

Request Payload:
- Current file content with cursor position marked
- Current framework (Qiskit/Cirq/CUDA-Q)
- Current CircuitSnapshot (so Dirac knows the circuit state at that point in the code)
- Last 3 lines of terminal output (if there was a recent error)
- Completion instruction: "Complete the next 1–3 lines of quantum computing code. Only return the code, no explanation."

Rendering:
- Ghost text rendered inline in Monaco using `inlineCompletions` API
- Text color: `#3D5A80` at 50% opacity (subtle but readable on `#0F1B2D` background)
- Multi-line completions indented correctly
- Tab accepts the entire suggestion
- Cmd+Right accepts word-by-word
- Esc dismisses
- Any other keystroke dismisses and types normally

Model Selection:
- Use Haiku for speed — completions must feel instant (<300ms perceived latency)
- Stream the first tokens and render as they arrive
- Cancel in-flight requests when the user types again

Quantum-Aware Completions (via system prompt instruction):
- System prompt instructs Claude to favor quantum idioms: after `qc.h(0)`, suggest `qc.cx(0, 1)` for Bell state patterns
- After `qc.measure`, suggest the classical bit mapping
- After `import` statements, suggest common setup boilerplate for the detected framework
- Aware of qubit count — never suggests gates on qubits that don't exist

**Settings**
- Toggle completions on/off in settings (default: on)
- Adjust trigger delay (300ms – 1000ms)
- Toggle "quantum-aware" mode vs. generic Python completions

### Acceptance Criteria
- [ ] Ghost text appears within 300ms of pause
- [ ] Tab accepts, Esc dismisses, typing dismisses
- [ ] Completions are contextually correct for quantum code
- [ ] No completions inside comments or strings
- [ ] Cmd+Right accepts word-by-word
- [ ] Completions respect qubit count (no out-of-bounds gates)
- [ ] Settings toggle works
- [ ] No visible jank or cursor jumping when suggestions appear/disappear

---

## Sprint 2: Cmd+K Inline Edit

### Objective

Select code, press Cmd+K, describe what you want in natural language, and Dirac rewrites the selection. The quantum equivalent of "make this circuit use fewer gates" or "add error correction to this."

### Requirements

**Inline Edit Flow — `src/components/editor/inlineEdit/`**

Trigger:
- Select code (or place cursor on a line) → Cmd+K
- A small inline input field appears directly below the selection (not a modal, not the side panel)
- Input field has a single text field with placeholder: "Describe the change..."
- Enter submits, Esc cancels

Input Field Design:
- Floating below the selected code, attached to the editor
- Background: `#1A2A42` with `#00B4D8` border
- Input text: `#E0E0E0`, placeholder: `#3D5A80`
- Subtle shadow for depth
- Moves with the editor as it scrolls
- Auto-focuses on open

Processing:
- Anthropic API call with `claude-sonnet` (complex edits need stronger reasoning)
- Payload: selected code, full file for context, the user's instruction, framework, current CircuitSnapshot
- System prompt for Cmd+K calls (separate from chat system prompt): "You are Dirac, a quantum computing expert. Rewrite the selected code according to the user's instruction. Return ONLY the replacement code, no explanation. Preserve the user's coding style and variable names."
- This is a different API call path than the chat — no tool definitions, no conversation history, just a focused rewrite prompt

Diff Preview:
- Before applying, show an inline diff directly in the editor
- Removed lines: red background `#3D1A1A`
- Added lines: green background `#1A3D1A`
- Accept (Cmd+Enter or click "Apply") / Reject (Esc or click "Dismiss")
- Diff is editable — user can tweak before accepting

Common Quantum Edits (optimize for these):
- "Add measurement to all qubits"
- "Make this circuit use fewer CNOT gates"
- "Convert this from Qiskit to Cirq"
- "Add a barrier before measurement"
- "Parameterize the rotation angles"
- "Add error mitigation"
- "Uncompute the ancilla qubits"

**History**
- Recent Cmd+K prompts stored (up to 20)
- Up arrow in the input field cycles through history
- History persisted across sessions

### Acceptance Criteria
- [ ] Cmd+K opens inline input below selection
- [ ] Natural language instruction rewrites the selected code
- [ ] Inline diff preview shows before applying
- [ ] Accept/reject flow works cleanly
- [ ] Framework conversion works (e.g., Qiskit → Cirq)
- [ ] Recent prompts accessible via up arrow
- [ ] Esc cancels at any stage without changing code
- [ ] Works with no selection (operates on current line)

---

## Sprint 3: Dirac Memory & Student Model

### Objective

The frontend tracks a persistent student model and injects it into every Claude API call's system prompt. Claude then adapts its explanations based on that context. The "memory" lives client-side — Claude doesn't remember between API calls, so we pass the student model each time.

### Requirements

**Student Model — `src/stores/studentStore.ts` + persistent storage**

Tracked Data:
```typescript
interface StudentModel {
  // Skill assessment
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  conceptsMastered: string[];       // e.g., ['superposition', 'entanglement', 'bell-states']
  conceptsStruggling: string[];     // e.g., ['phase-kickback', 'qft']

  // Behavior patterns
  commonErrors: Array<{
    errorType: string;              // e.g., 'qubit-index-out-of-range'
    frequency: number;
    lastOccurred: string;           // ISO date
  }>;
  preferredFramework: Framework;
  codingStyle: {
    usesComments: boolean;
    averageCircuitSize: number;     // gates
    prefersVerboseNames: boolean;
  };

  // Learning preferences (inferred)
  learningStyle: 'visual' | 'conceptual' | 'hands-on';  // inferred from behavior
  prefersCodeFirst: boolean;        // vs. explanation first
  detailLevel: 'brief' | 'moderate' | 'detailed';

  // History
  exercisesCompleted: string[];
  learningPathProgress: Record<string, number>;
  totalSessionCount: number;
  totalCodeExecutions: number;

  // Timestamps
  firstSession: string;
  lastSession: string;
}
```

Inference Logic:
- Skill level: inferred from circuit complexity, error frequency, exercise difficulty
- Learning style: "visual" if they interact with Bloch sphere/circuit a lot, "conceptual" if they ask many "why" questions, "hands-on" if they mostly just code
- Detail level: tracks whether user reads full explanations or skips ahead
- Update model after each session, not in real-time (batch inference)

**Personalization (via system prompt injection)**
- System prompt dynamically includes a summary of the StudentModel JSON
- Prompt instructions differ by level:
  - Beginner: "Use analogies, avoid heavy math, celebrate progress"
  - Intermediate: "Include matrix notation when relevant, suggest optimizations"
  - Advanced: "Discuss error correction, hardware constraints, assume strong linear algebra background"
- Common errors from the student model are included: "This student frequently makes [error type] mistakes — if you see an opportunity, teach the underlying concept proactively"
- Mastered concepts noted: "Skip basic explanations for [concepts] — the student already understands these"
- Claude doesn't actually "remember" — we reconstruct the relevant context each call

**Memory Panel**
- Accessible from Dirac settings or a "Your Progress" tab
- Shows: skill level, concepts mastered, learning streak
- "Reset Dirac's memory" option
- Export/import student model (JSON) for backup or sharing between devices

**Privacy**
- All data stored locally only (Tauri storage on desktop, localStorage on web)
- No student data sent to servers beyond the Claude API calls
- Clear data option in settings

### Acceptance Criteria
- [ ] Dirac's explanation depth adapts to student skill level
- [ ] Skill level inference works (beginner code → beginner explanations)
- [ ] Common errors are tracked and Dirac preemptively teaches around them
- [ ] Student model persists across sessions
- [ ] Memory panel shows accurate progress summary
- [ ] "Reset memory" clears all student data
- [ ] Privacy: no student data leaves the device except in API calls

---

## Sprint 4: Dirac Reasoning Mode

### Objective

For hard quantum problems, the API call switches to Sonnet with `extended_thinking` enabled (Anthropic's built-in chain-of-thought feature). The thinking tokens are streamed to the UI so the student sees Claude's reasoning process. This isn't a separate system — it's the same Claude API with an extra parameter.

### Requirements

**Reasoning Mode Trigger**
- Automatic: Dirac detects the question requires multi-step reasoning
  - Circuit optimization ("reduce gate count", "simplify this circuit")
  - Algorithm correctness ("prove this implements Grover's", "why doesn't this teleport correctly")
  - Debugging entanglement ("why aren't these qubits entangled")
  - State analysis ("what's the state vector after step 3")
- Manual: user types `/think` or clicks a "Think deeply" button
- Visual indicator: Dirac's avatar/icon changes to a "thinking" state

**Thinking UI**
- Collapsible "Dirac's reasoning" section above the final answer
- Shows the step-by-step thought process in a lighter, indented format
- Steps can reference gates, qubits, and states — clickable to highlight in the circuit
- Reasoning rendered in a monospace font with math notation
- Final answer is prominent below the reasoning
- User can collapse the reasoning to just see the answer

**API Configuration for Reasoning Mode**
- Anthropic API call with `claude-sonnet`, `thinking.type: "enabled"`, `thinking.budget_tokens: 10000`
- Stream the thinking block content to the "Dirac's reasoning" UI section
- Final answer (the non-thinking response) streams after thinking completes
- Show a progress indicator: "Dirac is thinking deeply..." with elapsed time
- This uses Anthropic's extended thinking API — no custom reasoning framework needed

**Quantum-Specific Reasoning Capabilities**
- Gate-by-gate state evolution tracking (show state vector at each step)
- Circuit equivalence checking ("is circuit A equivalent to circuit B?")
- Optimal gate decomposition suggestions
- Entanglement analysis ("which qubits are entangled and why")
- Error propagation analysis ("if qubit 2 has a bit-flip error, how does it affect the output")

**Integration with Visualizations**
- During reasoning, Dirac can highlight gates it's analyzing
- Step-through mode can sync with reasoning steps
- Bloch sphere can show intermediate states Dirac references

### Acceptance Criteria
- [ ] Reasoning mode activates for complex quantum questions
- [ ] Step-by-step thinking is visible and collapsible
- [ ] Reasoning references specific gates/qubits (clickable to highlight)
- [ ] Extended thinking produces measurably better answers for optimization questions
- [ ] Manual trigger (`/think`) works
- [ ] Progress indicator shows during deep thinking
- [ ] Reasoning + visualization integration works (highlighting, step-through)

---

## Sprint 5: Smart Code Actions & Refactoring

### Objective

Context-aware code actions appear as lightbulb suggestions in the editor gutter. One-click quantum-specific refactorings.

### Requirements

**Code Actions Framework — `src/components/editor/codeActions/`**

Detection (run on each CircuitSnapshot update):
- Analyze the circuit for optimization opportunities
- Analyze the code for common patterns that could be improved
- Populate lightbulb icons in the Monaco editor gutter

Built-in Code Actions:

| Action | Trigger | What It Does |
|--------|---------|--------------|
| **Optimize gate count** | Circuit has redundant gates (e.g., H followed by H = identity) | Removes redundant gate pairs, suggests equivalent shorter sequences |
| **Add measurements** | Circuit has no measurements | Inserts measurement on all qubits with classical bit mapping |
| **Decompose gate** | Custom or composite gate detected | Breaks down into primitive gates (H, CNOT, Rz) |
| **Convert framework** | User right-clicks or selects code | Rewrites circuit in a different framework (Qiskit ↔ Cirq ↔ CUDA-Q) |
| **Parameterize** | Hardcoded rotation angles detected | Extracts angles into variables/parameters |
| **Add barrier** | Long circuit with no barriers | Suggests logical barrier placements for readability |
| **Uncompute ancilla** | Ancilla qubits not cleaned up | Generates uncomputation sequence |
| **Transpile for hardware** | Generic circuit | Rewrites using only gates available on target hardware (IBM, Google) |

Code Action UX:
- Yellow lightbulb in editor gutter on lines with available actions
- Click lightbulb → dropdown menu of available actions
- Cmd+. (quick fix shortcut) opens the same menu
- Each action shows a one-line description
- Selecting an action shows inline diff preview (same as Cmd+K)
- Accept/reject before applying

**Circuit Optimization Engine (local, no API call)**
- Gate cancellation: adjacent inverse gates cancel (H·H = I, X·X = I)
- Gate merging: adjacent rotations on same qubit merge (Rz(θ₁)·Rz(θ₂) = Rz(θ₁+θ₂))
- Commutation: reorder commuting gates to enable more cancellations
- These run locally in the kernel (Python) — no Claude API call needed for basic optimizations
- Complex optimizations (hardware transpilation, algorithmic rewrites) use Dirac/Claude

### Acceptance Criteria
- [ ] Lightbulb appears for at least 4 different code action types
- [ ] Clicking lightbulb shows action menu
- [ ] Cmd+. opens the same menu
- [ ] Each action produces a correct code transformation
- [ ] Inline diff preview before applying
- [ ] Gate cancellation works without API call (local optimization)
- [ ] Framework conversion works between all three frameworks
- [ ] Actions don't appear when not applicable (no false positives)

---

## Sprint 6: Multi-File Projects

### Objective

Support multi-file quantum projects with a file explorer sidebar, imports across files, and Dirac awareness of the full project context.

### Requirements

**File Explorer — `src/components/explorer/`**
- Tree view sidebar on the far left (collapsible)
- Shows project directory structure
- File icons by type (.py, .qasm, .json, .md)
- Right-click context menu: New File, New Folder, Rename, Delete, Duplicate
- Drag-and-drop to move files
- Active file highlighted

**Editor Tabs**
- Multiple files open as tabs above the Monaco editor
- Tab shows filename + dirty indicator
- Close button on each tab (with save prompt if dirty)
- Cmd+W closes current tab
- Cmd+Tab cycles through open tabs
- Tab overflow: scroll or dropdown for many open files

**Project-Level Features**
- "Open Folder" (Cmd+Shift+O) sets the project root
- Project-level settings in `.nuclei/config.json`:
  ```json
  {
    "framework": "qiskit",
    "pythonPath": "/usr/bin/python3",
    "kernelArgs": [],
    "defaultShots": 1024
  }
  ```
- Import resolution: kernel handles `from my_utils import create_bell_state` across project files
- Run configuration: specify which file is the entry point

**Dirac Project Context**
- Dirac can see all open files (not just the active one)
- File references in Dirac's responses are clickable (opens that file)
- "Explain this project" — Dirac gives an overview of all files and how they connect
- Code insertions can target any open file, not just the active one

### Acceptance Criteria
- [ ] File explorer shows project directory tree
- [ ] Multiple files open in tabs
- [ ] Tab management works (close, cycle, dirty indicator)
- [ ] Cross-file imports execute correctly in the kernel
- [ ] Dirac references files by name and they're clickable
- [ ] Project configuration via `.nuclei/config.json`
- [ ] Drag-and-drop file organization works

---

## Phase 5 Definition of Done

When Phase 5 is complete, Nuclei's editor experience rivals Cursor/Copilot for quantum code:
1. Ghost completions suggest quantum-aware code as you type
2. Cmd+K rewrites selected code from natural language descriptions
3. Dirac remembers the student and adapts explanations to their level
4. Hard quantum problems get step-by-step reasoning with visualization
5. Lightbulb code actions offer one-click circuit optimizations
6. Multi-file projects with file explorer and tabs

## Dependencies & Assumptions

- Phases 1–4 complete and stable
- Anthropic API supports extended thinking (current as of 2025)
- Haiku is fast enough for <300ms completions (validate latency with Anthropic's API)
- Monaco `inlineCompletions` API is stable and documented
- Student model is rule-based (no ML) — inference runs locally as plain TypeScript logic
- All "Dirac intelligence" comes from Claude + system prompt + context injection — no custom model training

## Non-Goals for Phase 5
- Real hardware execution (Phase 7)
- Collaborative editing (Phase 7)
- Custom model fine-tuning for quantum (future research)
- Voice interface for Dirac (future consideration)
