# QEC Frontend Final Hardening Design

## Goal

Close the final frontend risks in the Phase 2 Unified QEC Data Platform without changing the canonical data engine: isolate asynchronous state by project, enforce semantic query correlation, make engine disconnects recoverable, fulfill the workbench persistence contract, and make the real frontend acceptance path a pull-request gate.

## Project lifecycle and stale ownership

The QEC job and query stores will carry an explicit project scope plus a monotonic scope epoch. Changing scope immediately clears visible source, job, query, and catalog state and invalidates callbacks captured by the prior epoch. Late frames, promise settlement, and declined cancellation from the old project therefore cannot repopulate the new project.

`QecWorkbenchTray` owns the authenticated client and project handoff. Before releasing the old client it will issue bounded, best-effort cancellation for active import and query request IDs. Handoff never waits for cancellation: local epoch invalidation happens synchronously, and the old client is disconnected when the cancellation attempts settle. The new project can connect independently. Job actions render only when their recorded scope matches the active client scope.

## Protocol correlation and engine recovery

Each pending query will retain the requested dataset ID and tile kind. A correlated `tile` frame must match both values; otherwise the request rejects with `invalid_response`. Existing request-ID, job-kind, job-ID, phase, cancellation-target, frame-size, and schema validation remain unchanged.

`QecDataClient` will expose an immutable subscribe/unsubscribe boundary for post-authentication disconnect notification. The workbench engine hook will remove a disconnected client immediately and show the existing light error notice with an accessible **Retry engine** action. Retry starts one explicit connection attempt; repeated automatic reconnect loops are prohibited. Cleanup and project handoff cannot publish stale disconnect state because both are guarded by the hook's ownership generation.

## Workbench persistence made observable

Schema-1 persistence remains compatible. Panel resolution will include panels visible in the current preset plus valid pinned panel IDs, in registry order. Canvas instruments expose accessible pin toggles with `aria-pressed`; pinned panels remain present across preset changes and restore through the existing per-project, per-Study persistence session.

Sources, Inspector, and Tray receive visible resize separators. Each separator:

- uses `role="separator"`, the correct orientation, value bounds, and current value;
- supports pointer/mouse dragging;
- supports arrow-key increments and Home/End bounds;
- has a visible focus ring and a 44-pixel interactive hit target where layout permits;
- delegates clamping to the existing immutable Zustand setters; and
- disappears at responsive breakpoints where its panel becomes an overlay or stacked region.

The documentation will describe pinning, mouse resizing, keyboard resizing, responsive behavior, and exact persistence scope without claiming unavailable rearrangement.

## CI acceptance

A dedicated frontend workflow will run on pull requests and pushes to `main` using Node 24. One job runs the full Vitest suite. A second installs Chromium and only the Python dependencies needed by the real QEC data engine, then runs the `@qec` Playwright specs across the configured desktop and laptop Chromium projects. It will not enable the opt-in 10-million-record memory acceptance gate.

## Error handling and accessibility

Project cancellation and disconnect cleanup are best-effort and never block navigation. User-initiated retry failures remain visible as alerts. Pin and resize controls use native buttons/separators, keyboard operation, semantic pressed/value state, and the existing light white/pale-blue visual language. Reduced-motion rules continue to cover the added controls.

## Test strategy

All behavioral changes follow RED/GREEN TDD:

1. Store and workbench tests reproduce cross-project source/job/query leakage and stale completion.
2. Client tests send a schema-valid but semantically mismatched query tile.
3. Client/workbench tests disconnect after authentication and exercise one explicit retry.
4. Registry/workbench/persistence tests prove pinned-panel resolution and keyboard resizing.
5. A workflow contract test verifies Node 24, Vitest, Chromium, QEC dependencies, and the `@qec` Playwright command.

Focused suites run after each cycle. Final verification includes the relevant frontend suite, full Vitest, production build, scoped ESLint, `git diff --check`, and the available real Playwright gate.
