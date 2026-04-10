# Nuclei — Phase 4 PRD: Web Version & Community

## Phase Goal

Bring Nuclei to the browser so anyone can use it without installing anything, add structured learning paths, enable circuit sharing, and lay the groundwork for a community and plugin ecosystem. This phase transitions Nuclei from a desktop tool to a platform.

## Timeline

Post-launch (ongoing, 4 workstreams that can run in parallel)

## Prerequisites

Phase 3 complete: full Dirac integration with tool use, exercises, gate explorer, onboarding.

---

## Workstream 1: Browser Version

### Objective

Nuclei runs in a web browser with near feature-parity to the desktop app, minus native file system access.

### Requirements

**Architecture Changes**

The desktop app uses Tauri (Rust) for process management, file I/O, and kernel spawning. The web version needs replacements:

| Desktop (Tauri) | Web Replacement |
|-----------------|-----------------|
| Local Python kernel process | Cloud-hosted kernel service OR Pyodide (in-browser Python) |
| Native file dialogs | Browser File System Access API + cloud storage |
| Tauri IPC commands | Direct function calls / REST API |
| Tauri encrypted storage | localStorage (non-sensitive) + server-side (API keys) |
| .dmg distribution | URL — just open the browser |

**Cloud Kernel Option**
- Lightweight backend service (Node.js or Python FastAPI) that:
  - Accepts WebSocket connections from the browser frontend
  - Spawns sandboxed Python execution environments per user session
  - Runs Qiskit/Cirq simulations and returns results
  - Auto-terminates idle sessions after 15 minutes
  - Rate limiting to prevent abuse
- Consider using containerized execution (Docker) for isolation
- Alternative: Pyodide (Python in WebAssembly) for client-side execution — limited but zero-infrastructure

**Pyodide Path (Recommended for MVP)**
- Run Python entirely in the browser via WebAssembly
- Qiskit has partial Pyodide support — validate which features work
- Cirq is lighter and more likely to work in Pyodide
- Tradeoffs: slower simulation, limited package support, but zero server costs
- Can progressively enhance with cloud kernel for heavy simulations

**Shared Frontend**
- The React frontend should be buildable for both Tauri and web targets
- Abstract all Tauri-specific calls behind an interface:
  ```typescript
  interface PlatformBridge {
    startKernel(): Promise<void>;
    stopKernel(): Promise<void>;
    openFile(): Promise<{ path: string; content: string }>;
    saveFile(path: string, content: string): Promise<void>;
    getStoredValue(key: string): Promise<string | null>;
    setStoredValue(key: string, value: string): Promise<void>;
  }
  ```
- `TauriBridge` implementation for desktop
- `WebBridge` implementation for browser
- Inject via React context or Zustand

**Web-Specific Features**
- URL-based circuit sharing: `nuclei.app/circuit/abc123` loads a shared circuit
- No install required — just navigate to the URL
- Service worker for offline support (cache the app shell)
- Progressive Web App (PWA) manifest for "Add to Home Screen"

**What's NOT in the Web Version (initially)**
- Native file system access (use download/upload instead)
- CUDA-Q support (requires native GPU)
- Auto-updater (it's a website)

### Acceptance Criteria
- [ ] Nuclei loads in Chrome/Firefox/Safari and renders the full IDE
- [ ] Code editing works with Monaco editor in the browser
- [ ] Python code executes (via Pyodide or cloud kernel)
- [ ] Circuit diagram, histogram render correctly
- [ ] Bloch sphere renders (Three.js works in browsers natively)
- [ ] Dirac works in the browser (API key stored in browser)
- [ ] Shared circuit URLs load correctly
- [ ] Desktop and web share >90% of the frontend codebase

---

## Workstream 2: Learning Paths & Curriculum

### Objective

Structured learning paths guide students through quantum computing concepts, building on the exercise system from Phase 3.

### Requirements

**Learning Path Structure**
- A learning path is an ordered sequence of modules
- Each module contains:
  - Concept introduction (Dirac explains with visuals)
  - Interactive demo (pre-built circuit that students can modify)
  - Exercises (from the Phase 3 exercise system)
  - Quiz questions (multiple choice, verified by Dirac)
  - Capstone challenge (open-ended problem)

**Built-in Learning Paths**

Path 1: Quantum Computing Fundamentals
1. What is a qubit? (Bloch sphere intro)
2. Quantum gates (H, X, Y, Z — one at a time)
3. Superposition (H gate, measurement, probability)
4. Multi-qubit systems (tensor products, 2-qubit states)
5. Entanglement (CNOT, Bell states)
6. Measurement and collapse
7. Quantum teleportation (capstone)

Path 2: Quantum Algorithms
1. Classical vs. quantum parallelism
2. Deutsch-Jozsa algorithm
3. Bernstein-Vazirani algorithm
4. Simon's algorithm
5. Quantum Fourier Transform
6. Grover's search algorithm (capstone)
7. Shor's algorithm (conceptual overview)

Path 3: Practical Quantum Programming
1. Framework deep-dive (Qiskit OR Cirq)
2. Building circuits programmatically
3. Parameterized circuits
4. Noise and error mitigation (conceptual)
5. Running on real hardware (IBM Quantum / Google)
6. Variational algorithms (VQE intro)
7. Final project: solve a real optimization problem

**Progress Tracking**
- Per-path progress (modules completed, exercises passed)
- Achievement badges for milestones
- Streak tracking (days of consecutive practice)
- All progress stored locally (desktop) or in user account (web)

**Dirac as Instructor (system prompt per module)**
- Each learning module has a module-specific system prompt addendum injected into the Claude API call
- At the start of each module, the API call includes intro context — Claude introduces the concept conversationally
- "Stuck" detection is client-side logic (no code changes in N minutes, repeated errors) — triggers a Claude API call with hint context
- End-of-module: API call with "Summarize what the student learned" + module content as context

**Learning Path UI**
- Sidebar or dedicated view showing path progress
- Module cards with completion status
- "Continue where you left off" on app launch
- Difficulty indicator per module

### Acceptance Criteria
- [ ] At least 2 complete learning paths with all modules
- [ ] Each module has concept intro, demo, exercises, and quiz
- [ ] Progress tracks across sessions
- [ ] Dirac adapts its teaching per module context
- [ ] "Continue where you left off" works on app launch
- [ ] Learning path UI is intuitive and visually polished

---

## Workstream 3: Circuit Sharing & Export

### Objective

Users can share their circuits as URLs, images, or QASM exports, and import circuits from others.

### Requirements

**Circuit Export Formats**
- OpenQASM 3.0 (text export/import)
- Circuit diagram as SVG (vector, high quality)
- Circuit diagram as PNG (raster, for slides/docs)
- Qiskit/Cirq code snippet (copyable)
- JSON snapshot (Nuclei's internal format, for reimport)

**Share as URL (Web Version)**
- Generate a shareable URL containing the circuit data
- Short URL format: `nuclei.app/c/abc123`
- Circuit data stored in a lightweight backend (or encoded in URL for small circuits)
- Shared circuits open in a read-only view with a "Fork to Editor" button
- Social preview: Open Graph meta tags with circuit diagram thumbnail

**Share as Image**
- "Export" button on the circuit diagram panel
- Options: SVG, PNG (1x, 2x resolution)
- Include optional title/watermark
- Copy to clipboard option

**Import**
- Drag-and-drop a .py or .qasm file onto the editor
- Paste QASM code → auto-detect and convert
- Import from URL

**Embed**
- Generate an iframe embed code for blog posts / course materials
- Embed shows the circuit diagram with optional interactivity
- `<iframe src="nuclei.app/embed/abc123" width="600" height="300"></iframe>`

### Acceptance Criteria
- [ ] Export circuit as OpenQASM 3.0
- [ ] Export circuit diagram as SVG and PNG
- [ ] Share URL generates and loads correctly
- [ ] Social preview shows circuit thumbnail
- [ ] Drag-and-drop import works for .py and .qasm files
- [ ] Embed iframe renders circuit correctly
- [ ] Copy code snippet to clipboard works

---

## Workstream 4: Plugin System & Community Foundation

### Objective

Third-party developers can extend Nuclei with custom gates, visualizations, and integrations. Lay the groundwork for a community.

### Requirements

**Plugin Architecture**
- Plugin manifest format (JSON):
  ```json
  {
    "name": "my-plugin",
    "version": "1.0.0",
    "description": "Adds custom noise visualization",
    "author": "...",
    "entry": "index.js",
    "capabilities": ["custom-panel", "gate-renderer", "kernel-extension"],
    "permissions": ["read-circuit", "read-results"]
  }
  ```
- Plugin types:
  - **Custom panels**: add new visualization panels (e.g., noise map, state tomography)
  - **Gate renderers**: custom SVG rendering for specialized gates
  - **Kernel extensions**: additional Python packages/adapters
  - **Dirac skills**: extend Dirac's capabilities by adding system prompt fragments and tool definitions that get injected into Claude API calls
  - **Themes**: community-created color schemes

**Plugin API**
- Sandboxed JavaScript API exposed to plugins:
  - Read circuit snapshot (subscribe to updates)
  - Read simulation results
  - Read editor content
  - Register custom panel
  - Register custom gate renderer
  - Extend Dirac (register additional tool definitions and system prompt fragments that get injected into Claude API calls)
- Plugins cannot: access file system, make network requests (without permission), modify other plugins

**Plugin Distribution**
- GitHub-based: plugins are Git repos with a manifest
- Install via URL: `nuclei install https://github.com/user/nuclei-plugin-noise`
- Plugin manager UI in settings
- Auto-update check for installed plugins

**Community Foundation**
- GitHub Discussions for community Q&A
- Contributing guide for plugin developers
- Plugin showcase page on the website
- Circuit gallery: curated collection of interesting circuits with explanations

**Python Bundling (conda-pack)**
- Bundle Python + Qiskit + Cirq into the .dmg so users don't need Python installed
- Use conda-pack to create a self-contained Python environment
- First-launch extracts the bundled environment
- Reduces setup friction from "install 5 things" to "download and open"
- Environment size target: <500MB

### Acceptance Criteria
- [ ] Plugin manifest format is defined and documented
- [ ] At least one example plugin (custom panel) works end-to-end
- [ ] Plugin manager UI lists installed plugins with enable/disable
- [ ] Plugin API provides read access to circuit and results
- [ ] Sandboxing prevents plugins from accessing unauthorized resources
- [ ] Python bundling eliminates the need for users to install Python separately
- [ ] Contributing guide published
- [ ] GitHub Discussions enabled and seeded with starter topics

---

## Phase 4 Definition of Done

When Phase 4 is complete, Nuclei is a platform:
1. Anyone can use Nuclei in a browser without installing anything
2. Students can follow structured learning paths from qubits to algorithms
3. Circuits can be shared as URLs, images, or QASM
4. Developers can extend Nuclei with plugins
5. The .dmg download works without any prerequisites (Python bundled)
6. A community exists around the project

## Dependencies & Assumptions

- Phase 3 complete and stable
- Web hosting infrastructure available (for web version + sharing backend)
- Pyodide supports sufficient Qiskit/Cirq features for the web version
- Community interest exists (validated by GitHub stars, feedback)
- conda-pack works for the target Python packages and macOS

## Non-Goals for Phase 4
- Paid features or monetization (this is free and open-source)
- Real quantum hardware integration (could be a plugin)
- Mobile native app (web version works on mobile browsers)
- Multi-user collaboration in real-time (future consideration)

---

## Cross-Phase Architecture Note

To support the web version, the **platform abstraction** (`PlatformBridge` interface) should be introduced early — ideally refactored in during Phase 2. This avoids a painful rewrite later. The bridge pattern keeps all Tauri-specific code isolated behind a clean interface that the web implementation can swap out.
