# Nuclei for iOS

Native Swift / SwiftUI companion & studio for [Nuclei](../README.md), the
open-source quantum workspace. Planning and foundation live here.

- **Spec:** [`docs/mobile/PRD_13_NUCLEI_FOR_IOS.md`](../docs/mobile/PRD_13_NUCLEI_FOR_IOS.md)
- **Build plan:** [`docs/mobile/PHASE_0_1_PLAN.md`](../docs/mobile/PHASE_0_1_PLAN.md)

## What's here so far

`NucleiKit/` — the reusable, UI-agnostic Swift package that the app, widgets, and
Watch target will all build on. Seeded in the foundation PR:

| Area | Files | What it is |
|------|-------|-----------|
| **Protocol** | `Sources/NucleiKit/Protocol/` | Codable mirror of the kernel wire protocol (`src/types/quantum.ts`) — circuits, results, hardware jobs, request/response envelopes. The client rules (ignore unknown types, tolerate absent fields, terminal-message streaming) are baked in. |
| **Session** | `Sources/NucleiKit/Session/` | `KernelSession` — the one seam the app is written against. `RemoteKernelSession` (WebSocket to a hosted/LAN kernel) and `LocalSimulatorSession` (native engine, no network). |
| **Simulator** | `Sources/NucleiKit/Simulator/` | A native Swift statevector engine that emits the **same** `CircuitSnapshot`/`SimulationResult` shapes as the Python kernel, plus a per-gate trajectory for the step-through debugger. This is what makes "built in Swift" real rather than a webview wrapper. |
| **Tests** | `Tests/NucleiKitTests/` | Protocol-decode tests and simulator parity tests (Bell, GHZ, \|+⟩, seeded reproducibility, debugger alignment). |

## Design in one line

The app talks to a `KernelSession`, never a transport. On device with a composer
circuit it's a `LocalSimulatorSession` (offline, instant). Point it at a hosted
kernel and it's a `RemoteKernelSession` (full frameworks, real hardware) — same
interface, same models, no app changes. See the PRD for why native (not a
WKWebView wrapper) and how the three product tiers sequence.

`NucleiApp/` — the SwiftUI app (Phase 1). A touch/Pencil circuit **composer**, a
SceneKit **Bloch sphere**, a Swift Charts **histogram**, a **template gallery**,
**Dirac** chat (BYOK), and **Settings** — all running on the native simulator, so
it works offline. Mobile-first affordances (tap-to-place, haptics, long-press
"explain", voice, share-as-Qiskit) are catalogued in
[`docs/mobile/MOBILE_UX.md`](../docs/mobile/MOBILE_UX.md).

```
NucleiApp/
├── project.yml                 # XcodeGen spec (generates the .xcodeproj)
└── Sources/
    ├── App/                    # entry, theme, root tab shell
    ├── Models/                 # @Observable stores (circuit, sim, settings, workspace)
    ├── Features/
    │   ├── Composer/           # grid, palette, gate glyphs, angle sheet
    │   ├── Visualization/      # Bloch (SceneKit), histogram (Swift Charts), results
    │   ├── Templates/          # one-tap starter circuits
    │   ├── Dirac/              # BYOK client, chat, gate explainer
    │   └── Learn/              # settings (lessons/challenges land next)
    └── Support/                # Keychain, haptics, speech, circuit export
```

## Building

```bash
# The reusable core (no UI) — runs anywhere with a Swift toolchain:
cd mobile/NucleiKit && swift test

# The app — generate the Xcode project, then open it:
brew install xcodegen
cd mobile/NucleiApp && xcodegen generate && open NucleiApp.xcodeproj
```

Requires Xcode 16+ (iOS 17 SDK). The app uses Swift 5 language mode; `NucleiKit`
is Swift 6-clean.

### What's real vs. stubbed

- **Real & offline:** composer → native statevector sim → Bloch/histogram/debugger,
  templates, share-as-Qiskit, haptics, seeded reproducibility.
- **Real, needs your Anthropic key:** Dirac chat + gate explainer (direct BYOK call).
- **Next (Phase 1.5+):** bundled lessons/challenges content, drag-to-move gates,
  Live Activities, and the remote-kernel path for full frameworks + hardware.

## Conventions (mirrored from the kernel)

- **Qubit ordering / bitstrings** in the native simulator: qubit *q* = bit *q* of
  the basis index (little-endian, Qiskit-style); bitstring keys are the base-2
  index string, width `qubit_count`. Treat keys as opaque labels.
- **Honest degradation:** anything the local engine can't do (other frameworks,
  hardware, QEC) returns a clear "connect a kernel" error, never a silent failure.
- **Protocol source of truth:** `src/types/quantum.ts`. A protocol change updates
  it first, then NucleiKit; the fixture-replay decode tests keep them in lockstep.
