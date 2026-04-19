# Changelog

All notable changes to Nuclei will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.3] - 2026-04-18

### Fixed — Dirac AI paths now use real model IDs and surface real errors

- **Compose fixed.** The "I couldn't draft code for that" error was caused by an invalid Sonnet model ID (`claude-sonnet-4-6-20250514`) in `src/services/compose.ts`. Anthropic rejected the request with HTTP 400, and the compose service swallowed the error and returned `null`, leaving the UI with a generic "is your API key set?" message. The ID is now `claude-sonnet-4-6`, the authoritative current Sonnet 4.6 snapshot.
- **Single source of truth for model IDs.** `src/config/dirac.ts` is now the only place any surface defines a Claude model. Added `OPUS_MODEL = 'claude-opus-4-7'` for future reasoning-mode paths. Haiku stays on `claude-haiku-4-5-20251001`.
- **InlineEdit (⌘K) switched to the shared config.** It was hardcoded to the old Sonnet 4.5 snapshot and therefore would silently fail the same way compose did. Now imports `SONNET_MODEL` and `DIRAC_API_URL` from `config/dirac`.
- **Honest error propagation.** `compose()` now returns a `ComposeResult` envelope (`{ ok: true, code, explanation } | { ok: false, error }`). 4xx responses are unpacked (`body.error.message`) and shown verbatim to the user, so bad API keys, bad model IDs, rate limits, and billing issues read true instead of a catch-all "set your key in Settings" hint.
- **ComposeModal (⌘I) and Dirac chat compose-intent** updated to consume the new envelope and display the real reason.

Net effect: Dirac's agentic compose, inline edit, and chat paths all hit valid endpoints now, and when something still fails, you see why.

## [0.4.2] - 2026-04-18

### Fixed — **hardware submission is now real**

Previously the Launch modal would surface "queued" jobs that never actually talked to a provider. `addJob()` wrote a local record; no WebSocket `hardware_submit` was ever sent to the kernel. The Connect button did the same — flipped a UI bool without validating the token. This release wires the full path end-to-end.

- **Credentials are validated** against the provider's real API. Connect now sends `hardware_connect` to the kernel, which calls `provider.connect(credentials)`; only on a real successful handshake does the UI mark the provider as connected. On failure, an inline error explains why.
- **Launch is gated.** The Launch button is disabled for credential-required providers until the provider is actually connected. No more fake queued jobs from providers with no token.
- **Jobs are recorded only after the kernel confirms them** — `hardware_job_submitted` with a real job_id from the underlying SDK (Qiskit Runtime, qiskit-ionq, Braket, Azure Quantum, pytket-quantinuum, or CUDA-Q) is the moment the UI learns the job exists.
- **Live status polling.** Every 5 seconds while jobs are active, the frontend sends `hardware_status` for each, and transitions the UI through queued → running → complete based on the provider's real status. When a job completes, `hardware_results` is auto-fetched and the histogram chip sprouts a second (purple) bar for hardware outcomes.
- **Cancel button everywhere.** LaunchStrip gets a Cancel / Dismiss control. LaunchPortal active-jobs list gets a Cancel per row. Cancel for queued/running jobs calls `hardware_cancel` on the kernel, which invokes `provider.cancel_job(handle)` — IBM, IonQ, Braket, Azure, Quantinuum all support real cancel via their SDKs. Local simulators / NVIDIA complete synchronously so cancel is a no-op. For already-completed records, the button becomes "Dismiss" and just removes the row.
- **"Clear all"** in the Recent Results section of the LaunchPortal wipes all local job records.
- **Circuit extraction from code.** `hardware_submit` on the kernel side now exec's the student's code and extracts the circuit object (QuantumCircuit / cirq.Circuit / CUDA-Q kernel) before handing it to the provider adapter — previously the raw string was passed through and every provider would have errored on type mismatch.

Net effect: the submission flow is now a real pipeline from editor → kernel → provider SDK → queue → results, with honest status, real errors, and a working cancel path.

## [0.4.1] - 2026-04-18

### Added

- **Inline BYOK in the Launch modal.** When you pick a provider that needs credentials (IBM Quantum, IonQ, Quantinuum), a compact one-field input sits at the top of the backend picker: paste your token, press Enter or click Connect, continue to submission. No separate credential-setup modal interrupts the flow for the common case.
- **Drop-to-launch.** Dropping a file into the sidebar Launch Portal now auto-opens the Launch modal on the provider picker. One-step action: drop, pick, go.
- **"Submitting: filename" banner.** The Launch modal shows a subtle chip confirming exactly which file is about to be launched, so there's no ambiguity between the active tab and the staged file.
- **Aggregator sub-provider chips.** When AWS Braket or Azure Quantum is selected, a row of small chips ("IonQ / Rigetti / QuEra / …") above the backend list filters the backends to that sub-provider. Clarifies the "this is a bundle" model without forcing a full 3-act drill-down.

### Changed

- Closing the Launch modal now also clears the selected sub-provider, so the next open starts clean.

## [0.4.0] - 2026-04-18

### Added

- **Launch Portal sidebar view.** New rocket icon in the ActivityBar opens a dedicated submission surface. Drop a `.py` / `.qasm` / `.ipynb` file into the drop zone (or click to browse) and it opens as a temp buffer in the editor. A provider grid underneath lets you pick a destination — clicking a card opens the full Launch modal with that provider pre-selected. Active jobs and recent results render below the grid with live status.
- **AWS Braket provider** (`kernel/hardware/braket_provider.py`) — real implementation via `amazon-braket-sdk`. A single integration unlocks IonQ, Rigetti, QuEra, IQM, OQC, Pasqal, and D-Wave. Backends appear in the Launch modal labeled with their sub-provider.
- **Azure Quantum provider** (`kernel/hardware/azure_provider.py`) — real implementation via `azure-quantum`. Unlocks Quantinuum, IonQ-via-Azure, Rigetti-via-Azure, Pasqal, and IQM.
- **Quantinuum direct provider** (`kernel/hardware/quantinuum_provider.py`) — via `pytket-quantinuum`. Highest-fidelity trapped-ion hardware, H1 and H2 devices.
- **Xanadu + D-Wave cards** in the Launch modal marked honestly as "different circuit model" — photonic and annealer paradigms don't accept gate-model circuits yet, but the cards surface the providers so students know they exist.
- Provider logos for Braket, Azure, Quantinuum, Xanadu, and D-Wave — inline single-color SVG monograms, no emojis.

### Changed

- `HardwareProviderType` expanded to `'ibm' | 'google' | 'ionq' | 'nvidia' | 'braket' | 'azure' | 'quantinuum' | 'xanadu' | 'dwave' | 'simulator'`.
- Credential setup flow covers every new provider with field lists and help links.

## [0.3.0] - 2026-04-18

### Added

- **Launch modal (⌘⇧R).** A dedicated full-screen surface for submitting to real quantum hardware. Provider cards with inline SVG logos (IBM, IonQ, NVIDIA CUDA-Q, Local, Google "Coming Soon"), each with pricing chip (Free / Paid / Credits / Local), status indicator, and tagline. Click a card → live backend list with queue length, error rate, and qubit count per backend. Shot stepper + prominent Launch button.
- **Launch strip.** Thin status bar at the top of the editor that surfaces the latest hardware job in-flight — provider logo, backend name, status icon, elapsed time. Click to reopen the launch panel. Replaces the buried JobTracker list.
- **Hardware-aware histogram chip.** When a hardware job completes, the inline histogram chip renders dual bars per outcome — classical simulator in accent color, hardware in Dirac purple — so students can see "real quantum matches the simulator (mostly)" at a glance.
- **Prominent Launch button** in the editor toolbar next to Run. ⌘⇧R keyboard shortcut.
- **NVIDIA CUDA-Q provider** (`kernel/hardware/nvidia_provider.py`). Exposes `nvidia`, `nvidia-fp64`, `nvidia-mgpu`, and `qpp-cpu` as CUDA-Q simulation targets. Students can submit a circuit to real GPU silicon with no credentials required beyond having `cudaq` installed.
- **IonQ provider** (`kernel/hardware/ionq_provider.py`). Real implementation via `qiskit-ionq`. Connect with an API token, list live backends, submit_job via IonQ's sampler, poll results. Mirrors the shape of the existing IBM provider.

### Changed

- Google Quantum AI is now explicitly a "Coming Soon" card in the launch UI until the provider adapter lands.

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
