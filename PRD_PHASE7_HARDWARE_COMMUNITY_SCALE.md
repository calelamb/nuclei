# Nuclei — Phase 7 PRD: Real Hardware, Community & Scale

## Phase Goal

Close the loop from learning to building. Students who learned quantum computing in Nuclei can now run circuits on real quantum hardware, collaborate with others, share what they've built, and contribute back to the platform. Nuclei becomes the place where the quantum computing community grows.

## Timeline

Ongoing (post Phase 6, parallel workstreams)

## Prerequisites

Phases 1–6 complete: full IDE, AI editor, learning experience, polish.

---

## Workstream 1: Real Quantum Hardware Integration

### Objective

Run circuits on actual quantum processors (IBM Quantum, Google Quantum AI, IonQ, Amazon Braket) directly from Nuclei.

### Requirements

**Hardware Provider Abstraction — `kernel/hardware/`**

```python
class HardwareProvider(ABC):
    @abstractmethod
    def connect(self, credentials: dict) -> bool: pass

    @abstractmethod
    def list_backends(self) -> list[BackendInfo]: pass

    @abstractmethod
    def submit_job(self, circuit, backend: str, shots: int) -> JobHandle: pass

    @abstractmethod
    def get_results(self, job: JobHandle) -> SimulationResult: pass

    @abstractmethod
    def get_queue_position(self, job: JobHandle) -> int: pass
```

Supported Providers:
- IBM Quantum (via qiskit-ibm-runtime) — free tier available
- Google Quantum AI (via Cirq + Google Cloud)
- IonQ (via Amazon Braket or direct API)
- Simulator backends for each provider

**Hardware Panel — `src/components/hardware/`**
- Backend selector: dropdown showing available quantum processors
- For each backend: qubit count, connectivity map, queue length, error rates
- "Run on Hardware" button (separate from local "Run" which uses simulator)
- Job queue tracker: submitted jobs with status (queued → running → complete)
- Results comparison: side-by-side simulator vs. hardware results
- Connectivity map: visual graph showing which qubits are physically connected
- Auto-transpilation: Nuclei transpiles the circuit to match hardware constraints (gate set, connectivity)

**Credential Management**
- Secure storage for provider API tokens (Tauri encrypted storage)
- Setup wizard for each provider (guided by Dirac)
- Free tier guidance: Dirac helps students get IBM Quantum access (it's free)

**Dirac Hardware Awareness (via context injection)**
- Hardware metadata (backend name, qubit count, error rates, connectivity) injected into Claude API calls when hardware panel is active
- Claude explains differences between simulator and hardware results based on this context
- "Why are my results noisy?" → system prompt includes hardware specs, Claude explains decoherence and gate errors specific to that backend
- Backend recommendation: inject available backends as context, Claude suggests the best match for the circuit

### Acceptance Criteria
- [ ] IBM Quantum jobs submit and return results
- [ ] Backend selector shows available processors with specs
- [ ] Job queue tracker shows real-time status
- [ ] Side-by-side simulator vs. hardware comparison works
- [ ] Auto-transpilation adapts circuits to hardware constraints
- [ ] Dirac explains hardware noise meaningfully
- [ ] Credentials stored securely

---

## Workstream 2: Community & Social Features

### Objective

Nuclei users can share circuits, learn from each other, and build a community around quantum education.

### Requirements

**Circuit Gallery**
- Public gallery of circuits submitted by users: `nuclei.app/gallery`
- Each circuit has: title, description, author, framework, visualization preview, code
- Categories: Tutorials, Algorithms, Art (creative circuits), Challenges
- Like/bookmark system
- "Open in Nuclei" button — loads circuit into the editor (web or desktop)
- Featured circuits curated by the team

**User Profiles**
- Optional account creation (GitHub OAuth, email)
- Profile shows: circuits shared, exercises completed, learning paths finished, streak
- Badges for achievements:
  - "First Circuit" — ran your first simulation
  - "Bell Ringer" — built a Bell state
  - "Entangler" — mastered entanglement
  - "Algorithm Designer" — completed the algorithms learning path
  - "Hardware Hacker" — ran a circuit on real hardware
  - "Teacher" — shared a circuit that got 10+ likes
  - "Contributor" — submitted a plugin or exercise

**Discussion Threads**
- Each shared circuit has a discussion thread
- Markdown support in comments
- Claude API can be invoked in discussions (experimental): "Hey Dirac, explain this circuit" — server-side API call with the shared circuit as context
- Moderation tools for community health

**Challenge Board**
- Weekly quantum challenges posted by the team or community
- Leaderboard for challenge completion (time-based or optimization-based)
- Claude API calls with challenge context generate hints for participants
- Past challenges archived and browsable

### Acceptance Criteria
- [ ] Circuit gallery renders with previews and metadata
- [ ] "Open in Nuclei" loads circuits correctly
- [ ] User profiles show achievements and shared circuits
- [ ] Badge system awards achievements accurately
- [ ] Discussion threads work on shared circuits
- [ ] Weekly challenges post and track participation

---

## Workstream 3: Advanced Learning — From Student to Builder

### Objective

Bridge the gap between "I completed the tutorials" and "I can build real quantum applications." Nuclei guides students into real-world quantum computing.

### Requirements

**Capstone Projects**
- Multi-week guided projects that produce something real:
  1. **Quantum Random Number Generator** — build, test on hardware, analyze randomness
  2. **Quantum Key Distribution (BB84)** — simulate a secure communication protocol
  3. **Variational Quantum Eigensolver (VQE)** — find the ground state energy of a molecule
  4. **Quantum Machine Learning** — build a simple quantum classifier
  5. **Grover's Search on Real Hardware** — implement and run on IBM Quantum
- Each project has: overview, milestones, starter code, Dirac guidance, hardware integration
- Projects live in multi-file project mode (Phase 5)
- System prompt shifts to a "project mentor" persona for capstone projects (longer context, more Socratic questioning, less hand-holding)

**Quantum Concept Map**
- Interactive visual map of quantum computing concepts
- Nodes: concepts (qubit, superposition, entanglement, etc.)
- Edges: prerequisite relationships
- Color-coded by mastery: unstarted (gray), in-progress (teal), mastered (green)
- Click a node → see relevant exercises, learning path modules, and circuits
- Claude API call with concept map + student model context: "To understand Shor's algorithm, you need these concepts..."
- "What should I learn next?" → API call with student model + concept map, Claude recommends the optimal next node

**Research Paper Reader**
- Paste an arXiv link → Nuclei extracts the circuit diagrams and code
- Claude API call with extracted paper content → explains the algorithm at the student's level (from student model)
- "Implement this paper's circuit" → Claude API call with paper summary as context, uses insert_code tool to scaffold
- Saves to a "Papers" collection in the user's library

**Quantum Computing Glossary**
- Searchable glossary of quantum terms
- Each term has: plain-English definition, mathematical definition, Bloch sphere visualization (where applicable), code example
- Accessible from Cmd+Shift+P → "Define: [term]"
- Dirac links to glossary entries in its explanations

### Acceptance Criteria
- [ ] At least 3 capstone projects available with full guidance
- [ ] Concept map renders interactively with mastery colors
- [ ] "What should I learn next?" gives personalized recommendations
- [ ] Research paper link → extracted circuits and Dirac explanation
- [ ] Glossary is searchable with visual explanations
- [ ] Capstone projects produce working code that runs on hardware

---

## Workstream 4: Platform Maturity & Ecosystem

### Objective

Nuclei is stable, extensible, and self-sustaining as an open-source project.

### Requirements

**Plugin Marketplace**
- Browsable marketplace within Nuclei: `nuclei.app/plugins`
- Categories: Visualizations, Hardware Providers, Learning Content, Themes, Integrations
- Install with one click
- Star ratings and reviews
- Developer documentation and SDK
- Featured plugins curated by the team

**Educator Tools**
- Classroom mode: teacher creates a "classroom" with enrolled students
- Teacher dashboard: see student progress across exercises and learning paths
- Assignment creation: teacher sets exercises with deadlines
- No student data shared publicly — teacher sees only their classroom
- Export progress reports (CSV or PDF)
- LMS integration hooks (Canvas, Moodle) via plugin

**Localization (i18n)**
- UI translatable to multiple languages
- Dirac can respond in the student's language (Claude supports this natively)
- Community-contributed translations
- Priority languages: English, Spanish, Mandarin, Hindi, Portuguese, Japanese

**Telemetry (Opt-in)**
- Anonymous usage analytics to improve the product
- Metrics: feature usage, exercise completion rates, common errors, Dirac interaction patterns
- Strictly opt-in with clear privacy explanation
- No personal data collected — only aggregate patterns
- Public dashboard showing anonymized community stats ("10,000 circuits run this week")

**CI/CD & Release**
- Automated builds: macOS (.dmg), Windows (.msi), Linux (.AppImage)
- Auto-updater with release notes
- Beta channel for early adopters
- Nightly builds for contributors
- Comprehensive test suite: unit, integration, E2E (Playwright)

### Acceptance Criteria
- [ ] Plugin marketplace is browsable and searchable
- [ ] One-click plugin install works
- [ ] Classroom mode supports teacher + student workflow
- [ ] Assignment creation and progress tracking works
- [ ] At least 2 language translations available
- [ ] Opt-in telemetry collects anonymous usage data
- [ ] Automated builds produce installers for macOS, Windows, Linux
- [ ] Auto-updater works for desktop app

---

## Phase 7 Definition of Done

When Phase 7 is complete, Nuclei is a full platform:
1. Students run circuits on real IBM/Google quantum processors from within Nuclei
2. A community shares circuits, discusses quantum computing, and tackles weekly challenges
3. Learners graduate from tutorials to real capstone projects
4. Educators use Nuclei in classrooms with progress tracking
5. The plugin ecosystem enables community-driven extension
6. Nuclei runs on macOS, Windows, Linux, and the web
7. The project is self-sustaining as open-source with automated releases

## The Full Journey

After all seven phases, Nuclei enables this story:

> A student who has never heard of quantum computing downloads Nuclei. In their first 30 minutes, they learn what a qubit is, build a Bell state, and watch it simulate. Over the next few weeks, Dirac guides them through superposition, entanglement, and basic algorithms — adapting to their pace and style. They start writing code with ghost completions helping them along, use Cmd+K to refactor circuits, and step through algorithms gate-by-gate to truly understand them. They complete capstone projects, run circuits on real IBM quantum hardware, and share their work in the community gallery. They earn badges, help other learners in discussions, and eventually contribute a plugin. They went from zero to building real quantum applications — all inside Nuclei.

That's the product.
