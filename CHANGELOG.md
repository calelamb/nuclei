# Changelog

All notable changes to Nuclei will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-04-18

### Added

- **Progressive-reveal layout.** Panels appear in response to code state. The circuit pane only shows up once the student has written at least one gate. Bloch sphere and a compact `|state⟩ %` histogram chip appear after a successful run. A new status-bar `Layout` dropdown lets experts pin `Clean` / `Balanced` / `Full` presets.
- **Ambient AI — narration.** Dirac automatically describes what your circuit is doing after every parse/run. One-liner narrations stream into the Dirac sidebar. Toggle in Settings → Dirac → `narration`.
- **Ambient AI — error rewrite.** When the kernel emits a Python traceback, Dirac replaces it with a concept-level explanation and (when possible) a one-click `Apply fix` button. Toggle in Settings → Dirac → `autoExplainErrors`.
- **Agentic Compose (⌘I).** Press ⌘I to open a quick-ask modal. "Create a 3-qubit GHZ state" → Sonnet writes the code → a diff preview overlays the editor → Enter applies, Esc rejects. Chat messages that look like code-generation intents route through the same flow automatically.
- **Zero-ceremony project management.** Any folder on disk is a valid Nuclei project — no config file required. Open a folder, get a live file tree, multiple tabs, per-tab dirty dots, inline rename (double-click), new-file button, and an unsaved-changes confirm when you close a tab. Last project + open tabs persist across sessions. Desktop only; web shows a "download desktop" nudge.
- **Prominent Run button + visible framework dropdown.** Moved out of the old 16 px status-bar chip and into a proper editor-tab toolbar with a ⌘↵ shortcut hint. Framework selector next to the file tab reads as a real dropdown; Qiskit / CUDA-Q options are marked "Desktop only" in the web build.

### Changed

- **Softer visual identity.** Radii, surfaces, and shadows tuned toward a Cursor-minimalist feel — more breathing room, less hard contrast.
- **Ghost completion default is now off** for beginners. Can be re-enabled via Settings → Dirac → `ghostCompletions`.
- **Histogram demoted.** No longer a full bottom-panel tab — renders as a compact chip below the Bloch sphere. Switch the layout preset to `Full` to restore the original bottom panel.

### Fixed

- **Browser IDE Cirq install.** Bumped `cirq-core` from 1.4.1 → 1.5.0 and loaded numpy before micropip resolution so the dependency graph resolves against Pyodide 0.27's bundled numpy 2.0.2 instead of trying to pull a pure-Python numpy 1.22 wheel that doesn't exist.
- **Editor null-guard** in the inline-edit widget for strict TypeScript builds.

## [0.1.3] - 2026-04-10

### Changed
- **App icon** — redesigned with a white background instead of navy. Same lucide-style atom glyph (three elliptical orbits, central nucleus) but now uses `#0891B2` teal on a white/off-white rounded-square tile, matching the IDE's light theme. Regenerated all sizes: `32x32`, `128x128`, `128x128@2x`, `icon.png` (1024), `icon.icns` (macOS iconset), `icon.ico` (Windows multi-size), Windows Store `Square*Logo` tiles, PWA `icon-192`/`icon-512`, and the landing page inline favicon.

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
