# Nuclei — Learning Section PRD

## Vision

When a user clicks the Learning icon in the activity bar, the entire IDE view transitions to a full-screen learning environment. Dirac is the teacher — not a static curriculum. Dirac assesses the student's level, picks what to teach next, and uses a library of interactive demos, embedded YouTube videos, exercises, and quizzes to build understanding. The experience adapts to everyone from "I've never coded" to "I'm a developer who wants to learn quantum."

This is NOT a sidebar or a panel. It's a separate page that replaces the IDE when active. The student can switch back to the IDE at any time to write code, and switch back to learning when ready.

---

## Pedagogical Philosophy: Code-First, Math-When-Needed

Quantum computing is taught backwards almost everywhere. University courses start with linear algebra, Dirac notation, and tensor products — students drop off before they ever touch a qubit. Nuclei inverts this.

**Every concept starts with "run this code, look at what happens."** The Bloch sphere moves, the histogram changes, the circuit draws itself. Then we explain why. The math comes as the explanation for behavior the student has already observed, not as a prerequisite. This is how most people actually learn programming — nobody reads the compiler theory chapter first.

### The Watch → Play → Prove Loop

Every lesson follows a three-layer learning cycle:

**Layer 1: WATCH (Absorb)**
Short conceptual content. An embedded YouTube video (2-8 minutes) or a text block with an animated concept card. This is passive — the student is absorbing. Example: "A qubit can be in a superposition of 0 and 1 at the same time. Here's what that looks like on a Bloch sphere."

**Layer 2: PLAY (Explore)**
Interactive demos embedded right in the lesson. A mini-editor with pre-loaded code and a live circuit + histogram next to it. The student tweaks values and sees results immediately without leaving the lesson. Example: "Change the rotation angle from π/4 to π/2 and watch what happens to the probability distribution." This is where real understanding happens — intuition develops by poking at things.

**Layer 3: PROVE (Demonstrate)**
Exercises where the student writes code from scratch (or completes a partially-written circuit) to achieve a specific outcome. Example: "Create a circuit that produces the state |+⟩ on qubit 0." A Check button validates against expected probabilities. Failed attempts trigger Dirac offering a hint. Successful completion unlocks the next lesson.

**The key differentiator:** in every other quantum learning resource, you watch a video, then go somewhere else to practice. In Nuclei, the video, the explanation, the code editor, the circuit visualization, the Bloch sphere, the histogram, and the AI tutor are all on the same screen. You never leave. That's the product.

---

## Architecture

### Two Modes: Learn Mode and Code Mode

**Code Mode** (default): The IDE — editor, circuit, Bloch sphere, Dirac side panel, terminal, histogram. What exists today.

**Learn Mode**: Full-screen learning environment activated by clicking the Learning icon in the activity bar (GraduationCap icon). The IDE panels disappear and the learning view takes over.

Switching between modes is instant — no page reload, just a React state swap. Code state is preserved when entering Learn Mode and restored when returning.

### Learn Mode Layout

```
┌─────────────────────────────────────────────────────┐
│ Activity Bar │              Learn Mode               │
│ (same icons) │                                       │
│              │  ┌─────────────────┐  ┌────────────┐  │
│  [Files]     │  │                 │  │            │  │
│  [Search]    │  │  Content Area   │  │   Dirac    │  │
│  [Circuit]   │  │  (lessons,      │  │   Panel    │  │
│ >[Learning]  │  │   videos,       │  │            │  │
│  [Plugins]   │  │   demos,        │  │  (teaches, │  │
│              │  │   exercises)    │  │   guides,  │  │
│              │  │                 │  │   adapts)  │  │
│              │  │                 │  │            │  │
│  ─────       │  └─────────────────┘  └────────────┘  │
│  [Settings]  │                                       │
└─────────────────────────────────────────────────────┘
│                    Status Bar                        │
└─────────────────────────────────────────────────────┘
```

- **Content Area** (~65% width): Where lessons render — text, videos, interactive demos, exercises, quizzes
- **Dirac Panel** (~35% width): Persistent Dirac chat, same as in Code Mode but with learning-specific context injected
- The Activity Bar stays visible so the user can switch back to Code Mode anytime

---

## The Content Area

### Content Types

Each lesson is composed of content blocks that render in sequence, following the Watch → Play → Prove pattern. Content blocks are:

**1. Text Block**
- Rendered markdown with custom styling
- Supports headings, body text, inline code, code blocks, math (KaTeX)
- Images rendered inline
- Styled with the Nuclei theme (dark/light)

**2. Video Block (WATCH layer)**
- Embedded YouTube player (iframe)
- 16:9 aspect ratio, responsive width (max 720px, centered)
- Custom dark frame around the player matching the theme
- Video title and creator attribution below
- Timestamp links in the lesson text (click to jump to specific point in video)
- Autoplay off, controls visible

**3. Interactive Demo Block (PLAY layer)**
- A mini circuit editor embedded in the lesson
- Pre-loaded with specific code that demonstrates the concept
- "Run" button runs the circuit and shows results inline (mini histogram + mini Bloch sphere below the code)
- The student can modify the code and re-run — experimentation is encouraged
- "Reset" button restores the original demo code
- "Open in Editor" button switches to Code Mode with the demo code loaded
- **Exploration prompts**: text below the demo suggesting what to change ("Try replacing h(0) with rx(pi/4, 0) — what happens to the probability?")

**4. Exercise Block (PROVE layer)**
- Problem description (what to build)
- Empty code editor (or starter code with TODOs)
- "Check" button that verifies the solution against expected probabilities/measurements
- Progressive hints (reveal one at a time, 3-4 per exercise)
- Success/failure feedback inline
- On success: celebration animation + "Next" button
- On failure: specific feedback ("Expected ~50% on |0⟩ but got 100% — did you forget the H gate?")

**5. Quiz Block**
- Multiple choice questions
- Instant feedback (correct: green + explanation, wrong: red + try again)
- Questions pulled from a bank, so repeated attempts see different questions
- Score tracked per topic

**6. Concept Card**
- A visual explainer card for a single concept (e.g., "What is superposition?")
- Animated visual (CSS or lightweight canvas):
  - "bloch": spinning Bloch sphere with labeled state
  - "circuit": animated circuit with gates appearing one by one
  - "histogram": bars growing from zero
- One paragraph of explanation
- "Ask Dirac" button pre-fills a question about this concept

### Lesson Structure

A lesson is a sequence of content blocks with metadata:

```typescript
interface Lesson {
  id: string;
  title: string;
  description: string;
  difficulty: 'absolute-beginner' | 'beginner' | 'intermediate' | 'advanced';
  estimatedMinutes: number;
  prerequisites: string[];    // lesson IDs
  tags: string[];             // e.g., ['qubits', 'superposition', 'python-basics']
  contentBlocks: ContentBlock[];
  diracContext: string;       // system prompt addendum for Dirac while this lesson is active
}

type ContentBlock =
  | { type: 'text'; markdown: string }
  | { type: 'video'; youtubeId: string; title: string; creator: string; startTime?: number; endTime?: number }
  | { type: 'demo'; code: string; framework: Framework; description: string; explorationPrompt?: string }
  | { type: 'exercise'; id: string; title: string; description: string; starterCode: string; framework: Framework; expectedProbabilities?: Record<string, number>; expectedMeasurements?: Record<string, number>; tolerancePercent: number; hints: string[]; successMessage: string }
  | { type: 'quiz'; questions: QuizQuestion[] }
  | { type: 'concept-card'; title: string; visual: 'bloch' | 'circuit' | 'histogram' | 'custom-svg'; explanation: string; interactiveProps?: Record<string, unknown> }

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}
```

---

## Lesson Library

### Track 0: Python Essentials (Absolute Beginners Only)

These lessons only appear if the student indicates they don't know Python. Every example is quantum-flavored so it doesn't feel like a detour.

| # | Lesson | Concept | Demo |
|---|--------|---------|------|
| 0.1 | Hello, Quantum World | Print statements, running code | `print("Hello, Quantum World!")` |
| 0.2 | Variables Store Qubits | Variables, types, assignment | Store qubit counts and gate names in variables |
| 0.3 | Functions Build Circuits | Defining and calling functions | Write a function that creates a circuit with N qubits |
| 0.4 | Loops Apply Gates | For loops, range() | Loop over qubits to apply H gates to all of them |
| 0.5 | Importing Qiskit | Imports, modules, libraries | `from qiskit import QuantumCircuit` — what each part means |

---

### Track 1: Quantum Computing Fundamentals (10 lessons, fully detailed)

This is the core track. Every lesson follows Watch → Play → Prove.

---

#### Lesson 1.1: What is Quantum Computing?

**Difficulty:** beginner | **Time:** 15 min | **Prerequisites:** none

**WATCH:**
- Text: "Classical computers use bits — 0 or 1. Quantum computers use qubits, which can be 0, 1, or a combination of both at the same time. This isn't magic — it's physics. And you're about to see it in action."
- Video: Veritasium "How Does a Quantum Computer Work?" (youtubeId: `T2DXrs0OpHU`, 0:00–5:00)
- Concept Card: "Classical Bit vs Qubit" — animated visual showing a bit flipping (0/1) vs a Bloch sphere rotating continuously

**PLAY:**
- Demo: A simple circuit that creates a qubit and measures it. Just `QuantumCircuit(1,1)`, `measure(0,0)`. Run it — histogram shows 100% |0⟩. "This is a classical result. The qubit started in state |0⟩ and we measured it. Nothing quantum yet."
```python
from qiskit import QuantumCircuit
qc = QuantumCircuit(1, 1)
qc.measure(0, 0)
```
- Exploration prompt: "This circuit does nothing interesting — it just confirms the qubit starts at |0⟩. In the next lesson, we'll change that."

**PROVE:**
- Quiz: 3 multiple-choice questions
  - "What is the fundamental unit of quantum computing?" → Qubit
  - "How many states can a classical bit be in?" → 2 (0 or 1)
  - "What makes a qubit different from a classical bit?" → It can be in a superposition of 0 and 1

**Dirac context:** "The student is just starting. They may have zero quantum background. Be encouraging. Use analogies to coins (heads/tails). Do NOT mention linear algebra, matrices, or complex numbers yet."

---

#### Lesson 1.2: Your First Quantum Gate — The Hadamard

**Difficulty:** beginner | **Time:** 20 min | **Prerequisites:** 1.1

**WATCH:**
- Text: "A gate is an operation that changes a qubit's state. The most important gate in quantum computing is the Hadamard gate (H). It takes a qubit from a definite state (|0⟩) into a superposition — equal chances of measuring 0 or 1."
- Video: IBM Qiskit "What is Superposition?" (youtubeId: `kMm4white1o`)
- Concept Card: "The H Gate" — Bloch sphere animation showing |0⟩ (north pole) rotating to |+⟩ (equator)

**PLAY:**
- Demo: Add an H gate before measurement.
```python
from qiskit import QuantumCircuit
qc = QuantumCircuit(1, 1)
qc.h(0)
qc.measure(0, 0)
```
- Run it — histogram shows ~50% |0⟩, ~50% |1⟩. "You just put a qubit in superposition. The H gate rotated it from a definite |0⟩ to an equal mix of both."
- Exploration prompt: "Try running this 10 times. Notice how the exact percentages change slightly each time? That's quantum randomness — the outcomes are truly random, not pseudo-random like a computer's random number generator."

**PROVE:**
- Exercise: "Create a quantum coin flip"
  - Starter code: empty circuit scaffold
  - Task: "Build a circuit with 1 qubit that produces a 50/50 outcome"
  - Expected: probabilities within 5% of `{"0": 0.5, "1": 0.5}`
  - Hints: ["You need to put the qubit in superposition", "The Hadamard gate (qc.h) creates equal superposition", "Don't forget to add a measurement after the gate"]
  - Success: "Congratulations! You just built a quantum random number generator. No classical computer can produce truly random numbers like this."

**Dirac context:** "This lesson introduces the H gate and superposition. The student will see 50/50 results for the first time. Emphasize that this is REAL randomness, not pseudorandom. If they ask about the math, you can mention that H creates the state (|0⟩ + |1⟩)/√2, but keep it light. The Bloch sphere visual is more important than the math right now."

---

#### Lesson 1.3: Measurement — Observing Changes Everything

**Difficulty:** beginner | **Time:** 15 min | **Prerequisites:** 1.2

**WATCH:**
- Text: "In the classical world, measuring something doesn't change it. You can check the time without affecting the clock. In quantum mechanics, measurement fundamentally changes the system. A qubit in superposition 'collapses' to either 0 or 1 when you measure it — and the superposition is gone."
- Video: minutephysics "What is Quantum Measurement?" or similar (youtubeId: placeholder — research needed)
- Concept Card: "Measurement Collapse" — animated Bloch sphere: qubit at equator (superposition), measurement arrow appears, qubit snaps to north or south pole

**PLAY:**
- Demo: Two measurements on the same qubit.
```python
from qiskit import QuantumCircuit
qc = QuantumCircuit(1, 2)
qc.h(0)
qc.measure(0, 0)
qc.h(0)
qc.measure(0, 1)
```
- Exploration prompt: "Look at classical bit 1 (the second measurement). If measurement didn't collapse the state, the second H would undo the first (H applied twice = identity), and you'd always get |0⟩. But that's NOT what happens. The first measurement collapsed the state, so the second H creates a new superposition."

**PROVE:**
- Quiz:
  - "What happens when you measure a qubit in superposition?" → It collapses to either |0⟩ or |1⟩
  - "Can you undo a measurement?" → No, measurement is irreversible
  - "If you apply H twice without measuring in between, what do you get?" → The original state (back to |0⟩)

**Dirac context:** "This lesson is about measurement collapse. It's one of the most counterintuitive aspects of quantum mechanics. Students often struggle with WHY measurement changes the state — it's okay to say 'this is how nature works' rather than trying to explain the philosophy. Focus on the observable behavior: run the circuit, see the results, notice that measurement breaks the pattern."

---

#### Lesson 1.4: Rotation Gates — Controlling the Bloch Sphere

**Difficulty:** beginner | **Time:** 25 min | **Prerequisites:** 1.3

**WATCH:**
- Text: "The H gate is useful, but it only gives you 50/50. What if you want 70/30? Or 90/10? Rotation gates (RX, RY, RZ) let you rotate the qubit to any position on the Bloch sphere. The angle you choose determines the probability."
- Video: IBM Qiskit "Single Qubit Gates" (youtubeId: placeholder — research needed)
- Concept Card: "The Bloch Sphere" — interactive Bloch sphere with labels: |0⟩ at north pole, |1⟩ at south pole, |+⟩ and |−⟩ on the equator. Arrows showing RX rotates around X axis, RY around Y, RZ around Z.

**PLAY:**
- Demo 1: RY gate at different angles.
```python
from qiskit import QuantumCircuit
import math

qc = QuantumCircuit(1, 1)
qc.ry(math.pi / 4, 0)   # Try changing this angle!
qc.measure(0, 0)
```
- Exploration prompt: "Change `math.pi / 4` to `math.pi / 2` — what happens? Now try `math.pi` (full rotation). What do you get? The angle controls how far the qubit rotates from |0⟩ toward |1⟩."

- Demo 2: Compare RX, RY, RZ with the same angle.
```python
from qiskit import QuantumCircuit
import math

# Try each one — which ones change the histogram?
qc = QuantumCircuit(1, 1)
qc.ry(math.pi / 2, 0)   # Swap ry for rx or rz
qc.measure(0, 0)
```
- Exploration prompt: "RZ rotates around the Z axis. Since |0⟩ is at the north pole (on the Z axis), RZ doesn't change the probability — it only changes the phase. You won't see a difference in the histogram, but the Bloch sphere position changes. Phase matters later."

**PROVE:**
- Exercise: "Bias the coin"
  - Task: "Create a circuit where qubit 0 has approximately 75% chance of being measured as |0⟩ and 25% chance of |1⟩."
  - Hints: ["You need a rotation gate — RY is the most intuitive for changing probabilities", "The probability of measuring |1⟩ is sin²(θ/2) where θ is the RY angle", "For 25% on |1⟩: sin²(θ/2) = 0.25, so θ/2 = π/6, so θ = π/3"]
  - Expected: `{"0": 0.75, "1": 0.25}` with 8% tolerance
  - Success: "You can now prepare any single-qubit state you want. This is the foundation of quantum state preparation."

**Dirac context:** "This lesson introduces rotation gates and the Bloch sphere as a control surface. The big insight is that the angle parameter gives continuous control over probabilities. If the student asks about the math, you can introduce sin²(θ/2) for the RY probability, but lead with the visual — 'the further you rotate from the north pole, the more likely you measure |1⟩.' Encourage them to experiment with different angles."

---

#### Lesson 1.5: The X, Y, Z Gates — Pauli Gates

**Difficulty:** beginner | **Time:** 20 min | **Prerequisites:** 1.4

**WATCH:**
- Text: "Before we add more qubits, let's meet the three Pauli gates. They're the simplest quantum gates — each one does a 180° rotation around one axis of the Bloch sphere. X flips |0⟩ to |1⟩ (like a classical NOT gate). Y and Z are more subtle."
- Concept Card: "Pauli X" — Bloch sphere animation: qubit at |0⟩ (north), X gate rotates 180° around X axis, lands at |1⟩ (south)
- Concept Card: "Pauli Z" — Bloch sphere animation: qubit at |+⟩ (equator), Z gate rotates 180° around Z axis, lands at |−⟩ (still equator, histogram unchanged)

**PLAY:**
- Demo: Try all three Pauli gates on |0⟩.
```python
from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.x(0)       # Try .y(0) and .z(0) too
qc.measure(0, 0)
```
- Exploration prompt: "X gives 100% |1⟩ — it's a bit flip. Now try Z. The histogram shows 100% |0⟩ still! Z doesn't change |0⟩. But put an H before the Z, then another H after. Now what happens?"

- Demo 2: Z gate's hidden effect revealed through H-Z-H.
```python
from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.h(0)
qc.z(0)
qc.h(0)
qc.measure(0, 0)
```
- Exploration prompt: "H-Z-H gives 100% |1⟩! The Z gate changed the phase while the qubit was in superposition, and the second H converted that phase difference into a measurable bit flip. This is the core idea behind many quantum algorithms."

**PROVE:**
- Exercise: "Flip a qubit without using X"
  - Task: "Start with |0⟩ and get 100% |1⟩ outcome using only H and Z gates (no X gate allowed)."
  - Hints: ["Think about what H-Z-H did in the demo", "H puts you in superposition, Z flips the phase, H converts that back", "The sequence H → Z → H is equivalent to X"]
  - Expected: `{"1": 1.0}` with 1% tolerance
  - Success: "You just discovered gate equivalence — different gate sequences can produce the same result. H-Z-H = X. This kind of decomposition is fundamental to quantum circuit design."

**Dirac context:** "This lesson covers Pauli gates. The X gate is straightforward (bit flip). The crucial insight is that Z gate 'does nothing visible' to |0⟩ but matters when the qubit is in superposition. The H-Z-H = X equivalence is the first time the student sees that different circuits can be equivalent. If the student is confused about phase, use the Bloch sphere: 'Z rotates around the vertical axis — if you're at the north pole, spinning around the pole doesn't move you. But if you're on the equator (superposition), it swings you to the opposite side.'"

---

#### Lesson 1.6: Two Qubits — More Qubits, More States

**Difficulty:** beginner | **Time:** 20 min | **Prerequisites:** 1.5

**WATCH:**
- Text: "One qubit has 2 possible outcomes: |0⟩ and |1⟩. Two qubits have 4: |00⟩, |01⟩, |10⟩, |11⟩. Three qubits have 8. N qubits have 2^N. This exponential growth is where quantum computing gets its power."
- Video: IBM Qiskit "Multi-qubit States" (youtubeId: placeholder — research needed)
- Concept Card: "Exponential State Space" — visual showing 1 qubit → 2 bars, 2 qubits → 4 bars, 3 qubits → 8 bars, ... 10 qubits → 1024 bars in the histogram

**PLAY:**
- Demo: A 2-qubit circuit, measure both.
```python
from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.x(1)                  # Flip qubit 1 to |1⟩
qc.measure([0, 1], [0, 1])
```
- Exploration prompt: "The result is |10⟩ (qubit 1 is |1⟩, qubit 0 is |0⟩). Note: Qiskit uses little-endian ordering — the rightmost bit is qubit 0. Try putting H on qubit 0 instead of X on qubit 1. What are the possible outcomes?"

- Demo 2: Both qubits in superposition independently.
```python
from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.h(1)
qc.measure([0, 1], [0, 1])
```
- Exploration prompt: "Four equal bars! Each qubit is independently in superposition, so all 4 combinations are equally likely. But these qubits aren't connected to each other — they're independent. In the next lesson, we'll link them."

**PROVE:**
- Exercise: "Create the |01⟩ state"
  - Task: "Build a 2-qubit circuit that always measures |01⟩ (qubit 0 = 1, qubit 1 = 0)."
  - Hints: ["Qubits start in |0⟩ — you only need to flip the one you want to be |1⟩", "Which qubit needs to be |1⟩? Remember Qiskit's ordering: the rightmost bit is qubit 0", "Apply X to qubit 0 to flip it to |1⟩"]
  - Expected: `{"01": 1.0}` with 1% tolerance
  - Success: "You can now prepare specific multi-qubit states. You're controlling individual qubits independently."

**Dirac context:** "This lesson introduces multi-qubit systems. The big idea is exponential state space — 2^N outcomes for N qubits. The Qiskit little-endian bit ordering confuses many beginners (|01⟩ means qubit 0 is 1, qubit 1 is 0). Watch for this and clarify if they get mixed up. The independence of the two qubits in the H-H demo is important setup for entanglement in the next lesson."

---

#### Lesson 1.7: The CNOT Gate — Qubits That Talk to Each Other

**Difficulty:** beginner | **Time:** 25 min | **Prerequisites:** 1.6

**WATCH:**
- Text: "So far, each qubit has been independent — gates on qubit 0 don't affect qubit 1. The CNOT (Controlled-NOT) gate changes that. It has a control qubit and a target qubit. If the control is |1⟩, it flips the target. If the control is |0⟩, it does nothing. This is the first two-qubit gate, and it's how qubits become connected."
- Video: IBM Qiskit "Entanglement & CNOT" (youtubeId: placeholder — research needed)
- Concept Card: "CNOT Gate" — circuit diagram showing control (dot) and target (⊕), with truth table: |00⟩→|00⟩, |01⟩→|01⟩, |10⟩→|11⟩, |11⟩→|10⟩

**PLAY:**
- Demo 1: CNOT with control in |1⟩.
```python
from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.x(0)         # Put control qubit in |1⟩
qc.cx(0, 1)     # CNOT: control=0, target=1
qc.measure([0, 1], [0, 1])
```
- Exploration prompt: "Result: |11⟩. The control (qubit 0) was |1⟩, so CNOT flipped the target (qubit 1) from |0⟩ to |1⟩. Now remove the X gate so control stays |0⟩. What happens?"

- Demo 2: CNOT with control in superposition.
```python
from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.h(0)         # Control in superposition
qc.cx(0, 1)     # CNOT
qc.measure([0, 1], [0, 1])
```
- Exploration prompt: "Only |00⟩ and |11⟩ appear! Never |01⟩ or |10⟩. The qubits are now correlated — if one is 0, the other is always 0. If one is 1, the other is always 1. This is entanglement. You just created a Bell state."

**PROVE:**
- Exercise: "Create the anti-correlated Bell state"
  - Task: "Build a circuit where the two qubits are always opposite: if one is |0⟩ the other is |1⟩, and vice versa. You should only see |01⟩ and |10⟩ in the histogram."
  - Hints: ["Start with the Bell state from the demo (H + CNOT)", "You need to flip one of the qubits after entangling them", "Add an X gate to qubit 0 or qubit 1 after the CNOT"]
  - Expected: `{"01": 0.5, "10": 0.5}` with 5% tolerance
  - Success: "You've created the |Ψ+⟩ Bell state — one of four maximally entangled states. Einstein called this 'spooky action at a distance.'"

**Dirac context:** "This lesson introduces CNOT and entanglement. The CNOT truth table is helpful but the real aha moment is Demo 2: H + CNOT producing only |00⟩ and |11⟩. Make sure the student understands that these qubits are now CORRELATED, not independent. If they ask 'why does this happen?' — explain it as: the CNOT says 'copy the control to the target,' but the control is in superposition, so the copy also gets entangled. Don't go into EPR paradox or Bell inequalities unless they ask."

---

#### Lesson 1.8: Entanglement — Spooky Action at a Distance

**Difficulty:** beginner | **Time:** 20 min | **Prerequisites:** 1.7

**WATCH:**
- Text: "Entanglement is the most powerful resource in quantum computing. When two qubits are entangled, measuring one instantly determines the other — no matter how far apart they are. Einstein was so disturbed by this that he called it 'spooky action at a distance.' But it's real, it's been experimentally verified thousands of times, and it's the engine behind quantum algorithms and quantum teleportation."
- Video: Veritasium "Quantum Entanglement Explained" (youtubeId: `ZuvK-od7jHA`)
- Concept Card: "The Four Bell States" — table showing all four maximally entangled states with their circuits: |Φ+⟩ = H+CNOT, |Φ−⟩ = H+CNOT+Z, |Ψ+⟩ = H+CNOT+X, |Ψ−⟩ = H+CNOT+X+Z

**PLAY:**
- Demo: All four Bell states side by side (the student switches between them).
```python
from qiskit import QuantumCircuit

# Bell State: |Φ+⟩  (try the others below)
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
# For |Φ-⟩: add qc.z(0)
# For |Ψ+⟩: add qc.x(1)
# For |Ψ-⟩: add qc.x(1) then qc.z(0)
qc.measure([0, 1], [0, 1])
```
- Exploration prompt: "Uncomment the different lines to create each Bell state. Notice that |Φ⟩ states always have matching qubits (00 or 11), while |Ψ⟩ states always have opposite qubits (01 or 10). The Z gate only affects which version (+ or −) you get — it changes the phase between the two terms."

**PROVE:**
- Exercise: "Create all four Bell states"
  - Task: "Build four separate circuits, one for each Bell state. Each should produce the correct pair of outcomes."
  - This is a multi-part exercise. Starter code has 4 circuit scaffolds.
  - Hints: ["All Bell states start with H on qubit 0 and CNOT(0,1)", "The difference is what you add AFTER the CNOT", "|Φ−⟩ adds a Z gate, |Ψ+⟩ adds an X gate, |Ψ−⟩ adds both"]
  - Expected: checks each circuit independently
  - Success: "You now know the four Bell states — the building blocks of quantum information. These appear everywhere: teleportation, superdense coding, error correction, and more."

**Dirac context:** "This lesson deepens entanglement understanding. The student already created a Bell state in the previous lesson — now they learn all four. The key conceptual point is that entanglement is a RESOURCE that quantum algorithms use, not just a curiosity. If the student asks about FTL communication, explain that you can't send information faster than light with entanglement — the outcomes are random, and you need classical communication to know what the other person measured."

---

#### Lesson 1.9: Phase and Interference — Why Quantum Algorithms Work

**Difficulty:** intermediate | **Time:** 25 min | **Prerequisites:** 1.8

**WATCH:**
- Text: "We've been focused on probabilities, but there's a hidden variable that doesn't show up in the histogram: phase. Phase is the secret ingredient that makes quantum algorithms faster than classical ones. When qubit states have the right phases, they can interfere — constructive interference amplifies correct answers, destructive interference cancels wrong ones."
- Video: 3Blue1Brown or IBM Qiskit on interference (youtubeId: placeholder — research needed)
- Concept Card: "Interference" — wave animation showing two waves adding constructively (bigger wave) and destructively (flat line)

**PLAY:**
- Demo 1: H-H cancellation (constructive interference back to |0⟩).
```python
from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.h(0)    # |0⟩ → |+⟩
qc.h(0)    # |+⟩ → |0⟩  (constructive interference)
qc.measure(0, 0)
```
- Exploration prompt: "100% |0⟩! The two H gates cancel out perfectly. The |0⟩ component interfered constructively and the |1⟩ component interfered destructively."

- Demo 2: H-Z-H (destructive interference gives |1⟩).
```python
from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.h(0)    # |0⟩ → |+⟩
qc.z(0)    # |+⟩ → |−⟩  (flip the phase)
qc.h(0)    # |−⟩ → |1⟩  (destructive interference)
qc.measure(0, 0)
```
- Exploration prompt: "The Z gate flipped the phase, so the second H produced destructive interference on |0⟩ and constructive interference on |1⟩. Result: 100% |1⟩. This H-Z-H = X pattern is the simplest example of a quantum algorithm using interference."

**PROVE:**
- Exercise: "Phase kickback"
  - Task: "Create a 2-qubit circuit where a controlled-Z (CZ) gate causes the CONTROL qubit to flip, not the target. This is called phase kickback and it's the engine behind Deutsch-Jozsa, Grover's, and Shor's algorithms."
  - Starter code with the setup, student fills in the middle.
  - Hints: ["Put the control qubit in |+⟩ state with H", "Put the target qubit in |1⟩ state with X", "Apply CZ, then H on the control again, then measure the control", "The CZ gate kicks a phase back to the control qubit, and the final H converts it to a bit flip"]
  - Expected: control qubit measures |1⟩ with high probability
  - Success: "Phase kickback is arguably the most important concept in quantum algorithms. Every quantum speedup — Deutsch-Jozsa, Grover's search, Shor's factoring — relies on this trick."

**Dirac context:** "This is the most conceptually difficult lesson so far. Phase is invisible in histograms but crucial for algorithms. The key demos are: (1) H-H = identity (constructive interference), (2) H-Z-H = X (destructive interference), and (3) phase kickback. If the student is struggling, focus on the wave analogy: waves can add up (constructive) or cancel out (destructive). Quantum algorithms arrange gates so that wrong answers cancel and right answers amplify. Don't rush — this lesson is worth spending extra time on."

---

#### Lesson 1.10: Your First Algorithm — Deutsch-Jozsa

**Difficulty:** intermediate | **Time:** 30 min | **Prerequisites:** 1.9

**WATCH:**
- Text: "Time to put everything together. The Deutsch-Jozsa algorithm is the simplest quantum algorithm that demonstrates quantum advantage. It answers a question in ONE query that would take a classical computer up to 2^(N-1) + 1 queries. Here's the question: given a function f(x) that takes N bits and returns 0 or 1, is f constant (same output for all inputs) or balanced (0 for half the inputs, 1 for the other half)?"
- Video: IBM Qiskit "Deutsch-Jozsa Algorithm" (youtubeId: placeholder — research needed)
- Concept Card: "Constant vs Balanced" — visual showing a function as a black box. Constant: all inputs → 0 (or all → 1). Balanced: half → 0, half → 1.

**PLAY:**
- Demo 1: Deutsch-Jozsa with a constant oracle (identity — f always returns 0).
```python
from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 1)

# Prepare
qc.x(1)         # Set output qubit to |1⟩
qc.h(0)          # Input qubit in superposition
qc.h(1)          # Output qubit in |−⟩

# Oracle: constant (do nothing — f(x) = 0 for all x)

# Interfere
qc.h(0)
qc.measure(0, 0)
```
- Exploration prompt: "Result: |0⟩. The algorithm says 'constant.' Now let's try a balanced oracle."

- Demo 2: Deutsch-Jozsa with a balanced oracle (CNOT — f(0)=0, f(1)=1).
```python
from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 1)

# Prepare
qc.x(1)
qc.h(0)
qc.h(1)

# Oracle: balanced (CNOT — f flips output when input is 1)
qc.cx(0, 1)

# Interfere
qc.h(0)
qc.measure(0, 0)
```
- Exploration prompt: "Result: |1⟩. The algorithm says 'balanced.' One query. A classical computer would need to check at least half the inputs plus one. For N=100 qubits, that's 2^99 + 1 classical queries vs 1 quantum query."

**PROVE:**
- Exercise: "Extend Deutsch-Jozsa to 3 qubits"
  - Task: "Build a 3-input-qubit Deutsch-Jozsa circuit with a balanced oracle. The oracle should apply CNOT from each input qubit to the output qubit. Measure all 3 input qubits — if all measure 0, the function is constant; any non-zero result means balanced."
  - Starter code: circuit scaffold with comments
  - Hints: ["You need 4 qubits total: 3 input + 1 output", "Apply H to all input qubits, X+H to the output qubit", "The balanced oracle: CNOT from qubit 0 to 3, CNOT from qubit 1 to 3, CNOT from qubit 2 to 3", "Apply H to all input qubits again, then measure them"]
  - Expected: at least one input qubit measures |1⟩
  - Success: "You've implemented your first quantum algorithm! Deutsch-Jozsa proves quantum computers can solve certain problems exponentially faster than classical computers. Next up: Grover's search algorithm, which speeds up database search."

**Dirac context:** "This is the capstone of Track 1. The student is implementing a real quantum algorithm. Key concepts to reinforce: (1) the oracle is a black box that encodes the function, (2) H gates before and after create the interference pattern, (3) phase kickback (from lesson 1.9) is what makes it work — the oracle kicks phase onto the input qubits, and the final H gates convert that into measurable bits. If the student gets the exercise right, make it feel like a big achievement — they just wrote a quantum algorithm from scratch."

---

### Track 2: Quantum Algorithms

| # | Lesson | Core Concept | Algorithm |
|---|--------|-------------|-----------|
| 2.1 | Classical vs Quantum Speedup | Complexity classes, oracle model | Overview — no implementation |
| 2.2 | Bernstein-Vazirani | Hidden string, Hadamard transform | Find the secret string with 1 query |
| 2.3 | Simon's Algorithm | Period finding in a function | Exponential speedup for period problems |
| 2.4 | Quantum Fourier Transform | Fourier basis, phase estimation | Build QFT from scratch |
| 2.5 | Grover's Search | Amplitude amplification, oracle marking | Search an unsorted list quadratically faster |
| 2.6 | Shor's Algorithm (Conceptual) | Period finding → factoring | Conceptual walkthrough — simplified demo |

### Track 3: Practical Quantum Programming

| # | Lesson | Core Concept | Practical Skill |
|---|--------|-------------|-----------------|
| 3.1 | Qiskit Deep Dive | Transpiler, backends, Qiskit patterns | Parameterized circuits, custom gates |
| 3.2 | Cirq and Other Frameworks | Cross-framework literacy | Same circuit in Qiskit, Cirq, CUDA-Q |
| 3.3 | Noise and Errors | Decoherence, gate fidelity | Noisy simulations, error mitigation |
| 3.4 | Running on Real Hardware | IBM Quantum, job submission | Submit a circuit to a real QPU |
| 3.5 | Variational Algorithms (VQE) | Hybrid classical-quantum, parameter optimization | VQE for molecular ground state |

---

## Video Library

Curated YouTube videos embedded at specific points in lessons. Each video has:

```typescript
interface VideoResource {
  youtubeId: string;
  title: string;
  creator: string;
  durationSeconds: number;
  startTime?: number;     // start at this timestamp (for clips)
  endTime?: number;       // stop at this timestamp
  relevantLessons: string[];  // which lesson IDs use this video
}
```

### Curated Channels/Creators:
- **3Blue1Brown** — visual math explainers (superposition, linear algebra foundations)
- **Veritasium** — "How Quantum Computers Work", "Quantum Entanglement Explained"
- **IBM Qiskit YouTube** — official Qiskit tutorials, "Coding with Qiskit" series
- **minutephysics** — short quantum explainers
- **Looking Glass Universe** — accessible quantum physics
- **Microsoft Research** — quantum computing lectures
- **Sabine Hossenfelder** — physics explainers with practical grounding

The specific video IDs will be curated manually — Dirac doesn't pick videos dynamically. Each lesson hardcodes which video(s) to show. Some video IDs are marked as placeholder above and need to be researched and filled in.

---

## Dirac as Adaptive Teacher

### How Dirac Guides Learning

Dirac doesn't just answer questions — it drives the learning experience. When the user enters Learn Mode:

1. **If first time**: Dirac introduces itself and asks a few questions:
   - "Have you programmed before?" (Yes/No/A little)
   - "Do you know any quantum physics or quantum computing?" (None/Basics/Some experience)
   - Based on answers, Dirac picks a starting lesson

2. **If returning**: Dirac checks the StudentModel and says:
   - "Welcome back! Last time you were learning about [topic]. Want to pick up where you left off, or try something new?"

3. **During a lesson**: Dirac's system prompt includes:
   - The current lesson's `diracContext` (teaching notes for this topic)
   - The student's skill level and mastered concepts from StudentModel
   - What the student is currently seeing (which content block is visible)
   - Dirac proactively comments on what the student is doing

4. **Between lessons**: Dirac recommends the next lesson based on:
   - Prerequisites met
   - Student's pace and difficulty preference
   - Concepts the student is struggling with (from error history)

5. **If the student is stuck**: Dirac detects inactivity (no code changes for 2+ minutes during an exercise) and offers help:
   - "Having trouble? Here's a hint..." (reveals next hint)
   - "Want me to walk you through this step by step?"

### Dirac's Teaching Modes (via system prompt)

Different system prompt addendums shape how Dirac teaches:

- **Absolute beginner**: "Explain everything from scratch. Use analogies to everyday objects. Never assume programming knowledge. Celebrate every small win."
- **Beginner (can code)**: "Assume basic Python knowledge. Focus on quantum concepts. Use code examples to explain."
- **Intermediate**: "Discuss matrix math when helpful. Suggest optimizations. Reference gate decompositions."
- **Advanced**: "Discuss error correction, hardware constraints, algorithm complexity. Be concise."

---

## Learn Mode UI Components

### Navigation

**Top bar in Learn Mode** (replaces editor tabs/breadcrumbs):
- Back arrow → return to Code Mode
- Current lesson title + track name
- Progress indicator (lesson 3 of 10, progress bar)
- "Next" / "Previous" lesson buttons

**Lesson scrolling**: Content blocks scroll vertically in the content area. Single continuous scroll, not paginated.

### Video Player Component — `src/components/learning/VideoPlayer.tsx`
- YouTube iframe embed with `enablejsapi=1` for control
- Dark chrome frame matching the theme
- Title + creator below
- Timestamp links in nearby text blocks can control the player
- Respects theme (dark surround even if video is bright)

### Interactive Demo Component — `src/components/learning/InteractiveDemo.tsx`
- Mini Monaco editor (smaller, ~200px height)
- Mini circuit diagram below (simplified, no export menu)
- Mini histogram (bar chart only, no controls)
- "Run" button, "Reset" button, "Open in Editor" button
- All self-contained — doesn't affect the main editor state

### Exercise Component — `src/components/learning/ExerciseBlock.tsx`
- Same mini editor as demo but with editable starter code
- "Check Solution" button validates against expected probabilities
- Hint revealer (click to show next hint, progressive)
- Success state: green border + check mark + "Next" prompt
- Failure state: specific feedback explaining what's wrong
- Dirac integration: auto-offers help after 2 min inactivity

### Concept Card Component — `src/components/learning/ConceptCard.tsx`
- Rounded card with subtle gradient background
- Animated visual (CSS or lightweight canvas):
  - "bloch": spinning Bloch sphere with labeled state
  - "circuit": animated circuit with gates appearing one by one
  - "histogram": bars growing from zero
- One paragraph of text
- "Ask Dirac" button

---

## State Management

### Learn Store — `src/stores/learnStore.ts`

```typescript
interface LearnState {
  // Mode
  isLearnMode: boolean;
  enterLearnMode: () => void;
  exitLearnMode: () => void;

  // Current position
  currentTrackId: string | null;
  currentLessonId: string | null;
  currentBlockIndex: number;

  // Progress
  completedLessons: string[];        // lesson IDs
  lessonProgress: Record<string, {   // per-lesson state
    startedAt: string;
    completedAt?: string;
    exercisesPassed: string[];
    quizScores: Record<string, number>;
    hintsUsed: number;
  }>;

  // Adaptive
  assessedLevel: 'absolute-beginner' | 'beginner' | 'intermediate' | 'advanced' | null;
  needsPythonTrack: boolean | null;

  // Actions
  setCurrentLesson: (trackId: string, lessonId: string) => void;
  completeLesson: (lessonId: string) => void;
  setAssessedLevel: (level: string) => void;
  setNeedsPythonTrack: (needs: boolean) => void;
}
```

Persisted via localStorage with PlatformBridge fallback.

---

## Implementation Priority

1. **Learn Mode shell** — the full-page view with content area + Dirac panel, activity bar switching
2. **Content block components** — text, video, demo, exercise, quiz, concept card
3. **Track 1 lesson data** — all 10 Fundamentals lessons written out with real content blocks, demo code, exercises, quiz questions (use this PRD as the source — every lesson is specified above)
4. **Dirac adaptive teaching** — level assessment, system prompt injection, proactive guidance
5. **Track 0 (Python basics)** — for absolute beginners
6. **Track 2 & 3** — algorithms and practical programming
7. **Progress tracking and persistence**
8. **YouTube video ID curation** — research and fill in real video IDs for all placeholder entries
