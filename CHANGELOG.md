# Changelog

All notable changes to Nuclei will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.16] - 2026-04-20

### Fixed — managed venv auto-rebuilds from Python 3.10+

v0.4.14 and v0.4.15 landed the kernel bundle and the core-dep
install, but users whose managed venv had been created from Python
3.9 (Xcode's default `python3` on many Macs) still saw "loading
kernel..." forever — the kernel code uses PEP 604 union syntax
(`str | None`) in class bodies, which crashes at import time under
3.9 with `TypeError: unsupported operand type(s) for |: 'type' and
'NoneType'`. v0.4.15 exposed the traceback via stderr piping; this
release actually resolves it.

- New `find_best_python` probes candidates in newest-first order
  (`python3.13`, `python3.12`, ... `python3.10`, then generic
  `python3` / `python`) and only returns interpreters that are
  >= 3.10. A box with both 3.9 and 3.12 now always picks 3.12.
- `ensure_kernel_runtime` now checks the venv's Python version at
  every kernel spawn. Venvs built from < 3.10 are automatically
  rebuilt with a newer interpreter, with the user's previously-
  installed frameworks (Qiskit, Cirq, etc.) re-installed from the
  catalog so the setup wizard doesn't have to be re-run. The old
  venv is moved aside to `venv.broken` during the rebuild and
  removed on success.
- Fresh venv creation also requires 3.10+. If no suitable Python
  is found on PATH, the user gets a clear "install Python 3.10+
  from python.org" error instead of a silently-broken kernel.

### Changed — Dirac no longer uses emojis

Prompt tweak: Dirac's system prompt now explicitly forbids emojis
and decorative unicode (✨ 🎉 🚀 etc.) in chat responses. Inline
code, braket notation (|0⟩, |ψ⟩), and bullet lists stay because
they carry meaning. Also discourages the "Great question!"
preamble pattern so replies get to the point faster.

## [0.4.15] - 2026-04-20

### Fixed — kernel hung at "loading" after v0.4.14 update

v0.4.14 started bundling `kernel/` in the release (good) but the
Nuclei-managed venv was never installing the kernel's own runtime
deps — `websockets`, `numpy`, `keyring`. The framework wizard in
v0.4.7 taught the venv to install user-selected frameworks (Qiskit,
Cirq, etc.), but it never installed the kernel's core imports. On
v0.4.14 (the first release where the kernel actually launches from
that venv), Python died immediately on `import websockets` and the
frontend stared at a "loading kernel..." spinner forever.

- New `ensure_kernel_runtime` hook creates the venv if missing and
  installs `websockets`, `numpy`, `keyring` when they're not
  already there. Fast-checked via a `python -c 'import ...'` probe
  so the hot path is a ~50ms no-op when everything's satisfied.
  Called by the kernel spawn path every launch.
- Kernel stdout/stderr are now piped into the Rust logger. Prior
  releases left both handles piped but never read them, so Python
  crashes (like this one) left no breadcrumbs — just a defunct PID
  and a frontend reconnecting to a dead WebSocket forever. The
  next mystery kernel crash will leave a trail in `nuclei.log`.

## [0.4.14] - 2026-04-19

### Fixed — kernel is now actually shipped in the release bundle

Every release prior to this one built the `.dmg` / `.msi` / `.deb`
without the `kernel/` Python source inside it (no `resources` entry
in `tauri.conf.json`). The packaged app silently relied on whatever
stale kernel process happened to be running on the user's machine —
typically a zombie from an earlier install still holding port 9742.

Symptom users saw: `Error: Unknown message type:
hardware_connected_providers` (and similar for `hardware_list_jobs`),
because the zombie kernel was running pre-v0.4.12 server code and
didn't know about handlers added in v0.4.12 / v0.4.13.

- `tauri.conf.json` gains `resources: {"../kernel": "kernel"}` so
  the full kernel source ships inside every bundle at
  `<resource_dir>/kernel/`. The Rust kernel spawner in
  `src-tauri/src/commands/kernel.rs` was updated in tandem to read
  from `resource_dir.join("kernel")` rather than `resource_dir
  .parent()` (which was always wrong in production — the parent is
  `Contents/` on macOS and doesn't contain our source).
- Before spawning a new kernel, Rust now kills whatever is currently
  holding port 9742 (`lsof -ti :9742 | xargs kill -9` on unix,
  `netstat | taskkill` on windows). Best-effort — no-ops cleanly
  if the port is free — and eliminates the "first zombie wins"
  class of bug.

### Fixed — .py files greyed out in the macOS open dialog

The single `extensions: ['py']` filter on `openFile` was routed
through Cocoa's `NSOpenPanel.allowedFileTypes`, which greyed out any
file whose UTI didn't resolve to `public.python-script` — common on
freshly-imaged machines, for files with mis-tagged metadata, or for
Python files with uppercase extensions.

- `openFile` now offers a broader default group (`py`, `qasm`,
  `ipynb`, `json`, `txt`, `md`) plus an "All Files" fallback.
  macOS renders these as a dropdown at the bottom of the open
  panel, so users who still see their file greyed out can switch
  to "All Files" and select it.
- `saveFileAs` gained the same "All Files" fallback so you can
  name a destination with a non-default extension without the
  picker fighting you.

## [0.4.13] - 2026-04-19

### Added — Open Files section in the sidebar

Open editor tabs now show at the top of the Explorer sidebar. Clicking
a row switches to that tab; the hover-reveal X closes it; a dirty-dot
shows unsaved changes. The section is collapsible, shows the tab count
in the header, and self-hides when nothing is open. Pinned above the
file tree's scroll container so deep trees don't push it off-screen.

### Fixed — File > Open now registers a tab

File > Open loaded a file into the editor but never called
`projectStore.openTab`, so opening a second file orphaned the first
with no way to switch back from the sidebar. It now flows through
the same tab machinery as every other open path, so both the top
EditorTabs bar and the new sidebar section light up correctly.

## [0.4.12] - 2026-04-19

### Added — Terminal polish

Toolbar with clear, copy-all, auto-scroll toggle, timestamps toggle,
client-side filter, live line count. Typed terminal lines (stdout /
stderr / separator / info) render distinctly — stderr is italic and
red, separators dim, tracebacks-via-stdout highlighted. ANSI escape
codes stripped at the store layer. Execution separators
(`─── Run at HH:MM:SS ──────`) delimit multiple runs instead of
clearing history on each Cmd+Enter. New ⌘\` keyboard shortcut
toggles the bottom panel with focus on terminal. Kernel now emits
stderr as a separate WebSocket message type, captured and styled
independently from stdout.

### Added — Hardware pipeline hardening

- Mock-based test suite for all seven provider adapters (IBM, IonQ,
  Braket, Azure, Quantinuum, NVIDIA, Simulator) + the hardware
  manager — 104 tests, no network calls, runs in under 200ms. Gated
  in CI via a new kernel-tests workflow so future SDK upgrades that
  break provider integrations are caught on the PR, not weeks later
  when a user reports a broken submission.
- Quantinuum auto-converts Qiskit and Cirq circuits via
  pytket-extensions (or returns a clear install hint).
- Azure handles `workspace.get_targets(name=...)` returning None,
  empty list, multi-match list, or single Target.
- Braket surfaces ARN-not-found with a "refresh backend list" hint.
- IBM wraps `job.status()` in its own try/except so a deleted job
  returns status=`unknown` instead of breaking the polling loop.
- Server catches `KeyError` on stale job IDs with a friendly
  status=`stale` response, not a raw traceback.
- Every failed submit now populates `JobHandle.error` with a
  readable provider-specific message.

### Added — Credentials moved to OS keyring

Provider tokens no longer live in browser `localStorage`. The kernel
receives them over WebSocket, persists via the `keyring` package
(macOS Keychain / Windows Credential Manager / Linux Secret Service),
and auto-reconnects every previously-connected provider on kernel
start. A one-time migration on WS connect drains any legacy
`nuclei-hardware-*` localStorage entries into the keyring and wipes
them. `CredentialSetup` form layout unchanged.

### Added — Job persistence across kernel restarts

Jobs persist to `~/.nuclei/jobs.json` (override via `NUCLEI_DATA_DIR`).
Atomic temp-file-plus-rename writes, LRU cap at 200 entries, 7-day
TTL for terminal jobs. On kernel restart, non-terminal jobs
re-appear in JobTracker as `stale` — users see their history
instead of the list going empty.

### Added — Exponential polling backoff

Hardware job polling: 5s tier for 0–60s after submit, 15s to 5min,
60s to 30min, 5min past that. ±10% jitter, 24h stale cutoff, snap
back to fast tier on status change. A 1-hour queued IBM job now
fires ~30 status requests instead of 720.

### Added — Dirac conversation persistence

One conversation per project, auto-saved to
`<projectRoot>/.nuclei/dirac.json` with a default `.gitignore` so
AI chats don't get committed. Ephemeral fallback for work outside a
project — localStorage on web, platform key-value store on desktop.
300ms debounced writes with at-most-one-in-flight coalescing so
streaming responses don't thrash the disk. `DiracMessage` gained
required `id` and `timestamp` fields (auto-generated by the store).
Auto-restore on project open and app start. Past tool calls render
as display-only history on reload; never re-execute.
`clearHistory` now writes `messages: []` to disk while keeping
`conversation_id` stable (friendly to a future multi-conversation
feature). No UI changes — the Dirac side panel renders identically.

### Fixed — JobHandle.error, unknown/stale statuses surfaced to UI

`JobHandle` gained an optional `error` field and two new status
values (`unknown`, `stale`). `JobTracker` renders both distinctly.

## [0.4.11] - 2026-04-19

### Fixed — YouTube Error 153 actually resolved (previous fix didn't work)

v0.4.10 tried to fix Error 153 by dropping `enablejsapi=1` and
switching from `youtube.com/embed` to `youtube-nocookie.com/embed`.
That reasoning was wrong. YouTube's embed player validates the
parent document's origin regardless of which domain you embed from,
and Tauri's `tauri://localhost` (macOS) / `http://tauri.localhost`
(Win/Linux) webview origin is rejected either way. `nocookie` is
actually stricter than the regular embed, so the swap made the
failure mode more visible, not less.

In-iframe embedding cannot be fixed inside Tauri — the webview
origin is fixed by the runtime. Every major desktop app (Linear,
Slack, Notion, Discord) handles this the same way: poster thumbnail
in-app, video plays in the OS default browser.

- Added `tauri-plugin-shell` with a scoped `shell:allow-open`
  permission limited to `youtube.com` and `youtu.be`.
- Rewrote `VideoPlayer` as a click-to-play poster — YouTube
  thumbnail, play button overlay, "Opens in browser" hint.
  Chapter clicks open the video at the right timestamp via
  `?t=Ns`. Lesson view no longer mounts an iframe at all.
- `VideoLibrary` and `TrackSelector` now open the external browser
  directly when a video card is clicked; the iframe modals that
  couldn't load the videos anyway have been removed.
- CSP `frame-src` trimmed to `'self'` since no YouTube iframes
  remain; `img-src` still whitelists `img.youtube.com` for
  thumbnails.

## [0.4.10] - 2026-04-19

### Fixed — lesson videos failing with YouTube Error 153 (superseded by 0.4.11)

`VideoPlayer` was embedding lessons with `enablejsapi=1`, which makes
YouTube validate the parent origin before initializing the embed
player. Tauri's `tauri://localhost` webview origin doesn't satisfy
that check, so YouTube bailed out with "Error 153 — Video player
configuration error" on every lesson with an embedded video. Nothing
in the frontend actually uses the YouTube JS API (chapter clicks work
by re-rendering the iframe with a new `src`), so the flag was dead
weight anyway.

- Dropped `enablejsapi=1` from `VideoPlayer`.
- Standardized all three YouTube embeds (`VideoPlayer`,
  `VideoLibrary`, `TrackSelector`) to `youtube-nocookie.com`. The CSP
  already whitelists it, it's more lenient about embedded-origin
  checks, and it stops YouTube from setting tracking cookies on
  students who are just watching a lesson video.

Note: This fix did not actually resolve Error 153. See 0.4.11.

## [0.4.9] - 2026-04-18

### Changed — right rail is now Bloch-only

The gate-circuit diagram used to share the right rail with the Bloch
sphere, but it was clipping against the top of the panel and
competing with the sphere for vertical space. Removed from the rail
entirely so the interactive Bloch sphere gets the full right column
and nothing fights it for room.

- `CircuitRenderer` still exists (and still accepts clicks from
  Dirac tools like `highlight_gate`), but no longer renders in the
  default layout.

## [0.4.8] - 2026-04-18

### Fixed — Bloch sphere was blank inside the Tauri bundle

`@react-three/drei` `<Text>` uses troika-three-text, which fetches the
default Roboto font from `fonts.gstatic.com` when no `font` prop is
provided. Under Tauri's bundled `tauri://` origin that fetch fails,
troika throws inside Canvas suspense, and the whole WebGL scene stops
rendering — which is why v0.4.5–v0.4.7 shipped with an empty dark
panel where the Bloch sphere should have been.

- Swapped all 3D labels (X/Y/Z axes + |0⟩/|1⟩ basis labels) from
  drei `<Text>` to drei `<Html>`. HTML overlays project onto the
  sphere's 3D positions, track orbit rotation, and require no
  external font fetch. Works offline, works inside the bundle.

### Added — quick-create circuit chips in the empty explorer

- Empty-state sidebar now shows a **Quick start** row with Qiskit /
  Cirq / CUDA-Q chips below the "New Project…" button. One click
  creates an in-memory project + seeded tab with that framework's
  Bell-state starter. Removes the "click New Project, then click +"
  two-step for the common case.

## [0.4.7] - 2026-04-18

### Added — first-run framework installer

Nuclei now ships with a proper framework setup wizard instead of assuming the student has `python3`, `qiskit`, `cirq`, and `cudaq` already working on their system.

- **Managed Python environment.** Nuclei creates and maintains a private venv at `<appDataDir>/venv`. The kernel launches from this venv automatically, so frameworks installed through the wizard are always visible without the student touching PATH or activating anything.
- **Framework wizard.** On first launch, a modal appears with a checklist:
  - Core: Qiskit (recommended, ~220 MB), Cirq (recommended, ~60 MB), CUDA-Q (~500 MB, CPU sim everywhere, GPU on Linux+CUDA).
  - Hardware providers: IBM Runtime, IonQ, AWS Braket, Azure Quantum, Quantinuum (pytket).
  - Each row shows approximate download size and whether it's already installed.
  - Students pick what they want, click Install, get live per-framework progress events from the Rust side.
- **Settings → Quantum Frameworks** opens the same wizard any time, so students can add CUDA-Q later or install an extra provider mid-course without re-onboarding.
- **Graceful degradation.** If Python 3 isn't on the system PATH at all, the wizard shows a friendly "install Python 3.10+ from python.org" instead of failing silently. If a single framework install fails (network, wheel build), the rest still install and the failure summary names which ones need retry.

This is the groundwork for CUDA-Q support out of the box — you no longer need to have it pre-installed on your Mac for `@cudaq.kernel` to work.

## [0.4.6] - 2026-04-18

### Fixed — Bloch sphere labels no longer clip at panel edges

- **Camera reframed.** The v0.4.5 Bloch sphere had the camera at distance ~2.94 with a 38° FOV, giving a vertical half-extent of ~1.01 at origin — but the axis labels sat at radius 1.29 and the basis labels (|0⟩/|1⟩) at 1.32. Result: labels were getting clipped at the panel's top and bottom edges. Camera is now at distance ~4.07 with a 45° FOV (half-extent ~1.69), and label offsets pulled in to 1.05 × axis length and ±1.22 for the poles. Comfortable margin at narrow-rail aspects.
- **Zoom clamps.** `minDistance=2.2` (just past the sphere surface) and `maxDistance=6.5` (far enough for overview, close enough for the state arrow to stay legible).
- **BlochPanel bottom padding** dropped from 28px → 12px so the sphere sits centered in its rail instead of floating high.

## [0.4.5] - 2026-04-18

### Changed — in-memory New Project + classic interactive Bloch sphere

- **New Project is now an in-memory scratch, not a disk folder.** Previously the button opened Finder, made you name a project, and wrote a directory before you'd typed a single character. Wrong metaphor. Now clicking New Project opens an untitled `main.py` tab in memory with the current framework's starter code — no Finder, no disk. Write code, decide where to save it later with ⌘S. On save the tab re-paths to the real location and the sidebar tree flips from the "tab-only" view to the real filesystem view.
- **Bloch sphere replaced with a classic interactive sphere.** Ported the bits-and-electrons simulator style (https://github.com/bits-and-electrons/bloch-sphere-simulator) into React Three Fiber. Wireframe sphere, labeled X/Y/Z axes (red/green/blue matching the reference), |0⟩/|1⟩ basis labels at the poles, cyan state arrow that reacts to simulation results. Drag to rotate, scroll to zoom. Multi-qubit circuits render spheres side-by-side in the rail, each with its own OrbitControls.
- **Gate rail gets proper top padding.** The circuit wire diagram was rendering flush with the top edge of the panel; now has 16px breathing room so the top wire's `|0⟩` label isn't kissing the window chrome.

### Removed

- Deleted the floating-qubit constellation (Constellation.tsx, FloatingBlochQubit.tsx, CameraDirector.tsx, EntanglementTethers.tsx, BlochStage.tsx) and the useQubitLayout / useReducedMotion hooks that only that visual needed. The new classic sphere renders from the same kernel `bloch_coords` so nothing upstream changes.

## [0.4.4] - 2026-04-18

### Added — PyCharm-style project creation and framework-aware starters

- **New Project flow.** The empty-state panel now offers both "New Project…" and "Open Folder…". New Project prompts for a parent directory and a project name, scaffolds `<parent>/<name>/main.py` with the currently selected framework's starter Bell-state code, and seeds a `README.md` with the framework tagged. The new project immediately becomes the active folder and `main.py` opens in a tab.
- **New-item dropdown in the project toolbar.** Replaced the single "+" file icon with a PyCharm-style `+` menu containing:
  - **New File** — generic `.py` prefilled with `untitled.py`.
  - **New Circuit ▸ Qiskit / Cirq / CUDA-Q** — creates a framework-tagged Python file (`qiskit_circuit.py` etc.) prefilled with that framework's Bell-state starter and switches the editor framework to match.
  - **New Python Package** — folder + `__init__.py` (so imports work without extra ceremony).
  - **New Folder** — plain directory.
- **Shared starter templates.** Extracted Qiskit / Cirq / CUDA-Q Bell-state templates into `src/data/starterTemplates.ts` so the framework selector and the New Circuit menu stay in sync.

### Changed — switching framework now updates the starter code

- Picking a different framework from the top-bar selector (e.g. Qiskit → Cirq) now replaces the editor buffer with that framework's starter template, provided the buffer is untouched (empty, or still matching a known starter) and no file is open. If you've written real code or have a saved file open, the selector just flips the framework label and leaves your code alone — switching frameworks isn't a source transform.

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
