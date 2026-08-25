# Unified QEC Workbench Implementation Program

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Unified QEC Workbench for Stim/sinter simulation researchers and hardware teams, from light UI and synchronized investigation through offline/live syndrome data, tiered compute, reproducible Findings, and release hardening.

**Architecture:** Five independently shippable plans share a versioned Study, selection, session, query, and adapter contract. React owns bounded interactive state and rendering; Tauri owns trusted process/capability orchestration; Python owns Stim/sinter, Arrow/Parquet/DuckDB, adapters, statistics, and cancellable jobs. Existing QEC files and protocol messages remain valid.

**Tech Stack:** React 19, TypeScript 5.9, Zustand 5, Zod 4, D3 7, Recharts 3, Tauri 2/Rust 1.77, Python 3.11+, pytest, PyArrow, Parquet, DuckDB, Stim, sinter, WebSocket JSON control messages, Arrow IPC process batches, optional Arrow Flight.

## Global Constraints

- Follow the approved design at `docs/superpowers/specs/2026-07-21-qec-unified-workbench-design.md`.
- Preserve all existing `.stim`, `.dem`, Stim result, sinter CSV, noise YAML, experiment schema v1/v2, and kernel protocol v1.2 behavior.
- New protocol and canonical-schema changes are additive and versioned.
- Use immutable state updates; do not mutate Zustand objects, datasets, selections, or manifests in place.
- Validate external input with Zod in TypeScript, JSON Schema/dataclasses in Python, and typed serde structures in Rust.
- Keep functions under 50 lines where practical and files under 800 lines; extract focused utilities before limits are exceeded.
- Every task follows TDD: failing test, observed failure, minimal implementation, passing test, refactor, focused verification, commit.
- Minimum line coverage is 80% for each changed package; critical schema, query, safety, and statistics modules require branch coverage for error paths.
- No hardcoded secrets or adapter credentials. Tauri is the capability boundary; React cannot emit arbitrary hardware commands.
- Nuclei remains outside deterministic decoder feedback. Live support is observability and experiment control only.
- Raw imported/captured data is immutable. Derived data names its parents and transformation recipe.
- React never owns an entire large capture; it renders bounded tiles, pages, or selected windows.
- Every numerical result exposes sample count, uncertainty method, filters/exclusions, source lineage, and ground-truth status.
- New QEC UI is accepted against Nuclei light mode only: white surfaces, pale blue fields, existing light tokens, no dark navy or neon treatment.
- All charts include keyboard interaction, accessible summaries, and table/data alternatives.
- Use SVG/Lucide icons, not emoji UI icons.
- Respect `prefers-reduced-motion`; animate only transform/opacity where possible.
- Before each implementation plan begins, re-check primary vendor docs and `gh search code` for the exact API/version named by that plan.
- Before every commit: run focused tests, lint/type checks for touched languages, secret scan on staged content, and `git diff --cached --check`.

---

## Source Documents

- Design: `docs/superpowers/specs/2026-07-21-qec-unified-workbench-design.md`
- Existing QEC product contract: `docs/internal/PRD_10_QEC_STUDIO.md`
- Existing workspace contract: `docs/internal/PRD_11_WORKSPACE_UX_NAVIGATION.md`
- Public QEC docs: `docs-site/src/content/docs/research/`
- Stim formats: <https://github.com/quantumlib/Stim/tree/main/doc>
- QECi: <https://www.riverlane.com/get-qec-ready/qeci>
- Arrow IPC: <https://arrow.apache.org/docs/format/Columnar.html>
- Arrow Flight: <https://arrow.apache.org/docs/format/Flight.html>
- Qiskit Experiments: <https://qiskit-community.github.io/qiskit-experiments/>

## Plan Set and Dependency Graph

```text
P1 Workbench Foundation
       │
       ├──────────────┐
       ▼              │
P2 Data Platform      │
       │              │
       ├──────┐       │
       ▼      │       │
P3 Simulation + Failure Workflows
       │      │
       └──┬───┘
          ▼
P4 Hardware Replay + Live Observatory + Tiered Scale
          │
          ▼
P5 Findings + Dirac + Release Hardening
```

| Plan | File | Independently shippable outcome |
|---|---|---|
| P1 | `docs/superpowers/plans/2026-07-21-qec-workbench-foundation.md` | Create/open a Study, use Build/Analyze/Observe presets, navigate the four-zone light workspace, and carry a linked Research Selection trail over existing QEC data. |
| P2 | `docs/superpowers/plans/2026-07-21-qec-data-platform.md` | Import Stim/sinter/generic recorded data into versioned canonical sessions, query bounded tiles from local Parquet/DuckDB, and validate adapters with a compliance kit. |
| P3 | `docs/superpowers/plans/2026-07-21-qec-simulation-failure-workflows.md` | Complete the simulation edit→campaign→outlier→failed-shot→decoder-comparison workflow with synchronized views, Campaign Center, Failure Microscope, Cohorts, Error Atlas, and Diff Peel. |
| P4 | `docs/superpowers/plans/2026-07-21-qec-hardware-observatory.md` | Import and replay hardware captures/calibrations, observe a synthetic/QECi-style live stream, freeze incidents, enforce safe commands, and scale queries beyond memory. |
| P5 | `docs/superpowers/plans/2026-07-21-qec-findings-dirac-release.md` | Pin reconstructible Findings, run recipes, generate reports, ground Dirac in evidence, migrate old projects, and pass accessibility/security/performance/release gates. |

## Cross-Plan File Ownership

### Shared contracts owned by P1

- `src/types/qecStudy.ts` — Study, source reference, Snapshot reference, and workspace preset schemas.
- `src/types/qecSelection.ts` — stable entity references, Research Selection, and trail steps.
- `src/stores/qecStudyStore.ts` — active Study and filesystem lifecycle.
- `src/stores/researchSelectionStore.ts` — immutable linked selection and history.
- `src/components/qec/workbench/` — shell, chrome, zones, and responsive behavior.

Later plans may add entity kinds and source/session metadata additively. They must not rename P1 public types.

### Shared data contracts owned by P2

- `schemas/qec-data/v1/*.schema.json` — canonical JSON Schemas.
- `kernel/qec_data/models.py` — frozen Python records mirroring schema concepts.
- `src/types/qecData.ts` — Zod-validated frontend summary/query/result types.
- `kernel/qec_data/protocol.py` and `src/types/qecDataProtocol.ts` — exact control/query messages.
- `kernel/qec_data/adapters/base.py` — adapter Protocol and capabilities.
- `src/stores/qecQueryStore.ts` and `src/stores/qecJobStore.ts` — bounded query/job state.

Later plans add recipes, live statuses, and tile variants through discriminated unions. Existing variants remain accepted.

### Existing code with single-plan primary ownership

| Existing area | Primary plan |
|---|---|
| `src/layout/panelRegistry.ts`, `src/components/layout/PanelLayout.tsx` | P1 |
| `src/components/qec/QecTimelinePanel.tsx`, `CodeLatticePanel.tsx`, `DetectorGraph*` | P3 |
| `src/components/qec/QecAnalysisView.tsx`, `ThresholdPanel.tsx`, `DecoderWorkbench.tsx` | P3 |
| `kernel/qec/campaign.py`, `src/services/qecCampaignRunner.ts` | P3 |
| `src-tauri/src/commands/kernel.rs`, `src-tauri/src/lib.rs` data-engine additions | P2 |
| `src/plugins/manifestSchema.ts`, `src/plugins/types.ts` QEC adapter capability | P2 |
| Live adapter/control modules | P4 |
| `src/hooks/useDirac.ts`, `src/services/qecContext.ts`, `src/services/agent/tools.ts`, `src/services/agent/toolExecutors.ts` | P5 |

## Frozen Cross-Plan TypeScript Interfaces

P1 defines these names; later plans extend unions additively:

```ts
export type QecWorkspacePreset = 'build' | 'analyze' | 'observe';

export type QecEntityKind =
  | 'study'
  | 'source'
  | 'session'
  | 'dataset'
  | 'circuit-revision'
  | 'tick'
  | 'qubit'
  | 'stabilizer'
  | 'detector'
  | 'edge'
  | 'logical-observable'
  | 'campaign-point'
  | 'decoder'
  | 'shot'
  | 'round'
  | 'time-window'
  | 'calibration-record'
  | 'cohort'
  | 'alert'
  | 'finding';

export interface QecEntityRef {
  kind: QecEntityKind;
  id: string;
  sessionId?: string;
  datasetId?: string;
}

export interface ResearchSelection {
  primary: QecEntityRef | null;
  scope: readonly QecEntityRef[];
  timeWindow: { start: number; end: number; domain: 'tick' | 'round' | 'ns' } | null;
  source: 'user' | 'panel' | 'alert' | 'dirac' | 'restore';
}
```

P2 defines the query envelope:

```ts
export type QecTileKind =
  | 'time-series'
  | 'heatmap'
  | 'histogram'
  | 'graph-overlay'
  | 'shot-window'
  | 'table-page';

export interface QecQuerySpec {
  requestId: string;
  sessionId: string;
  datasetId: string;
  tile: QecTileKind;
  selection: ResearchSelection;
  resolution: { width: number; height: number };
  filters: Readonly<Record<string, string | number | boolean>>;
}

export type QecQueryResult =
  | { type: 'progress'; requestId: string; fraction: number; message: string }
  | { type: 'tile'; requestId: string; tile: QecTilePayload; complete: boolean }
  | { type: 'error'; requestId: string; code: string; message: string };
```

## Frozen Python Adapter Interface

P2 owns the following Protocol. P4 may implement live/control methods but may not change their signatures:

```python
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Protocol

class QecDataAdapter(Protocol):
    manifest: AdapterManifest

    def probe(self, source: Path) -> ProbeResult: ...
    def validate(self, source: Path, mapping: ImportMapping) -> ValidationReport: ...
    def preview(self, source: Path, mapping: ImportMapping, limit: int) -> PreviewResult: ...
    def import_batches(self, source: Path, mapping: ImportMapping) -> Iterator[CanonicalBatch]: ...
    async def stream_batches(self, config: StreamConfig) -> AsyncIterator[CanonicalBatch]: ...
    async def command(self, command: AdapterCommand) -> CommandResult: ...
```

Adapters that do not support streaming or commands return a typed `unsupported_capability` result; they do not omit methods or raise `NotImplementedError` across the process boundary.

## Control and Data Transport Contract

- Existing kernel control WebSocket remains `ws://127.0.0.1:9742`.
- QEC Data Engine uses `ws://127.0.0.1:9743` and a random 256-bit token created by Tauri for each process start.
- Tauri sets `NUCLEI_QEC_DATA_TOKEN` in the child environment and returns `{ url, token }` only to the local webview through `qec_data_start`.
- The first client frame is `{"type":"authenticate","token":"..."}`. The engine closes unauthenticated clients with code `4401`.
- Browser-facing messages are bounded JSON query specifications, progress, tiles, pages, and errors.
- Adapter/data-engine and remote-compute batch boundaries use Arrow `RecordBatch`/IPC, not browser-owned raw captures.
- A single browser tile payload is capped at 1 MiB and a table page at 10,000 rows; larger queries must refine or paginate.

## Canonical Data Versioning

- Canonical schema package starts at `qec-data/1.0.0`.
- `schema_version` is required in Session manifests and record metadata.
- Minor versions add optional fields; major versions require explicit migration.
- Original inputs and hashes are retained so normalized data can be rebuilt.
- Dataset IDs are SHA-256 hashes over parent IDs, recipe ID/version, canonical parameters, and schema version.
- Sessions and raw datasets are immutable; mutable UI state never enters their identity.

## Delivery Waves

### Wave 1 — Product foundation

Execute P1. Demo gate: create a Study from existing QEC files, switch presets, link a detector/tick selection, persist layout, and pass light-theme visual/a11y tests.

### Wave 2 — Durable offline data

Execute P2. Demo gate: import Stim `.dets`, sinter CSV, and generic Parquet into a canonical session; restart; query bounded tiles; verify original hashes and adapter compliance.

### Wave 3 — Simulation differentiator

Execute P3. Demo gate: edit Stim, run/resume campaign, select a threshold outlier, open a failed shot in the Failure Microscope, compare decoders, create a Cohort, and use Diff Peel.

### Wave 4 — Hardware teams

Execute P4. Demo gate: import a hardware-like syndrome/calibration capture, replay it, connect the synthetic live adapter, trigger an alert under load, freeze an incident, execute one authorized control command, and recover after restart.

### Wave 5 — Evidence and release

Execute P5. Demo gate: pin a Finding, reproduce it after restart, generate a report/provenance bundle, ask Dirac an evidence-grounded question, and pass full release gates.

## Design-to-Task Traceability

| Approved capability or constraint | Owning implementation tasks | Acceptance evidence |
|---|---|---|
| Study as the top-level research object | P1 Tasks 2–3 | Schema round-trip, create/open lifecycle, public docs |
| Build / Analyze / Observe presets | P1 Tasks 5–8 | Registry tests, persisted preset/layout, keyboard E2E |
| Four-zone light workbench | P1 Tasks 1, 6–9 | Component tests, 1024/1440 visual baselines, a11y flow |
| Shared Research Selection and history | P1 Task 4; P3 Tasks 1–3 | Immutable store tests and linked-view interaction tests |
| Canonical Study / Session / Dataset records | P2 Tasks 2–4 | Cross-language fixtures and atomic Parquet round-trip |
| Progressive bounded querying | P2 Tasks 5, 8–10 | SQL-injection tests, 1 MiB/10k caps, import/query E2E |
| Open adapter SDK and compliance kit | P2 Tasks 6–7; P4 Tasks 2, 6 | Probe immutability, validation, resume, dependency-absence tests |
| Stim/sinter edit-to-campaign workflow | P3 Tasks 1–7 | Campaign preflight/resume and diagnostic-sampling tests |
| Timeline, Lattice, and Detector Graph synchronization | P3 Tasks 1–3 | Stable-ref, semantic-zoom, and keyboard tests |
| Failure Microscope | P3 Tasks 7–8; P4 Tasks 3, 5 | Seeded shot reconstruction and hardware replay E2E |
| Cohorts, Error Atlas, and Diff Peel | P3 Task 9 | Recipe correctness and linked-selection tests |
| Hardware syndrome/calibration import | P4 Tasks 1–3 | QECi-style/Qiskit export fixtures, mapping and alignment tests |
| Space-Time Syndrome Explorer | P4 Task 4 | Level-of-detail, accessible-summary, and large-fixture tests |
| Offline replay before live | P4 Task 5 before Tasks 6–9 | Deterministic virtual-clock E2E gate |
| Durable live observability | P4 Tasks 6–8 | Resume, backpressure, disk failure, soak, and alert tests |
| Safe control-plane boundary | P4 Task 9 | Deny-by-default, nonce, audit-chain, redaction tests |
| Laptop / workstation / cluster tiers | P4 Task 10 | Identical recipe identity, quota, cancellation, TLS tests |
| Findings, snapshots, recipes, and reports | P5 Tasks 1–5 | Evidence restoration, snapshot idempotence, export provenance |
| Evidence-grounded Dirac | P5 Tasks 6–7 | Context budget/redaction and no-hardware-command tests |
| Backward compatibility and migration | P5 Task 8 | Idempotence, backup, rollback, legacy-open tests |
| Accessibility, security, performance, packaging | P5 Tasks 9–11 | WCAG/visual/keyboard gates, threat model, measured budgets, full CI |

Any implementation change that moves ownership must update this table and the cross-plan file-ownership section in the same commit.

## Program Verification Commands

Run after every plan and at the final gate:

```bash
npm test
npm run lint
npm run build
cd kernel && pytest -q --cov=. --cov-report=term-missing
cd src-tauri && cargo fmt --check
cd src-tauri && cargo clippy -- -D warnings
cd src-tauri && cargo test
```

After Playwright is introduced in P1:

```bash
npx playwright test
npx playwright test --project=chromium --grep @qec
```

Security and dependency gates:

```bash
cd src-tauri && cargo audit
cd src-tauri && cargo deny check
cd kernel && bandit -r qec_data qec
git grep -nE "(sk-[A-Za-z0-9_-]{20,}|api[_-]?key[[:space:]]*[:=][[:space:]]*['\"][^'\"]+)" -- ':!package-lock.json'
```

## Program Completion Checklist

- [ ] P1 committed and its demo/coverage/visual gates pass.
- [ ] P2 committed and offline canonical import/query gates pass.
- [ ] P3 committed and simulation Failure Microscope flow passes.
- [ ] P4 committed and hardware replay/live/scale gates pass.
- [ ] P5 committed and evidence/release gates pass.
- [ ] All design acceptance criteria map to passing automated or documented manual checks.
- [ ] No critical/high code review or security findings remain.
- [ ] No silent loss path exists in import, normalization, capture, replay, or export.
- [ ] Existing QEC fixtures and experiment schema compatibility suites remain green.
- [ ] Public docs, protocol changelog, adapter SDK docs, and release demo are complete.
