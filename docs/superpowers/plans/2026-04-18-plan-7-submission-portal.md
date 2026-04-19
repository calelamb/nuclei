# Plan 7 — Submission Portal + All Providers

**Goal:** Make "submit this file to real quantum hardware" a prominent, one-click workflow. Add every public cloud-quantum hardware route via three aggregators + two direct vendors. A new sidebar Launch Portal with drag-drop file submission makes the flow discoverable as a first-class surface, not buried in a modal.

**Architecture:**
- Three new hardware aggregators (AWS Braket, Azure Quantum, Quantinuum) expose nested backend lists to the existing LaunchModal.
- Two "different paradigm" providers (Xanadu photonic, D-Wave annealer) appear as honest "Different compute model" cards.
- New `LaunchPortal.tsx` sidebar view registered under activity id `'launch'`. Drop zone at top accepts `.py` / `.qasm` from OS or from project files. Flat provider grid below. Active jobs + recent results as live sections. Clicking a provider card opens the existing LaunchModal with that provider pre-selected.
- Reuses the existing `LaunchModal` + `LaunchStrip` + dual-bar `HistogramChip` from Plan 6.

**Branch:** `feat/submission-portal` (cut from `main`).

## New frontend components

- `src/components/hardware/LaunchPortal.tsx` — dedicated sidebar view with drop zone + provider grid + jobs + results.
- `src/components/layout/ActivityBar.tsx` — add `'launch'` icon (lucide `Rocket`) between Challenges and Settings.
- `src/components/layout/Sidebar.tsx` — route `'launch'` to `<LaunchPortal />`.

## New Python providers

- `kernel/hardware/braket_provider.py` via `amazon-braket-sdk`.
- `kernel/hardware/azure_provider.py` via `azure-quantum`.
- `kernel/hardware/quantinuum_provider.py` via `pytket-quantinuum`.
- Register all in `kernel/hardware/manager.py`.

## Plumbing

- `src/types/hardware.ts` — add `'braket' | 'azure' | 'quantinuum' | 'xanadu' | 'dwave'`.
- `src/stores/hardwareStore.ts` — seed the new provider entries.
- `src/components/hardware/ProviderLogo.tsx` — SVG monograms for the new providers (no emojis, lucide-style single-color marks).
- `src/components/hardware/LaunchModal.tsx` — extend `PROVIDERS` metadata with all the new entries + their taglines + pricing labels. Xanadu and D-Wave marked as "Coming soon" with a "Different model" note.
- `src/components/hardware/BackendSelector.tsx` + `CredentialSetup.tsx` + `HardwarePanel.tsx` — fill the exhaustive `Record<HardwareProviderType, ...>` maps (or TS will refuse to build).

## Drop-zone semantics

A dropped file is read into memory and opened as a temp buffer in the editor (Q2 = b). The student can eyeball it before clicking Launch. No disk writes until they explicitly save.

## Release

- Bump version to 0.4.0 in `package.json`, `tauri.conf.json`, `Cargo.toml`, sync lockfile.
- CHANGELOG entry.
- PR → merge → tag `v0.4.0` → release workflow → draft signed desktop releases.

## Out of scope

- Integration tests against real provider APIs (no credentials available locally — adapters are structured to mirror the proven IBM pattern).
- Circuit translation between frameworks (Qiskit → Cirq, etc.) — each provider SDK handles its own.
- D-Wave / Xanadu actual submission paths — they're different compute models; marked honestly in UI.
