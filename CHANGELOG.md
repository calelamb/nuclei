# Changelog

All notable changes to Nuclei will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-04-10

### Fixed
- **Web IDE blank screen** — Monaco editor (loaded from jsDelivr CDN) was pulling version 0.55.1 which throws `Illegal value for lineNumber` on init. Pinned to 0.52.2, the last confirmed stable release compatible with `@monaco-editor/react` 4.7.x. The web version now renders the full IDE (editor, circuit, Bloch sphere, Dirac panel, terminal).
- **React crash isolation** — added a reusable `ErrorBoundary` component and wrapped `QuantumEditor` with it in `PanelLayout`, so any future editor-level error falls back to a recoverable "Retry" panel instead of taking down the whole app.
- **Defensive line-number guards** — `QuantumEditor` now clamps kernel error line numbers to the current `model.getLineCount()` before calling `setModelMarkers`, and `ghostCompletions.provideInlineCompletions` returns empty when `position.lineNumber` is out of range, eliminating a second potential path to the `Illegal value for lineNumber` crash.

### Changed
- **macOS builds are now signed AND notarized** — re-enabled `APPLE_ID` and `APPLE_PASSWORD` env vars in the release workflow. Apple's notary service recovered from the 10-hour backlog that blocked v0.1.1. New `.dmg` downloads open without any Gatekeeper warning.

## [0.1.1] - 2026-04-10

### Added
- New atom-style app icon (lucide-inspired) on a navy rounded-square background
- macOS Gatekeeper bypass instructions in README and landing page
- Basic Vitest setup with editorStore smoke tests
- `.github/pull_request_template.md`
- `src/config/kernel.ts` — WebSocket port now configurable via `VITE_KERNEL_PORT`

### Changed
- Landing page reworked to light theme matching the IDE light mode
- Landing hero and bento cards now use the IDE light theme palette
- Reveal animations now JS-opt-in so content is visible without JavaScript
- Moved internal PRD and planning docs to `docs/internal/`
- Replaced PWA favicon and icons with new atom design

### Fixed
- Removed all `console.log/warn/error` from production code (dev-gated where needed)
- Fixed pre-existing type error in `QuantumEditor.tsx`
- Fixed misleading claims about Rust and Python test suites in README/CONTRIBUTING

## [0.1.0] - 2026-04-09

### Added
- Monaco code editor with quantum-aware syntax highlighting and autocomplete
- Live circuit visualization powered by D3.js (renders as you type)
- Interactive 3D Bloch sphere with Three.js
- Probability histogram display after simulation
- Dirac AI assistant powered by Claude (BYOK -- bring your own Anthropic API key)
- Ghost completions and inline AI edit (Cmd+K)
- Qiskit framework support with AerSimulator
- Cirq framework support with cirq.Simulator
- CUDA-Q framework support (requires NVIDIA GPU)
- IBM Quantum hardware backend integration
- Dark and light themes
- Keyboard shortcuts and command palette (Cmd+Shift+P)
- 17 structured learning tracks (Python basics through quantum history)
- Interactive exercises with AI-powered verification
- Capstone projects
- Challenge mode with community submissions
- Quantum gate explorer and glossary
- Step-through circuit debugging
- Web version via Pyodide (no local Python required)
- Platform abstraction layer (desktop via Tauri, browser via Pyodide)
- File operations (open, save, save-as)
- Beginner / Intermediate / Advanced UI complexity modes
- Internationalization support
