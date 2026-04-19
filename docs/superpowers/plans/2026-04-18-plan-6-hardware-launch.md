# Plan 6 — Cool submission UI + real providers

**Goal:** Make writing quantum code → simulating classically → submitting to real hardware a first-class, visible, cool-looking flow. Replace the buried hardware sidebar with a full-screen Launch modal, integrate classical-vs-hardware results comparison into the main visualization surface, and bring two more providers online (NVIDIA CUDA-Q as a GPU backend, IonQ via qiskit-ionq).

**Architecture:** New `LaunchModal` is the single submission entry point (⌘⇧R). It has a provider-card grid → backend picker → submit. In-flight jobs render as a top-edge `LaunchStrip` instead of a buried list. On complete, the existing `HistogramChip` gains a dual-bar mode (classical vs hardware). Two Python providers (`ionq_provider.py`, `nvidia_provider.py`) replace their stubs. Google stays a "Coming soon" card.

**Branch:** `feat/hardware-launch` (cut from `main`).

**Tech:** React 19 + TypeScript + Zustand on the frontend; `qiskit-ionq` + `cudaq` on the Python kernel side.

---

## Frontend tasks

1. **Provider logos.** Tiny inline SVG monograms for IBM / IonQ / NVIDIA / Local (lucide-style, single-color).
2. **`LaunchModal.tsx`** — three-act modal:
   - Act 1: provider card grid (4 cards, pick one)
   - Act 2: backend list for selected provider + shot stepper + `Submit` button
   - Act 3: transitions to `LaunchStrip`, modal closes
3. **`LaunchStrip.tsx`** — thin status bar at top of editor showing active job. Click to reopen details.
4. **`HistogramChip` dual mode** — accept optional `hwProbabilities`; render classical bar + hardware bar side-by-side per outcome.
5. **⌘⇧R shortcut** in `App.tsx` to open `LaunchModal`.
6. **Status bar launch button** next to Run for click-discoverable entry.
7. Update `hardwareStore` — add `'nvidia'` provider type, wire modal open/close.
8. Mark Google as "Coming soon" card with a muted style.

## Kernel tasks

9. **`kernel/hardware/ionq_provider.py`** — real implementation via `qiskit-ionq`. Uses `IonQProvider` from `qiskit_ionq`, mirrors the IBM provider's shape.
10. **`kernel/hardware/nvidia_provider.py`** — new provider. CUDA-Q local GPU simulation. Backends: `nvidia` (single GPU, FP32), `nvidia-fp64` (FP64), `nvidia-mgpu` (multi-GPU if available). Graceful fallback if `cudaq` isn't installed.
11. **`kernel/hardware/manager.py`** — register the NVIDIA provider.

## Plumbing

12. Update `src/types/hardware.ts` — add `'nvidia'` to `HardwareProviderType`.
13. Update `src/stores/hardwareStore.ts` — seed NVIDIA alongside others.

## Release

14. Bump version to 0.3.0 in `package.json`, `tauri.conf.json`, `Cargo.toml`, add CHANGELOG entry.
15. PR to main, squash-merge.
16. Tag `v0.3.0` → draft release workflow.

## Out of scope

- AWS Braket aggregator
- Rigetti, Pasqal, Quantinuum
- Cost estimation beyond a static indicator per provider (Free / Credits / Paid)
- Real-hardware integration tests (no API creds available locally — IBM's existing code proves the shape)
