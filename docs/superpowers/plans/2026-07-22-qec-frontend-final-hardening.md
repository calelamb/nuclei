# QEC Frontend Final Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five remaining frontend hardening findings by isolating QEC state per project, validating streamed query identity, recovering explicitly from dead data-engine connections, making persisted workbench customization real, and gating the supported QEC frontend flow in CI.

**Architecture:** Project ownership is enforced at the Zustand boundary with a monotonically increasing scope epoch, while the workbench coordinates bounded best-effort cancellation against the old client before disconnecting it. The protocol client carries semantic expectations beside each pending query and publishes immutable disconnect notifications. Workbench panel resolution combines preset membership with user pins, and small accessible separator components write the already-persisted dimensions. CI exercises Node 24 unit tests and the real tagged QEC Playwright path with its Python data dependencies.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Testing Library, Playwright, GitHub Actions, Python QEC data engine dependencies.

## Global Constraints

- Preserve unrelated and concurrent changes, especially kernel adapter/tests and currently dirty import tests.
- Use immutable Zustand updates and explicit error states; no in-place collection mutation.
- Keep new functions focused and files below the project size limits.
- Write and observe each focused test failing before its implementation change.
- Project handoff must invalidate UI state synchronously; cancellation is best-effort and cannot block the new project from becoming active.
- Do not add the optional 10M-row stress gate to PR CI.

---

## Task 1: Project-scoped job, query, and catalog lifecycle

**Files:**

- Modify: `src/stores/qecJobStore.ts`
- Modify: `src/stores/qecJobStore.test.ts`
- Modify: `src/stores/qecQueryStore.ts`
- Modify: `src/stores/qecQueryStore.test.ts`
- Modify: `src/stores/qecSessionCatalogStore.ts`
- Modify: `src/stores/qecSessionCatalogStore.test.ts`
- Modify: `src/components/qec/workbench/QecSourcesPanel.tsx`
- Modify: `src/components/qec/workbench/QecWorkbenchTray.tsx`
- Modify: `src/components/qec/workbench/QecWorkbench.test.tsx`

- [ ] Add RED store tests proving that `setProjectScope()` clears import/job/query/catalog state, increments ownership, and ignores late callbacks from the old project.

- [ ] Add a RED workbench test that switches project roots while an import/query is active and proves the old source/job/tile cannot render or invoke the replacement project's client.

- [ ] Run the focused tests and confirm failures identify missing project-scope behavior:

```bash
npx vitest run src/stores/qecJobStore.test.ts src/stores/qecQueryStore.test.ts src/stores/qecSessionCatalogStore.test.ts src/components/qec/workbench/QecWorkbench.test.tsx
```

- [ ] Add `projectRoot: string | null` and a monotonic scope epoch to job/query state. Implement `setProjectScope(projectRoot)` as an immutable, synchronous reset. Capture both values in asynchronous work and discard updates unless both still match.

- [ ] Require project ownership when opening an import source. Store `projectRoot` on job records and filter all workbench actions to the active project.

- [ ] Expose immutable snapshots of active import job IDs and query request IDs so the tray can attempt cancellation with the client that created them.

- [ ] Make catalog scoping explicit and synchronously invalidate the catalog during project handoff while retaining its existing request-version stale-response protection.

- [ ] In the tray, capture old operation IDs, switch all stores to the new project immediately, then start `Promise.allSettled()` cancellation against the old client and disconnect it when attempts settle. Never await this cleanup before initializing the new project.

- [ ] Run the focused tests again and confirm they pass.

## Task 2: Semantic query correlation and post-auth disconnect recovery

**Files:**

- Modify: `src/services/qecDataClient.ts`
- Modify: `src/services/qecDataClient.test.ts`
- Modify: `src/components/qec/workbench/QecWorkbenchTray.tsx`
- Modify: `src/components/qec/workbench/QecWorkbench.test.tsx`

- [ ] Add RED client tests proving a query rejects with `invalid_response` when a matching `requestId` returns the wrong `datasetId` or tile kind.

- [ ] Add RED client tests proving subscribers receive a post-auth disconnect notification and that unsubscribe prevents future delivery.

- [ ] Add a RED workbench test proving a post-auth disconnect clears the stale client, surfaces a researcher-readable engine error, and provides an explicit Retry control that makes exactly one new connection attempt per activation.

- [ ] Run the focused tests and observe the intended failures:

```bash
npx vitest run src/services/qecDataClient.test.ts src/components/qec/workbench/QecWorkbench.test.tsx
```

- [ ] Extend pending query metadata with the expected dataset ID and tile kind. Validate both before accepting progress/tile frames; reject the request through the existing normalized `invalid_response` path on mismatch.

- [ ] Add an immutable `subscribeDisconnect(listener): () => void` API. Notify listeners only after an authenticated connection dies; continue rejecting all pending operations and clearing socket/auth state.

- [ ] Subscribe from the active workbench connection. On disconnect, drop the dead client, stop loading, expose an error, and leave recovery user-driven. Make Retry increment a connection-attempt token once per click and clean up old subscriptions before intentional disconnects.

- [ ] Run the focused tests again and confirm they pass.

## Task 3: Real pinned-panel behavior

**Files:**

- Modify: `src/layout/qecPanelRegistry.ts`
- Modify: `src/layout/qecPanelRegistry.test.ts`
- Modify: `src/components/qec/workbench/InvestigationCanvas.tsx`
- Modify: `src/components/qec/workbench/QecResearchInspector.tsx`
- Modify: `src/components/qec/workbench/QecSourcesPanel.tsx`
- Modify: `src/components/qec/workbench/QecWorkbenchTray.tsx`
- Modify: `src/components/qec/workbench/QecWorkbench.test.tsx`
- Modify: `src/styles/qec-workbench.css`

- [ ] Add RED registry tests proving resolved panels are the ordered union of preset panels and valid persisted pins, scoped to the requested zone without duplicates.

- [ ] Add RED workbench tests proving a panel can be pinned/unpinned with an `aria-pressed` control and remains visible after moving to a preset that normally omits it.

- [ ] Run the focused tests and confirm failure:

```bash
npx vitest run src/layout/qecPanelRegistry.test.ts src/components/qec/workbench/QecWorkbench.test.tsx
```

- [ ] Implement a pure registry resolver that combines preset IDs with validated pinned IDs in registry order.

- [ ] Use the resolver in every workbench zone. Add compact Pin/Unpin controls with descriptive accessible names, visible focus treatment, and store-backed immutable updates.

- [ ] Run the focused tests again and confirm they pass.

## Task 4: Accessible persisted panel sizing

**Files:**

- Create: `src/components/qec/workbench/QecWorkbenchResizeHandle.tsx`
- Create: `src/components/qec/workbench/QecWorkbenchResizeHandle.test.tsx`
- Modify: `src/components/qec/workbench/QecWorkbench.tsx`
- Modify: `src/components/qec/workbench/QecWorkbench.test.tsx`
- Modify: `src/styles/qec-workbench.css`
- Modify: `docs-site/src/content/docs/research/qec-workbench.mdx`

- [ ] Add RED component tests for a labeled separator with correct role/orientation/value attributes, bounded 16px Arrow increments, Home/End bounds, and pointer-drag clamping.

- [ ] Add a RED workbench persistence test proving source, inspector, and tray resize controls update the Zustand dimensions that survive persistence hydration.

- [ ] Run the focused tests and confirm failure:

```bash
npx vitest run src/components/qec/workbench/QecWorkbenchResizeHandle.test.tsx src/components/qec/workbench/QecWorkbench.test.tsx src/services/qecWorkbenchPersistence.test.ts src/services/qecWorkbenchPersistenceSession.test.ts
```

- [ ] Implement the reusable separator with immutable event handling, cleanup for window listeners, orientation-aware direction, min/max clamping, and keyboard semantics.

- [ ] Place separators between sources/canvas, canvas/inspector, and canvas/tray. Hide unavailable controls at responsive breakpoints or while the tray/inspector is collapsed. Add high-contrast `:focus-visible` styling and a comfortably enlarged pointer target where layout permits.

- [ ] Update the researcher documentation to describe actual Pin/Unpin and keyboard/pointer resizing behavior, including persistence and responsive limits.

- [ ] Run the focused tests again and confirm they pass.

## Task 5: Node 24 QEC frontend PR gate

**Files:**

- Create: `src/ci/qecFrontendWorkflow.test.ts`
- Create: `.github/workflows/qec-frontend.yml`
- Modify: `docs-site/src/content/docs/research/qec-data-import.mdx`

- [ ] Add a RED workflow contract test requiring Node 24, `npm ci`, Vitest, Chromium installation, Python 3.12, the real QEC engine dependencies, and `npm run test:e2e -- --grep @qec`; also assert the 10M-row stress environment flag is absent.

- [ ] Run the contract test and confirm it fails because the workflow is missing:

```bash
npx vitest run src/ci/qecFrontendWorkflow.test.ts
```

- [ ] Add a pull-request workflow with separate frontend-unit and qec-e2e jobs. Install `pyarrow`, `duckdb`, `jsonschema`, `websockets`, and `stim` for the real QEC engine path; install Playwright Chromium with system dependencies.

- [ ] Document project-switch isolation and explicit data-engine Retry behavior in the QEC import guide.

- [ ] Run the contract test again and confirm it passes.

## Task 6: Full verification and handoff

**Files:**

- Review all files changed by Tasks 1–5.

- [ ] Run all frontend unit tests:

```bash
npm test
```

- [ ] Run the real tagged QEC browser flow:

```bash
npm run test:e2e -- --grep @qec
```

- [ ] Run production build, lint, and whitespace validation:

```bash
npm run build
npm run lint
git diff --check
```

- [ ] Review the diff for project leakage, stale client use, listener cleanup, input bounds, accessibility, dead persisted state, hardcoded secrets, and accidental concurrent-file edits. Fix every CRITICAL or HIGH issue and rerun affected gates.

- [ ] Stage only owned frontend/protocol/workbench/docs/CI files and commit with a conventional message:

```bash
git commit -m "fix: harden QEC frontend project lifecycle"
```

- [ ] Report exact test counts/results, the commit hash, and any environment-only limitations.
