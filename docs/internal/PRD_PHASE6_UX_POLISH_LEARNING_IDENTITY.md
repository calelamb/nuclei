# Nuclei — Phase 6 PRD: UX Polish, Learning Identity & Zero-to-Quantum Experience

## Phase Goal

Make Nuclei the most approachable quantum computing environment on Earth. Someone who has never written a line of code — let alone quantum code — should be able to open Nuclei, feel welcomed, and within 30 minutes understand what a qubit is, build their first circuit, and watch it run. Every pixel, animation, and interaction should reduce intimidation and spark curiosity. The UX should feel like a calm, focused workspace — minimalist but alive, clean but warm.

This phase is about **identity**. Nuclei isn't an IDE with a tutorial bolted on. It's a learning space that happens to be a powerful IDE.

## Timeline

Weeks 19–25 (7 sprints)

## Prerequisites

Phase 5 complete: inline AI editor, intelligent Dirac, multi-file projects.

---

## Sprint 1: The Welcome Experience (Zero Knowledge Onboarding)

### Objective

A person who has never heard of quantum computing opens Nuclei and, within their first session, understands qubits, superposition, and measurement — and has built a working circuit. No prior coding experience required.

### Requirements

**First Launch Flow — `src/components/onboarding/`**

This replaces the Phase 3 onboarding with something much more ambitious.

Sequence:
1. **Welcome Screen** — Full-screen, minimal. "Welcome to Nuclei. Ready to explore quantum computing?" Two paths:
   - "I'm brand new" → full guided experience (below)
   - "I know some quantum" → skip to IDE with Dirac intro
   - "I'm experienced" → straight to editor, minimal hand-holding

2. **The Quantum Playground** (for "I'm brand new")
   - NOT the IDE. A separate, simplified interactive environment.
   - Single qubit on screen, represented as a glowing sphere (simplified Bloch sphere)
   - Dirac (Claude API, Haiku for speed) speaks in a conversational chat bubble alongside: "This is a qubit. Unlike a regular bit that's 0 or 1, a qubit can be both at the same time. Let's see what that looks like."
   - Interactive: click "Apply H gate" → watch the sphere animate to the equator → Dirac explains superposition
   - Interactive: click "Measure" → sphere snaps to |0⟩ or |1⟩ → Dirac explains collapse
   - Run it 10 times → see a histogram build up → "See? Roughly half the time it's 0, half it's 1. That's superposition."
   - Interactive: add a second qubit → CNOT → "Now they're entangled. Measuring one tells you about the other."
   - Total time: ~5 minutes of clicking and reading

3. **Bridge to the IDE**
   - "You just built a quantum circuit. Let's see what that looks like in code."
   - Transition animation: the playground fades and the IDE fades in with the same circuit loaded
   - The code for what they just built is in the editor
   - Circuit diagram matches what they saw in the playground
   - Dirac: "This is the same circuit, but now you can modify the code directly. Try changing the 0 to a 1 and see what happens."

4. **Guided First Edit**
   - Dirac highlights a specific line and suggests a change
   - Circuit diagram updates live — student sees the connection between code and visualization
   - Dirac celebrates: "You just modified a quantum circuit. You're a quantum programmer now."

Design Principles:
- Zero jargon until it's explained
- Every concept introduced visually BEFORE showing code
- Dirac never says "it's simple" or "just do X" — everything is treated as genuinely interesting
- Progress feels fast — something happens every 30 seconds
- The student should feel smart, not overwhelmed

**Returning User Experience**
- On subsequent launches: "Welcome back, [name]. Pick up where you left off?" → jumps to last open file/exercise
- If the student hasn't opened Nuclei in >7 days: gentle re-engagement, quick recap of last session
- Daily learning streak visible but not nagging

### Acceptance Criteria
- [ ] First launch shows welcome screen with three paths
- [ ] Quantum Playground teaches qubit/superposition/measurement interactively in ~5 minutes
- [ ] Smooth transition from Playground to IDE with same circuit loaded
- [ ] Guided first edit produces a visible change in the circuit diagram
- [ ] Returning users get "pick up where you left off"
- [ ] Zero jargon appears before it's visually explained
- [ ] The entire first-launch flow is completable by a non-programmer

---

## Sprint 2: Progressive Disclosure & Adaptive UI

### Objective

The UI reveals complexity gradually. A beginner sees a simple, focused workspace. As they grow, advanced features appear naturally.

### Requirements

**UI Complexity Levels**

Three modes, auto-selected based on StudentModel (Phase 5) but manually switchable:

**Beginner Mode:**
- Editor panel + circuit diagram + Dirac side panel only (three panels)
- Bottom panel hidden by default (auto-opens for results when simulation runs)
- Bloch sphere hidden (too abstract initially)
- Status bar simplified: just framework name and "Run" button
- Large, friendly "Run" button (not just Cmd+Enter)
- Code actions hidden — Dirac suggests improvements conversationally in the side panel
- File explorer hidden — single-file experience
- Gate labels on the circuit diagram are larger with emoji hints (e.g., ⚡ for H gate with tooltip "Creates superposition")
- Dirac side panel is always visible and slightly wider by default (~360px) — it's the primary learning interface

**Intermediate Mode:**
- All panels visible: editor, circuit, Bloch sphere, Dirac side panel
- Bottom panel with Terminal + Histogram tabs
- Status bar shows qubit count and depth
- Code actions (lightbulb) enabled
- Histogram panel with shot control
- File explorer available but collapsed
- Dirac panel at standard width (~320px)

**Advanced Mode:**
- Everything visible
- Multi-file projects with file explorer
- All code actions and optimizations
- Framework conversion
- Step-through debugging
- Performance metrics in status bar
- Custom panel arrangements
- Dirac panel collapsible for maximum editor space

**Transition Between Modes**
- Automatic: Dirac suggests upgrading when the student demonstrates readiness
  - "You've been writing multi-qubit circuits — want me to show you the Bloch sphere? It'll help you visualize what's happening to each qubit."
- Manual: settings toggle or Cmd+Shift+L to cycle modes
- Smooth transition: new panels slide in with a brief Dirac explanation of what they do

**Contextual Help Everywhere**
- Every panel has a subtle "?" icon in its header
- Clicking "?" → Dirac explains that panel in the context of what the student is currently doing
- First time a panel appears in a new mode, Dirac gives a one-sentence intro
- Help text never blocks the UI — appears as a tooltip or Dirac chat message

### Acceptance Criteria
- [ ] Beginner mode shows simplified two-panel layout
- [ ] Intermediate mode shows all four panels
- [ ] Advanced mode enables all features
- [ ] Auto-transition works based on student skill level
- [ ] Manual mode switching works (Cmd+Shift+L)
- [ ] New panels slide in with Dirac explanation
- [ ] "?" help icons present on every panel
- [ ] Mode preference persists across sessions

---

## Sprint 3: Dirac Side Panel Rework

### Objective

Move Dirac out of the cramped bottom tab and into a dedicated right-side panel — like Claude Code in VS Code or OpenAI Codex. Dirac becomes a persistent, always-visible coding partner instead of a hidden tab you have to click into.

### Requirements

**New Layout — Dirac as Right Side Panel**

The overall IDE layout changes from "bottom tab with Dirac" to:
- **Left:** Monaco editor (+ file explorer in advanced mode)
- **Center-right:** Stacked visualizations — circuit diagram (top), Bloch sphere (bottom)
- **Far right:** Dirac panel — full-height side panel, resizable width
- **Bottom (collapsible):** Terminal + Histogram tabs only (Dirac moves out)

Dirac Panel Design (modeled after Claude Code / Codex / Cursor chat):
- Full height of the window, right-side, default width ~320px
- Resizable left edge (drag to make wider/narrower, min 280px, max 50% of window)
- Collapsible: Cmd+D toggles visibility, collapse button in panel header
- When collapsed, a thin vertical strip remains with "Dirac" label and expand button

Panel Header:
- "Dirac" label with purple accent icon
- New conversation button (clears history, starts fresh)
- Collapse/expand chevron
- Settings gear (model routing, context toggles)

Message Area:
- Full-width messages, no avatars — clean and dense like a terminal chat
- User messages: subtle background `#1A2A42`, left-aligned
- Dirac messages: no background, left-aligned, purple left border accent `#7B2D8E`
- Code blocks in responses: full-width, syntax highlighted, with "Apply to Editor" button
- Markdown rendering: headings, bold, code, lists, math (KaTeX)
- Streaming responses render token-by-token
- Auto-scroll to bottom, but stop auto-scrolling if user scrolls up (re-engage on new user message)
- Timestamp on each message (subtle, secondary text)

Input Area:
- Fixed to bottom of the Dirac panel
- Multi-line text input (auto-grows up to 5 lines, then scrolls)
- Enter sends, Shift+Enter for newline
- Placeholder: "Ask Dirac anything..."
- Send button (arrow icon) appears when input is non-empty
- Slash commands supported in input:
  - `/explain` — explain the current circuit
  - `/fix` — diagnose and fix the current error
  - `/exercise` — start a new exercise
  - `/think` — enable reasoning mode for this message
  - `/clear` — clear conversation history
- Slash command autocomplete dropdown when typing "/"

Context Indicator:
- Small bar above the input showing what Dirac can currently see:
  - "Seeing: code · circuit · results" (each item as a subtle pill/tag)
  - Items light up teal when data is available, gray when not
  - Clickable: toggle what context gets injected into API calls

**Tool Use Actions in the Panel**
- When Dirac uses `insert_code`, show an inline code block with "Apply" / "Dismiss" buttons
- When Dirac uses `run_simulation`, show a brief status line: "Running simulation... ✓ Done (48ms)"
- When Dirac uses `highlight_gate`, the circuit panel highlights and Dirac's message notes which gate
- Tool actions are visually distinct from regular text — card-style with subtle border

**Conversation Persistence**
- Conversation history persists within a session (lost on app restart — this is fine for now)
- Each "New conversation" starts fresh but old conversations are gone (no history browser yet)
- Context (code, circuit, results) is re-injected on each message, not carried from history

**Keyboard Workflow**
- Cmd+D: toggle Dirac panel
- Cmd+L: focus Dirac input (same as Cursor)
- Esc (when Dirac input focused): return focus to editor
- Up arrow in empty input: edit last user message

### Acceptance Criteria
- [ ] Dirac renders as a full-height right-side panel, not a bottom tab
- [ ] Panel is resizable and collapsible (Cmd+D)
- [ ] Messages render cleanly with markdown, code blocks, and math
- [ ] Code blocks have "Apply to Editor" button
- [ ] Streaming responses render token-by-token
- [ ] Slash commands work with autocomplete dropdown
- [ ] Context indicator shows what Dirac can see
- [ ] Tool use actions render as distinct cards
- [ ] Cmd+L focuses the input, Esc returns to editor
- [ ] Bottom panel no longer has a "Dirac AI" tab (only Terminal + Histogram)
- [ ] Layout feels like Claude Code / Codex — clean, persistent, professional

---

## Sprint 4: Micro-Interactions & Animation System

> Note: Sprint numbering shifted — the Dirac side panel rework was inserted as Sprint 3.

### Objective

Every interaction in Nuclei feels alive. Subtle animations communicate state changes, provide feedback, and make the experience feel crafted — not generic.

### Requirements

**Animation Principles**
- Duration: 150–300ms for UI transitions, 500–1000ms for state changes (Bloch sphere, circuit)
- Easing: cubic-bezier(0.4, 0, 0.2, 1) — Material Design standard
- Never block interaction — all animations are interruptible
- Respect `prefers-reduced-motion` media query

**Specific Animations**

Circuit Diagram:
- Gates slide in from the right when added
- Gates fade out and collapse when removed
- Wire connections animate (draw from left to right) on first render
- Highlighted gates pulse with a teal glow (2 cycles, then steady)
- Measurement gates: meter needle swings when simulation runs
- CNOT: connection line draws from control to target

Bloch Sphere:
- State vector arrow smoothly animates to new position (spherical interpolation)
- Sphere has a subtle idle rotation (0.5rpm, stops when interacting)
- Gate application: brief flash along the rotation axis
- Measurement: arrow snaps to pole with a "click" easing (overshoot then settle)

Histogram:
- Bars grow from zero with staggered timing (left to right, 50ms stagger)
- On new simulation: old bars shrink, new bars grow (cross-fade)
- Hover: bar scales up slightly (1.05x) with shadow

Editor:
- Ghost completions fade in (150ms)
- Cmd+K input slides down from selection (200ms)
- Code action lightbulb: gentle pulse when available
- Error underlines: wave animation (subtle, not distracting)

Dirac:
- Messages slide up from the bottom
- "Thinking" indicator: three dots with staggered bounce
- Code blocks in Dirac's messages have a subtle syntax-highlight shimmer on first render
- Tool use actions: brief teal flash on the affected panel

Panel System:
- Panel resize: smooth with spring physics (slight bounce at limits)
- Panel collapse: slide + fade (200ms)
- Mode transition: panels rearrange with choreographed motion (staggered, 100ms between each)

**Status Bar Animations**
- Framework badge: subtle slide transition when framework changes
- "Running..." state: teal progress pulse (like a heartbeat)
- Qubit count/depth: number ticks up/down like a counter, not instant replacement
- Connection indicator: green dot pulses once on connect, red dot appears with a brief shake on disconnect

**Transition System — `src/lib/animations.ts`**
- Centralized animation utilities using CSS transitions + requestAnimationFrame
- No external animation library (keep bundle small) — or Framer Motion if justified
- All animations cancellable and chainable
- Performance budget: animations must not drop below 60fps

### Acceptance Criteria
- [ ] Circuit gates animate in/out smoothly
- [ ] Bloch sphere state vector animates between positions
- [ ] Histogram bars animate with staggered timing
- [ ] Dirac messages slide in, thinking dots bounce
- [ ] Panel transitions are smooth with spring physics
- [ ] All animations respect `prefers-reduced-motion`
- [ ] No animation drops below 60fps on mid-range hardware
- [ ] Animations feel cohesive — same easing and timing language throughout

---

## Sprint 5: Command Palette & Keyboard-First UX

### Objective

Power users can do everything without touching the mouse. A command palette (Cmd+Shift+P) is the universal launcher.

### Requirements

**Command Palette — `src/components/commandPalette/`**

Design:
- Centered modal overlay (like VS Code's command palette)
- Background blur behind the modal
- Search input at top, results below
- Fuzzy matching on command names and descriptions
- Results show command name, keyboard shortcut (if any), and category icon
- Enter executes, Esc closes
- Recent commands pinned at top

Command Categories:
- **File:** New, Open, Save, Save As, Recent Files
- **Edit:** Undo, Redo, Find, Replace, Format Code
- **View:** Toggle panels, Switch mode (Beginner/Intermediate/Advanced), Toggle theme, Zoom In/Out
- **Run:** Run Circuit, Change Shot Count, Stop Execution
- **Dirac:** Open Dirac, Ask Dirac, Start Exercise, Open Gate Explorer, Toggle Reasoning Mode
- **Circuit:** Export as SVG/PNG/QASM, Share, Step Through, Reset Step-Through
- **Learn:** Open Learning Path, Continue Exercise, Show Progress
- **Settings:** Open Settings, Reset Dirac Memory, Keyboard Shortcuts

Quick Switcher (Cmd+P):
- File switcher (separate from command palette)
- Shows open files and project files
- Fuzzy match on filename
- Preview file on hover/arrow-key

**Comprehensive Keyboard Shortcuts**

| Action | Shortcut | Context |
|--------|----------|---------|
| Run circuit | Cmd+Enter | Editor |
| Open command palette | Cmd+Shift+P | Global |
| Quick file switcher | Cmd+P | Global |
| Toggle Dirac panel | Cmd+D | Global |
| Inline edit | Cmd+K | Editor with selection |
| Accept completion | Tab | Editor with ghost text |
| Quick fix / code action | Cmd+. | Editor |
| Toggle bottom panel | Cmd+J | Global |
| Toggle sidebar | Cmd+B | Global |
| New file | Cmd+N | Global |
| Save | Cmd+S | Global |
| Find | Cmd+F | Editor |
| Replace | Cmd+H | Editor |
| Next tab | Cmd+Option+Right | Global |
| Previous tab | Cmd+Option+Left | Global |
| Close tab | Cmd+W | Global |
| Toggle theme | Cmd+Shift+T | Global |
| Cycle UI mode | Cmd+Shift+L | Global |
| Step forward | Cmd+Right | Step-through mode |
| Step backward | Cmd+Left | Step-through mode |
| Zoom in | Cmd+= | Global |
| Zoom out | Cmd+- | Global |

**Shortcut Hints**
- When a user performs an action with the mouse, briefly show the keyboard shortcut as a toast: "Tip: Cmd+Enter runs your circuit"
- Only show each hint once
- Disable hints in Advanced mode (user already knows)

### Acceptance Criteria
- [ ] Cmd+Shift+P opens command palette
- [ ] Fuzzy search works across all commands
- [ ] Recent commands appear at top
- [ ] Cmd+P opens file switcher
- [ ] All listed keyboard shortcuts work
- [ ] Shortcut hints appear for mouse actions (beginner/intermediate mode)
- [ ] Enter executes selected command, Esc closes palette

---

## Sprint 6: Visual Identity & Typography

### Objective

Nuclei has a distinctive visual identity that feels premium, calm, and intellectually stimulating — not like "yet another dark IDE."

### Requirements

**Brand Refinements**

Logo & Icon:
- App icon: abstract nucleus/atom motif using teal and purple
- In-app logo: "NUCLEI" in the status bar, subtle but distinctive
- Favicon (for web version): simplified icon that reads at 16×16

Color Palette Refinement:
- The existing palette is the foundation. This sprint refines and extends it.
- Add semantic colors:
  - Success: `#10B981` (green — simulation complete, exercise passed)
  - Warning: `#F59E0B` (amber — deprecated gate, performance concern)
  - Error: `#EF4444` (red — compile error, simulation fail)
  - Info: `#3B82F6` (blue — Dirac tip, learning callout)
- Gradient accents (use sparingly):
  - Teal to purple gradient for Dirac-related elements: `linear-gradient(135deg, #00B4D8, #7B2D8E)`
  - Subtle background gradient on the welcome screen

**Typography System**
- Headings: Inter, semibold
- Body: Inter, regular, 14px base
- Code: JetBrains Mono, 13-14px
- Dirac: Inter with slightly larger line-height (1.6) for readability
- Monospace in Dirac code blocks: JetBrains Mono
- Math notation: KaTeX or similar for rendered equations in Dirac's responses and gate explorer
- Size scale: 11px (caption), 13px (secondary), 14px (body), 16px (heading 3), 20px (heading 2), 28px (heading 1)

**Minimalist Design Principles**
- No gratuitous borders — use spacing and subtle background changes to separate regions
- Reduce visual noise: hide chrome elements until hover (close buttons on tabs, panel controls)
- Status bar: ultra-thin (24px), content fades in on hover for non-essential info
- Use whitespace aggressively — panels should breathe
- Icons: Lucide icon set (consistent, clean line icons)
- No decorative elements that don't serve a function

**Dark Theme Refinement**
- Background layers (creates depth without borders):
  - Layer 0 (deepest): `#080E18` — app edges, status bar
  - Layer 1: `#0F1B2D` — main panels (editor, circuit)
  - Layer 2: `#152238` — elevated elements (dropdowns, modals, tooltips)
  - Layer 3: `#1A2A42` — highest elevation (hover states, selected items)
- Text hierarchy:
  - Primary: `#E8ECF1` (headings, important text)
  - Secondary: `#94A3B8` (descriptions, labels)
  - Tertiary: `#475569` (placeholders, disabled)
  - Accent: `#00B4D8` (interactive, emphasis)

**Light Theme Refinement**
- Same layering philosophy but inverted:
  - Layer 0: `#F1F5F9`
  - Layer 1: `#FFFFFF`
  - Layer 2: `#F8FAFC`
  - Layer 3: `#E2E8F0` (hover, selected)
- Accent stays teal but slightly darkened for contrast: `#0891B2`

**Splash Screen (Desktop Only)**
- Brief (<2 seconds) splash while the kernel loads
- Nuclei logo + subtle animation (atom orbiting)
- Transitions smoothly into the IDE or welcome screen

### Acceptance Criteria
- [ ] Color palette is cohesive with semantic colors working throughout
- [ ] Typography scale is consistent across all components
- [ ] Math notation renders correctly in Dirac and gate explorer
- [ ] Dark theme has clear depth layering (no flat, same-color adjacent panels)
- [ ] Light theme is polished and visually distinct
- [ ] Minimalist: no gratuitous borders, chrome hides on idle
- [ ] Splash screen appears on desktop launch

---

## Sprint 7: Accessibility & Performance

### Objective

Nuclei is usable by everyone and runs smoothly on modest hardware.

### Requirements

**Accessibility (WCAG 2.1 AA)**
- Full keyboard navigation: every interactive element reachable via Tab/Shift+Tab
- Focus indicators: visible teal outline on all focused elements
- Screen reader support:
  - ARIA labels on all panels, buttons, and interactive elements
  - Circuit diagram: textual description generated from CircuitSnapshot ("2-qubit circuit: Hadamard on qubit 0, CNOT from qubit 0 to qubit 1, measurement on both qubits")
  - Bloch sphere: state described as text ("Qubit 0: pointing toward +X axis, in superposition state |+⟩")
  - Histogram: bar values announced ("State |00⟩: 52% probability, State |11⟩: 48% probability")
- Color contrast: all text meets 4.5:1 contrast ratio minimum
- Reduced motion: all animations disabled when `prefers-reduced-motion` is set
- High contrast mode: optional theme with stronger contrast ratios
- Font scaling: UI respects system font size settings

**Performance Budgets**

| Metric | Target | Measurement |
|--------|--------|-------------|
| App launch to interactive | <3s (desktop), <5s (web) | Time to first editable state |
| Code change to circuit update | <350ms (300ms debounce + 50ms render) | Debounce + parse + render |
| Simulation start to results | <2s for ≤10 qubits, <10s for ≤20 qubits | Kernel execution + render |
| Ghost completion appearance | <300ms after pause | API call + render |
| Cmd+K response | <3s for simple edits | API call + diff render |
| Animation frame rate | 60fps sustained | All animations |
| Memory usage | <500MB idle, <1GB during simulation | Desktop process |
| Bundle size (web) | <5MB initial, <10MB total with lazy loading | gzip compressed |

**Performance Optimizations**
- Lazy load heavy components: Three.js (Bloch sphere), D3 (circuit renderer), KaTeX (math)
- Virtualize long lists: Dirac message history, file explorer, command palette results
- Web workers for non-UI computation: circuit optimization, student model inference
- Memoize expensive renders: circuit diagram, histogram
- Debounce store updates that trigger re-renders
- Bundle splitting: core editor loads first, visualizations load in background

**Error Resilience**
- Kernel crash recovery: auto-restart kernel, restore last state
- API failure fallback: if Claude is unreachable, Dirac shows cached responses for common questions
- WebSocket reconnection: exponential backoff with user notification
- Save recovery: auto-save every 30 seconds, crash recovery on next launch

### Acceptance Criteria
- [ ] Full keyboard navigation through all panels
- [ ] Screen reader announces circuit, Bloch sphere, and histogram states
- [ ] All text meets WCAG 4.5:1 contrast ratio
- [ ] Reduced motion disables all animations
- [ ] App launches in <3s on desktop
- [ ] Circuit updates in <350ms from keystroke
- [ ] Ghost completions appear in <300ms
- [ ] Memory stays under 500MB idle
- [ ] Kernel auto-recovers from crashes
- [ ] Auto-save works and crash recovery restores state

---

## Phase 6 Definition of Done

When Phase 6 is complete, Nuclei is unmistakably polished:
1. A complete beginner can open Nuclei, learn what a qubit is, and build a circuit in under 30 minutes — without any prior knowledge
2. The UI adapts to the student's level: simple for beginners, powerful for experts
3. Every interaction feels alive with purposeful micro-animations
4. Power users fly through the app with keyboard shortcuts and the command palette
5. The visual identity is distinctive, calm, and premium
6. The app is accessible to users with disabilities
7. Performance is snappy on modest hardware

## Dependencies & Assumptions

- Phase 5 complete (StudentModel drives adaptive UI)
- KaTeX or similar library available for math rendering
- Lucide icon set covers all needed icons
- Performance targets achievable on 2020-era MacBook Air (M1, 8GB RAM)

## Non-Goals for Phase 6
- Native mobile app (web version suffices)
- Multiplayer / real-time collaboration (Phase 7)
- Custom theme editor (plugin system covers this)
- Localization / i18n (future consideration)
