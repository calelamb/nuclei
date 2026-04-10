# Nuclei

**The IDE for learning quantum computing.**

Nuclei is a free, open-source desktop IDE purpose-built for students taking their first quantum computing course. Write quantum code in a full-featured editor, see your circuits render in real time, explore qubit states on an interactive Bloch sphere, and get help from an AI tutor that understands your code.

Download from [GitHub Releases](https://github.com/calelamb/nuclei/releases) or try the [web version](https://nuclei.dev).

---

## Features

**Monaco Code Editor** -- The same editor engine that powers VS Code, configured with quantum-aware syntax highlighting, autocomplete, and inline AI assistance for Qiskit, Cirq, and CUDA-Q.

**Live Circuit Visualization** -- Circuits render as you type. The D3.js-powered SVG diagram updates on every keystroke (300ms debounce), so you always see the circuit your code describes without running anything.

**Interactive Bloch Sphere** -- A Three.js 3D Bloch sphere visualizes single-qubit states after simulation. Rotate, zoom, and inspect qubit state vectors in real time.

**Probability Histograms** -- After execution, measurement probabilities are displayed as clear bar charts so you can immediately see the output distribution of your circuit.

**Dirac AI Assistant** -- A Claude-powered tutor named Dirac that sees your code, circuit, and simulation results. Dirac explains concepts at a beginner level, diagnoses errors in plain English, generates exercises, and can insert code or run simulations on your behalf.

**Multi-Framework Support** -- Write in Qiskit, Cirq, or CUDA-Q. Nuclei auto-detects the framework from your imports and handles the rest. Switch frameworks without changing your workflow.

---

## Quick Start

### Download

Grab the latest release for your platform:

- **macOS**: `.dmg` from [GitHub Releases](https://github.com/calelamb/nuclei/releases)
- **Windows**: `.msi` installer from [GitHub Releases](https://github.com/calelamb/nuclei/releases)
- **Linux**: `.AppImage` or `.deb` from [GitHub Releases](https://github.com/calelamb/nuclei/releases)

### Web Version

No installation required. Try Nuclei in your browser at [nuclei.dev](https://nuclei.dev). The web version uses Pyodide to run Python entirely client-side.

---

## Dirac AI Setup

Dirac uses the Anthropic API (Claude) and requires your own API key.

1. Create an account at [console.anthropic.com](https://console.anthropic.com/)
2. Generate an API key under **API Keys**
3. In Nuclei, open **Settings** and paste your key into the Anthropic API Key field

Without a key, the editor, circuit visualization, Bloch sphere, and histograms all work normally. Only Dirac AI features are disabled.

---

## Development Setup

### Prerequisites

- **Node.js** 20+
- **Rust** (latest stable, via [rustup](https://rustup.rs/))
- **Python** 3.10+ with pip
- **Tauri CLI**: `cargo install tauri-cli`

### Clone and Run

```bash
git clone https://github.com/calelamb/nuclei.git
cd nuclei

# Install frontend dependencies
npm install

# Install Python kernel dependencies
pip install -r kernel/requirements.txt

# Copy environment file and add your API key (optional)
cp .env.example .env

# Start the development server with hot reload
npm run tauri dev
```

### Other Commands

```bash
npm run tauri build        # Build distributable for your platform
npm test                   # Frontend tests (Vitest)
```

> **Note:** Rust backend tests (`cargo test`) and Python kernel tests (`pytest`) are planned. See the [issues tracker](https://github.com/calelamb/nuclei/issues) for progress. Contributions welcome!

---

## Architecture

Nuclei is a three-layer application:

| Layer | Technology | Role |
|-------|-----------|------|
| Desktop Shell | Tauri 2.x (Rust) | Process management, file I/O, IPC, native menus |
| Frontend | React 19 + TypeScript | Editor, visualizations, Dirac chat, panel layout |
| Python Kernel | WebSocket subprocess | Code execution, framework adapters, simulation |

The frontend sends code to the Python kernel over a WebSocket. The kernel parses the code, detects the quantum framework, extracts a `CircuitSnapshot` for live visualization, and runs full simulations on demand (Cmd+Enter / Ctrl+Enter).

For detailed architecture documentation, see [CLAUDE.md](CLAUDE.md).

---

## Supported Frameworks

| Framework | Provider | What It Provides |
|-----------|----------|-----------------|
| **Qiskit** | IBM | General-purpose quantum SDK with broad gate support and AerSimulator |
| **Cirq** | Google | Fine-grained circuit control, native noise modeling |
| **CUDA-Q** | NVIDIA | GPU-accelerated quantum simulation, hybrid quantum-classical workflows |

Nuclei auto-detects which framework you are using by analyzing your import statements. All three frameworks produce the same universal `CircuitSnapshot` format, so visualizations work identically regardless of your choice.

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style guidelines, and the pull request process.

---

## License

[MIT](LICENSE) -- Copyright 2026 Cale Lamb
