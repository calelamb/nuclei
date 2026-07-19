# Nuclei for iOS

Native Swift / SwiftUI companion & studio for [Nuclei](../README.md), the
open-source quantum workspace. Planning and foundation live here.

- **Spec:** [`docs/ios/PRD_13_NUCLEI_FOR_IOS.md`](../docs/ios/PRD_13_NUCLEI_FOR_IOS.md)
- **Build plan:** [`docs/ios/PHASE_0_1_PLAN.md`](../docs/ios/PHASE_0_1_PLAN.md)

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

## Building the package

```bash
cd ios/NucleiKit
swift test        # requires a Swift 6 toolchain (macOS / Xcode 16+)
```

The `NucleiApp` SwiftUI target is Phase 1 (see the build plan) and is not in this
foundation drop.

## Conventions (mirrored from the kernel)

- **Qubit ordering / bitstrings** in the native simulator: qubit *q* = bit *q* of
  the basis index (little-endian, Qiskit-style); bitstring keys are the base-2
  index string, width `qubit_count`. Treat keys as opaque labels.
- **Honest degradation:** anything the local engine can't do (other frameworks,
  hardware, QEC) returns a clear "connect a kernel" error, never a silent failure.
- **Protocol source of truth:** `src/types/quantum.ts`. A protocol change updates
  it first, then NucleiKit; the fixture-replay decode tests keep them in lockstep.
