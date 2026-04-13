# Nuclei Launch Posts

## Twitter/X Post

I built an IDE for learning quantum computing — and I'm giving it away for free.

Nuclei has a code editor, live circuit visualization, Bloch sphere, probability histograms, and an AI tutor named Dirac (powered by Claude) that teaches you quantum concepts as you code.

Write Qiskit, Cirq, or CUDA-Q. See your circuits render in real time. Run simulations. Learn from scratch — no physics degree needed.

It's open source. Try it now:
https://getnuclei.dev
https://github.com/calelamb/nuclei

---

## Reddit Post (r/quantumcomputing)

**Title:** I built a free, open-source IDE for learning quantum computing — Nuclei

**Body:**

Hey everyone — I've been working on Nuclei, a desktop IDE purpose-built for quantum computing. It's free, open source, and designed to make quantum accessible to people who are just getting started.

**What it does:**

- Monaco code editor with Qiskit, Cirq, and CUDA-Q support
- Live circuit visualization — your circuit diagram updates as you type
- Interactive Bloch sphere (3D, draggable) showing qubit states
- Probability histograms from simulations
- Built-in AI tutor called Dirac (Claude API) that explains quantum concepts, helps debug your code, and walks you through exercises
- Structured learning track that takes you from "what's a qubit?" to implementing Deutsch-Jozsa — all inside the IDE, with embedded videos, interactive demos, and exercises

**The idea:** You shouldn't have to bounce between YouTube, a textbook, and a Jupyter notebook to learn quantum. Nuclei puts the lesson, the code editor, the visualization, and the AI tutor on the same screen.

**Tech:** Tauri 2 (Rust) + React + TypeScript + Python kernel. ~10MB binary. Runs locally, your code never leaves your machine.

Try it: https://getnuclei.dev
Source: https://github.com/calelamb/nuclei

I'd love feedback — especially from people who've tried learning quantum and hit walls. What would have helped you?

---

## Reddit Post (r/programming)

**Title:** Nuclei — an open-source IDE for quantum computing with live circuit visualization and an AI tutor

**Body:**

I built Nuclei, a free desktop IDE for quantum computing. Think VS Code meets quantum circuit simulator meets AI tutor.

The core loop: you write quantum code (Qiskit/Cirq/CUDA-Q), the circuit diagram renders live as you type, you hit Cmd+Enter to simulate, and results show up as probability histograms and Bloch sphere visualizations. There's also an AI assistant called Dirac (Claude API wrapper) that can explain your circuit, fix errors, and teach quantum concepts from scratch.

Stack: Tauri 2.x (Rust shell, ~10MB binary), React 19 + TypeScript frontend, Python kernel over WebSocket, Monaco editor, Three.js for the Bloch sphere, D3/Recharts for visualizations.

It's MIT licensed and the web version is live at https://getnuclei.dev. Desktop builds (macOS/Windows/Linux) available on GitHub: https://github.com/calelamb/nuclei

Would appreciate any feedback on the architecture or UX. PRs welcome.
