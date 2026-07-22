# P2 Task 9 Report — Frontend QEC Data Client and Import Workflow

## Outcome

Implemented the authenticated frontend transport, progressive query and durable job stores, and a seven-stage canonical QEC import workflow. The workbench source list now launches imports into the persistent jobs tray, which starts the desktop data engine through Tauri and keeps the wizard mounted across tray collapse/expand transitions.

## Implementation

### Protocol and transport

- Added strict Zod schemas for the Tauri endpoint, import probe/validation/preview frames, multi-frame jobs, progressive query frames, cancellation responses, sessions, and request/requestless errors.
- Pinned the client to `ws://127.0.0.1:9743`; any other URL is rejected before a socket is constructed.
- Kept the endpoint token in a private client field and sent authentication as the first socket frame. Requests remain disabled until an `authenticated` response is received.
- Rejected non-text, malformed JSON, schema-invalid, and larger-than-1 MiB inbound frames before routing.
- Correlated one-shot and multi-frame requests by `requestId`, rejected every pending request with `engine_disconnected` on loss, and handled requestless engine errors globally.
- Enforced project-relative, non-canonical import sources and copy-only import result contracts.
- Added kind-aware `job_cancel` and `query_cancel` behavior.

### Stores

- Added a progressive query tile store with immutable frame accumulation, deterministic sequence ordering, monotonic epochs, stale-result suppression, and cancellation ownership guards.
- Added a durable job store for import selection, start/progress/completion/failure state, result counts, and import/query-specific cancellation.

### Import workflow and workbench integration

- Added the required Source → Adapter → Mapping → Preview → Validation → Destination → Import stages.
- Exposed project source identity, byte size, SHA-256, copy policy, source spans, adapter version/confidence, explicit scientific mapping options, bounded preview counts/truncation, provenance, validation warnings, and quarantine guidance.
- Required a successful probe, supported adapter, explicit reviewed mapping, successful validation, and destination before enabling Import; the disabled action states the current blocker.
- Kept preview dependent on successful validation and explains the dependency when the user first reaches Preview.
- Added labeled controls, semantic status/alert/progress roles, focus transfer to failed validation, visible focus rings, 44 px controls, reduced-motion behavior, and narrow responsive layouts without page overflow.
- Used the existing Lucide vocabulary and the requested cool-white/blue light palette with Inter/JetBrains Mono conventions.

## TDD evidence

The initial focused run failed with four missing module suites and zero tests because the client, types, stores, and wizard did not exist. A later source-to-tray integration test failed before the Import control was added, and the Tauri connection helper test failed before `connectQecDataClient` existed. Those tests passed after their minimal implementations were added.

Final fresh verification:

```text
npx vitest run src/services/qecDataClient.test.ts src/stores/qecQueryStore.test.ts \
  src/stores/qecJobStore.test.ts src/components/qec/import/qecImportModel.test.ts \
  src/components/qec/import/QecImportWizard.test.tsx \
  src/components/qec/workbench/QecWorkbench.test.tsx \
  src/components/qec/workbench/QecStudySidebar.test.tsx \
  src/components/qec/workbench/qecWorkbenchCss.test.ts \
  src/types/qecData.schema.test.ts

Test Files  8 passed (8)
Tests       90 passed (90)
```

```text
npm run build

tsc -b && vite build
4907 modules transformed
built successfully
```

```text
npx eslint <all Task 9 TypeScript/TSX files>

exit 0
```

Owned-file coverage:

| Metric | Coverage |
|---|---:|
| Statements | 89.82% (565/629) |
| Branches | 81.56% (292/358) |
| Functions | 87.27% (192/220) |
| Lines | 92.57% (449/485) |

## Self-review

- No CRITICAL or HIGH findings remain.
- No hardcoded credentials, token logging, absolute import path acceptance, unsafe HTML, or unvalidated inbound data was found.
- State updates create new objects/maps/arrays; no existing store records are mutated.
- All owned implementation files remain below 800 lines; the wizard was refactored into bounded source-probe, request, mapping, stage, and footer units.
- `git diff --check` passes.

## Files

- `src/types/qecDataProtocol.ts`
- `src/services/qecDataClient.ts` and tests
- `src/stores/qecQueryStore.ts` and tests
- `src/stores/qecJobStore.ts` and tests
- `src/components/qec/import/`
- `src/components/qec/workbench/QecSourcesPanel.tsx`
- `src/components/qec/workbench/QecWorkbenchTray.tsx`
- `src/components/qec/workbench/QecWorkbench.test.tsx`
- `src/components/qec/workbench/qecWorkbench.css`
