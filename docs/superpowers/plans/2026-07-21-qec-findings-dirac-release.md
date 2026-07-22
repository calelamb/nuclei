# QEC Findings, Dirac, and Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn QEC investigation state into reproducible scientific evidence, give Dirac bounded evidence-aware research tools, migrate existing QEC work safely, and qualify the unified workbench for release.

**Architecture:** Findings are immutable references to session slices, selections, recipes, and render state; Study snapshots pin reproducible inputs and versions. Reports render from findings instead of screenshots alone. Dirac receives compact typed context and can propose/query/pin through audited tools, while live control remains outside autonomous AI authority. Release gates cover migration, accessibility, security, performance, packaging, and documentation.

**Tech Stack:** React/TypeScript/Zustand/Zod, Python data-engine recipes, Markdown/HTML/SVG/PNG export, Claude API tool use through existing Dirac services, Tauri/Rust, Vitest, pytest, Playwright.

## Global Constraints

- P1–P4 are complete and frozen cross-plan contracts remain source-compatible.
- Findings and reports reference immutable IDs, data hashes, query specs, recipe versions, and viewport state; prose alone is never treated as reproducible evidence.
- Dirac receives bounded summaries and explicit evidence handles, never unrestricted raw captures, secrets, or arbitrary filesystem access.
- Dirac may inspect, explain, compose queries/recipes, and draft findings. It may not autonomously issue live hardware commands.
- Existing QEC projects/campaign files continue to open; migrations create backups and are idempotent.
- Release targets the Nuclei light experience only for this program; no dark-blue QEC variant is introduced.

---

### Task 1: Define immutable Finding records and evidence restoration

**Files:**
- Create: `schemas/qec-data/v1/finding.schema.json`
- Create: `schemas/qec-data/v1/fixtures/minimal-finding.json`
- Create: `src/types/qecFinding.ts`
- Create: `src/stores/qecFindingsStore.ts`
- Create: `src/stores/qecFindingsStore.test.ts`
- Create: `src/services/qecFindingService.ts`
- Create: `src/services/qecFindingService.test.ts`
- Create: `kernel/tests/test_finding_schema.py`

**Interfaces:**
- Consumes: Study/session/dataset refs, Research Selection, query specs, recipe outputs, panel viewport state.
- Produces: immutable `QecFinding` revisions and deterministic evidence restoration requests.

- [ ] **Step 1: Write failing schema and restoration tests**

```ts
it('restores evidence by immutable refs without copying mutable store state', async () => {
  const finding = makeFinding({ selection: detectorRef('session:1', 12) });
  const restored = await restoreFinding(finding);
  expect(restored.selection).toEqual(finding.selection);
  expect(restored.selection).not.toBe(finding.selection);
});
```

- [ ] **Step 2: Run and observe missing-model failures**

Run: `cd kernel && pytest tests/test_finding_schema.py -q && cd .. && npm test -- src/stores/qecFindingsStore.test.ts src/services/qecFindingService.test.ts`

- [ ] **Step 3: Implement append-only revisions and integrity checks**

```ts
export interface QecFinding {
  id: string;
  revision: number;
  title: string;
  claim: string;
  evidence: readonly QecEvidenceRef[];
  createdAt: string;
  supersedes?: string;
}
```

Edits create revisions. Evidence restore verifies content hashes and returns `available`, `stale`, or `missing` per reference with repair guidance; it never silently substitutes a newer dataset.

- [ ] **Step 4: Verify tamper, missing-source, revision, and round-trip cases**

Run: `cd kernel && pytest tests/test_finding_schema.py -q && cd .. && npm test -- src/stores/qecFindingsStore.test.ts src/services/qecFindingService.test.ts`

- [ ] **Step 5: Commit**

```bash
git add schemas/qec-data/v1/finding.schema.json schemas/qec-data/v1/fixtures/minimal-finding.json kernel/tests/test_finding_schema.py src/types/qecFinding.ts src/stores/qecFindingsStore.ts src/stores/qecFindingsStore.test.ts src/services/qecFindingService.ts src/services/qecFindingService.test.ts
git commit -m "feat: capture reproducible QEC findings"
```

### Task 2: Build the Findings Shelf and evidence composer

**Files:**
- Create: `src/components/qec/findings/FindingsShelf.tsx`
- Create: `src/components/qec/findings/FindingCard.tsx`
- Create: `src/components/qec/findings/FindingComposer.tsx`
- Create: `src/components/qec/findings/EvidenceChip.tsx`
- Create: `src/components/qec/findings/FindingsShelf.test.tsx`
- Create: `src/components/qec/findings/FindingComposer.test.tsx`
- Modify: `src/components/qec/workbench/QecInspector.tsx`
- Modify: `src/layout/qecPanelRegistry.ts`

**Interfaces:**
- Consumes: Finding service, current selection, visible panels, recipe results.
- Produces: pinned evidence cards, claim drafting, restoration, revision history, and drag/reorder within a report outline.

- [ ] **Step 1: Write failing capture-from-selection test**

```tsx
it('captures selection, filters, viewport, and provenance into a finding draft', async () => {
  render(<FindingComposer />);
  await userEvent.click(screen.getByRole('button', { name: 'Add current evidence' }));
  expect(screen.getByText(/detector 12/i)).toBeVisible();
  expect(screen.getByText(/recipe version/i)).toBeVisible();
});
```

- [ ] **Step 2: Run and observe missing-component failure**

Run: `npm test -- src/components/qec/findings/FindingsShelf.test.tsx src/components/qec/findings/FindingComposer.test.tsx`

- [ ] **Step 3: Implement the light evidence workspace**

Cards use white surfaces, pale-blue selection, compact provenance chips, visible evidence health, claim text, tags, and one-click restore. Use purposeful motion only when a card is pinned or restored. Invalid evidence stays visible with repair actions instead of disappearing.

- [ ] **Step 4: Verify keyboard reorder, revision compare, and missing evidence**

Run: `npm test -- src/components/qec/findings/FindingsShelf.test.tsx src/components/qec/findings/FindingComposer.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/components/qec/findings src/components/qec/workbench/QecInspector.tsx src/layout/qecPanelRegistry.ts
git commit -m "feat: add QEC findings shelf"
```

### Task 3: Add Study snapshots and reproducibility manifests

**Files:**
- Create: `schemas/qec-study/v1/snapshot.schema.json`
- Create: `kernel/qec_data/snapshots.py`
- Create: `kernel/tests/test_study_snapshots.py`
- Create: `src/types/qecSnapshotManifest.ts`
- Create: `src/services/qecSnapshotService.ts`
- Create: `src/services/qecSnapshotService.test.ts`
- Create: `src/components/qec/findings/SnapshotDialog.tsx`
- Create: `src/components/qec/findings/SnapshotDialog.test.tsx`

**Interfaces:**
- Consumes: Study manifest, source hashes, schemas, adapter/engine/decoder versions, recipe parameters, findings.
- Produces: portable snapshot manifest plus referenced/copied artifacts according to an explicit export policy.

- [ ] **Step 1: Write failing deterministic-manifest tests**

```python
def test_snapshot_manifest_is_stable_across_file_enumeration_order(tmp_path: Path) -> None:
    assert build_snapshot(study_a(tmp_path)).content_hash == build_snapshot(study_b(tmp_path)).content_hash
```

- [ ] **Step 2: Run and observe missing-snapshot failure**

Run: `cd kernel && pytest tests/test_study_snapshots.py -q && cd .. && npm test -- src/services/qecSnapshotService.test.ts src/components/qec/findings/SnapshotDialog.test.tsx`

- [ ] **Step 3: Implement canonical ordering and export policies**

Policies are `manifest-only`, `include-derived`, and `portable-copy`. Show estimated size, licenses/paths requiring attention, omitted secrets, and missing artifacts before export. Atomic creation writes to a staging directory, validates, then renames.

- [ ] **Step 4: Verify idempotence, interruption recovery, and import**

Run: `cd kernel && pytest tests/test_study_snapshots.py -q && cd .. && npm test -- src/services/qecSnapshotService.test.ts src/components/qec/findings/SnapshotDialog.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add schemas/qec-study/v1/snapshot.schema.json kernel/qec_data/snapshots.py kernel/tests/test_study_snapshots.py src/types/qecSnapshotManifest.ts src/services/qecSnapshotService.ts src/services/qecSnapshotService.test.ts src/components/qec/findings/SnapshotDialog.tsx src/components/qec/findings/SnapshotDialog.test.tsx
git commit -m "feat: snapshot reproducible QEC studies"
```

### Task 4: Version the recipe registry and reproducible runner

**Files:**
- Create: `kernel/qec_data/recipes/registry.py`
- Create: `kernel/qec_data/recipes/runner.py`
- Create: `kernel/qec_data/recipes/builtin.py`
- Create: `kernel/tests/test_recipe_registry.py`
- Create: `kernel/tests/test_recipe_runner.py`
- Create: `src/types/qecRecipe.ts`
- Create: `src/components/qec/recipes/RecipeLauncher.tsx`
- Create: `src/components/qec/recipes/RecipeLauncher.test.tsx`

**Interfaces:**
- Consumes: canonical datasets, typed parameter schemas, execution tier.
- Produces: content-addressed recipe jobs and result manifests usable by Findings and reports.

- [ ] **Step 1: Write failing identity and validation tests**

```python
def test_recipe_id_changes_when_code_or_parameters_change() -> None:
    first = recipe_identity('lambda-fit', '1.0.0', {'min_distance': 3}, code_hash='a')
    assert first != recipe_identity('lambda-fit', '1.0.0', {'min_distance': 5}, code_hash='a')
    assert first != recipe_identity('lambda-fit', '1.0.0', {'min_distance': 3}, code_hash='b')
```

- [ ] **Step 2: Run and observe missing-runner failure**

Run: `cd kernel && pytest tests/test_recipe_registry.py tests/test_recipe_runner.py -q && cd .. && npm test -- src/components/qec/recipes/RecipeLauncher.test.tsx`

- [ ] **Step 3: Implement built-ins through the same registry API**

Register threshold fit, Lambda fit, decoder comparison, cohort comparison, Error Atlas aggregation, Diff Peel, calibration correlation, and incident summary. Validate parameters before scheduling; results include input hashes, code/version, warnings, target, timings, and output hashes.

- [ ] **Step 4: Verify cache hits, cancellation, invalid parameters, and unavailable inputs**

Run: `cd kernel && pytest tests/test_recipe_registry.py tests/test_recipe_runner.py -q --cov=qec_data.recipes --cov-fail-under=80 && cd .. && npm test -- src/components/qec/recipes/RecipeLauncher.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add kernel/qec_data/recipes kernel/tests/test_recipe_registry.py kernel/tests/test_recipe_runner.py src/types/qecRecipe.ts src/components/qec/recipes
git commit -m "feat: version QEC analysis recipes"
```

### Task 5: Generate evidence-bound research reports

**Files:**
- Create: `src/services/qecReportService.ts`
- Create: `src/services/qecReportService.test.ts`
- Create: `src/components/qec/reports/ReportComposer.tsx`
- Create: `src/components/qec/reports/ReportComposer.test.tsx`
- Create: `src/components/qec/reports/reportTemplate.ts`
- Create: `src/components/qec/reports/exportRenderers.ts`
- Create: `src/components/qec/reports/exportRenderers.test.ts`
- Create: `src-tauri/src/commands/qec_export.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: ordered findings, snapshot manifest, selected export format.
- Produces: Markdown + assets, self-contained HTML, SVG/PNG figures, CSV/Parquet tables, and print/PDF-ready HTML.

- [ ] **Step 1: Write failing provenance-footnote and filename-safety tests**

```ts
it('renders every evidence reference with a reproducibility footnote', () => {
  const report = renderMarkdown(reportFixture);
  expect(report).toContain('Data hash:');
  expect(report).toContain('Recipe: lambda-fit@1.0.0');
});
```

- [ ] **Step 2: Run and observe missing-export failure**

Run: `npm test -- src/services/qecReportService.test.ts src/components/qec/reports/ReportComposer.test.tsx src/components/qec/reports/exportRenderers.test.ts && cd src-tauri && cargo test qec_export`

- [ ] **Step 3: Implement safe deterministic export**

Escape Markdown/HTML, sanitize filenames, deny path traversal, inline only bounded assets, and write atomically. Every figure has title, axes/units, selection/filter summary, data hash, recipe version, and accessible description. PDF-ready output uses the light print stylesheet; direct PDF generation is not required for this wave.

- [ ] **Step 4: Verify snapshots, injection cases, export round-trip, and print layout**

Run: `npm test -- src/services/qecReportService.test.ts src/components/qec/reports/ReportComposer.test.tsx src/components/qec/reports/exportRenderers.test.ts && cd src-tauri && cargo test qec_export`

- [ ] **Step 5: Commit**

```bash
git add src/services/qecReportService.ts src/services/qecReportService.test.ts src/components/qec/reports src-tauri/src/commands/qec_export.rs src-tauri/src/lib.rs
git commit -m "feat: export evidence-bound QEC reports"
```

### Task 6: Build a bounded QEC context assembler for Dirac

**Files:**
- Create: `src/services/qecDiracContextAssembler.ts`
- Create: `src/services/qecDiracContextAssembler.test.ts`
- Create: `src/types/diracQecContext.ts`
- Modify: `src/services/qecContext.ts`
- Modify: `src/hooks/useDirac.ts`
- Modify: `src/components/dirac/DiracSidePanel.tsx`

**Interfaces:**
- Consumes: active Study, current selection, evidence handles, visible panel summaries, job/alert state.
- Produces: size-bounded typed `DiracQecContext` with provenance and explicit omissions.

- [ ] **Step 1: Write failing size, redaction, and priority tests**

```ts
it('keeps selected evidence and omits raw syndrome arrays when over budget', () => {
  const context = assembleQecContext(largeFixture, { maxBytes: 32_000 });
  expect(context.selection).toBeDefined();
  expect(context.omissions).toContain('raw_syndrome_batches');
  expect(JSON.stringify(context).length).toBeLessThanOrEqual(32_000);
});
```

- [ ] **Step 2: Run and observe missing-assembler failure**

Run: `npm test -- src/services/qecDiracContextAssembler.test.ts`

- [ ] **Step 3: Implement deterministic context prioritization**

Prioritize user selection, active errors/alerts, finding evidence, recipe summaries, then general Study metadata. Redact source credentials, absolute paths outside the project display policy, user annotations marked private, and raw capture payloads. Include stable handles Dirac tools can query deliberately.

- [ ] **Step 4: Verify no-secret fixtures, byte budgets, and Learn-mode regression**

Run: `npm test -- src/services/qecDiracContextAssembler.test.ts src/services/qecContext.test.ts src/hooks/useDirac.test.ts src/components/dirac`

- [ ] **Step 5: Commit**

```bash
git add src/services/qecDiracContextAssembler.ts src/services/qecDiracContextAssembler.test.ts src/types/diracQecContext.ts src/services/qecContext.ts src/hooks/useDirac.ts src/components/dirac/DiracSidePanel.tsx
git commit -m "feat: ground Dirac in bounded QEC evidence"
```

### Task 7: Add evidence-aware Dirac research tools

**Files:**
- Create: `src/services/agent/qecToolExecutors.ts`
- Create: `src/services/agent/qecToolExecutors.test.ts`
- Modify: `src/services/agent/tools.ts`
- Modify: `src/services/agent/tools.test.ts`
- Modify: `src/services/agent/toolExecutors.ts`
- Modify: `src/services/agent/toolExecutors.test.ts`
- Create: `src/components/dirac/QecToolApprovalCard.tsx`
- Create: `src/components/dirac/QecToolApprovalCard.test.tsx`
- Modify: `src/components/qec/findings/FindingComposer.tsx`

**Interfaces:**
- Consumes: evidence handles and user-approved typed tool inputs.
- Produces: read-only queries, cohort drafts, recipe jobs, finding drafts, and panel navigation.

- [ ] **Step 1: Write failing authority-boundary tests**

```ts
it('does not register live hardware control as a Dirac tool', () => {
  const names = AGENT_TOOLS.map((tool) => tool.name);
  expect(names).not.toContain('execute_hardware_command');
  expect(names).toEqual(expect.arrayContaining(['query_qec_evidence', 'draft_qec_finding']));
});
```

- [ ] **Step 2: Run and observe missing-tool failure**

Run: `npm test -- src/services/agent/qecToolExecutors.test.ts src/services/agent/tools.test.ts src/components/dirac/QecToolApprovalCard.test.tsx`

- [ ] **Step 3: Implement schema-validated tools and approvals**

Tools: `query_qec_evidence`, `explain_qec_selection`, `draft_qec_cohort`, `run_qec_recipe`, `draft_qec_finding`, `open_qec_panel`. Read-only bounded queries may execute immediately; recipe jobs and saved findings show a compact approval card with parameters/cost target. All results cite evidence IDs and uncertainty.

- [ ] **Step 4: Verify prompt-injection fixtures, malformed inputs, cancellation, and citations**

Run: `npm test -- src/services/agent/qecToolExecutors.test.ts src/services/agent/tools.test.ts src/services/agent/toolExecutors.test.ts src/components/dirac/QecToolApprovalCard.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/services/agent/qecToolExecutors.ts src/services/agent/qecToolExecutors.test.ts src/services/agent/tools.ts src/services/agent/tools.test.ts src/services/agent/toolExecutors.ts src/services/agent/toolExecutors.test.ts src/components/dirac/QecToolApprovalCard.tsx src/components/dirac/QecToolApprovalCard.test.tsx src/components/qec/findings/FindingComposer.tsx
git commit -m "feat: add Dirac QEC research tools"
```

### Task 8: Migrate existing QEC projects and preserve old workflows

**Files:**
- Create: `src/services/qecMigrationService.ts`
- Create: `src/services/qecMigrationService.test.ts`
- Create: `src/components/qec/migration/QecMigrationDialog.tsx`
- Create: `src/components/qec/migration/QecMigrationDialog.test.tsx`
- Create: `kernel/qec_data/migrations/v1.py`
- Create: `kernel/tests/test_qec_migration_v1.py`
- Modify: `src/components/qec/QecAnalysisView.tsx`
- Modify: `src/services/qecCampaignRunner.ts`

**Interfaces:**
- Consumes: legacy `qec_campaign` experiment YAML, sinter CSV, noise YAML, and existing Research layout state.
- Produces: Study manifest, imported canonical sessions, preserved originals/backups, and migration report.

- [ ] **Step 1: Write failing idempotent migration tests**

```python
def test_migration_is_idempotent_and_preserves_originals(tmp_path: Path) -> None:
    first = migrate_legacy_project(copy_legacy_fixture(tmp_path))
    second = migrate_legacy_project(first.study_root)
    assert second.changed is False
    assert first.original_hashes == second.original_hashes
```

- [ ] **Step 2: Run and observe missing-migration failure**

Run: `cd kernel && pytest tests/test_qec_migration_v1.py -q && cd .. && npm test -- src/services/qecMigrationService.test.ts src/components/qec/migration/QecMigrationDialog.test.tsx`

- [ ] **Step 3: Implement preview, backup, atomic migration, and compatibility routes**

The dialog lists planned files, storage cost, mappings, warnings, and rollback path. Keep the legacy analysis view available until a migration succeeds; opening old content never mutates it implicitly. Campaign semantics and noise definitions remain byte-preserved in the backup.

- [ ] **Step 4: Verify cancel, retry after interruption, rollback, and legacy open**

Run: `cd kernel && pytest tests/test_qec_migration_v1.py -q && cd .. && npm test -- src/services/qecMigrationService.test.ts src/components/qec/migration/QecMigrationDialog.test.tsx src/components/qec/QecAnalysisView.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/services/qecMigrationService.ts src/services/qecMigrationService.test.ts src/components/qec/migration kernel/qec_data/migrations kernel/tests/test_qec_migration_v1.py src/components/qec/QecAnalysisView.tsx src/services/qecCampaignRunner.ts
git commit -m "feat: migrate legacy QEC research projects"
```

### Task 9: Harden the light UI for accessibility and visual consistency

**Files:**
- Modify: `src/styles/qecTokens.ts`
- Modify: `src/components/qec/workbench/qecWorkbench.css`
- Create: `tests/e2e/qec-accessibility.spec.ts`
- Create: `tests/e2e/qec-visual-regression.spec.ts`
- Create: `tests/e2e/qec-keyboard-workflow.spec.ts`
- Modify: `playwright.config.ts`
- Create: `src/components/qec/README.md`

**Interfaces:**
- Consumes: all Build/Analyze/Observe panels and dialogs.
- Produces: WCAG 2.1 AA evidence, stable light-theme screenshots, keyboard workflows, reduced-motion behavior, and responsive minimum sizes.

- [ ] **Step 1: Add failing critical-screen snapshots and keyboard journeys**

```ts
test('Failure Microscope is operable without a pointer', async ({ page }) => {
  await openFixtureStudy(page, 'simulation-failures');
  await page.keyboard.press('Control+Alt+M');
  await expect(page.getByRole('heading', { name: 'Failure Microscope' })).toBeFocused();
});
```

- [ ] **Step 2: Run baselines and review failures manually**

Run: `npx playwright test tests/e2e/qec-accessibility.spec.ts tests/e2e/qec-keyboard-workflow.spec.ts tests/e2e/qec-visual-regression.spec.ts --project=chromium`

- [ ] **Step 3: Fix contrast, focus, density, resize, and reduced motion issues**

Cover empty/loading/error/stale/live-degraded states at 1280×800 and 1600×1000. Use text/icon redundancy for color semantics, minimum hit targets, visible focus rings, table alternatives for canvases, and no motion-required information. Do not add a dark-blue screenshot suite.

- [ ] **Step 4: Run accessibility and visual gates**

Run: `npx playwright test tests/e2e/qec-accessibility.spec.ts tests/e2e/qec-keyboard-workflow.spec.ts tests/e2e/qec-visual-regression.spec.ts --project=chromium`

Expected: PASS after human approval of intentional baseline changes; never auto-update snapshots to hide regressions.

- [ ] **Step 5: Commit**

```bash
git add src/styles/qecTokens.ts src/components/qec/workbench/qecWorkbench.css tests/e2e/qec-accessibility.spec.ts tests/e2e/qec-visual-regression.spec.ts tests/e2e/qec-keyboard-workflow.spec.ts playwright.config.ts src/components/qec/README.md
git commit -m "fix: harden QEC workbench accessibility"
```

### Task 10: Run security, performance, and packaging qualification

**Files:**
- Create: `docs/security/qec-threat-model.md`
- Create: `docs/release/qec-performance-budget.md`
- Create: `src/services/qecPackageVerifier.ts`
- Create: `src/services/qecPackageVerifier.test.ts`
- Create: `src-tauri/tests/qec_capabilities.rs`
- Modify: `.github/workflows/build.yml`
- Modify: `.github/workflows/kernel-tests.yml`
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: complete unified QEC workbench.
- Produces: explicit threat mitigations, measured performance budgets, dependency/package checks, and platform CI gates.

- [ ] **Step 1: Write failing packaging/capability checks**

```js
it('does not package test captures, credentials, or unrestricted sidecars', async () => {
  const report = await inspectQecPackage(process.argv[2]);
  expect(report.forbiddenFiles).toEqual([]);
  expect(report.unscopedCapabilities).toEqual([]);
});
```

- [ ] **Step 2: Run the checks against a development bundle**

Run: `npm test -- src/services/qecPackageVerifier.test.ts && npm run build && cd src-tauri && cargo test --test qec_capabilities`

- [ ] **Step 3: Document and enforce security/performance boundaries**

Threat-model untrusted imports, decompression bombs, path traversal, malformed Arrow/Parquet, SQL injection, websocket token theft, plugin/adapter trust, live command replay, report injection, and data exfiltration through Dirac. Measure launch, first tile, pan/zoom frame budget, memory under bounded fixtures, import throughput, reconnect, and report export on representative hardware; record observed baselines before setting regression thresholds.

- [ ] **Step 4: Run dependency, secret, package, and performance gates**

Run:

```bash
npm audit --audit-level=high
cd kernel && python -m pip check && pytest -q
cd ../src-tauri && cargo audit && cargo test
cd .. && rg -n --hidden --glob '!node_modules/**' --glob '!target/**' "(api[_-]?key|secret|token)\\s*[:=]\\s*['\"][^'\"]+['\"]" src kernel src-tauri
npm test -- src/services/qecPackageVerifier.test.ts && npm run build
```

Expected: no unreviewed high/critical vulnerabilities, no embedded secrets, and measured budgets recorded with environment details. Review grep matches manually because variable names are expected.

- [ ] **Step 5: Commit**

```bash
git add docs/security/qec-threat-model.md docs/release/qec-performance-budget.md src/services/qecPackageVerifier.ts src/services/qecPackageVerifier.test.ts src-tauri/tests/qec_capabilities.rs .github/workflows/build.yml .github/workflows/kernel-tests.yml package.json src-tauri/tauri.conf.json
git commit -m "chore: qualify QEC release security and performance"
```

### Task 11: Complete end-to-end release evidence and researcher documentation

**Files:**
- Create: `tests/e2e/qec-unified-research-loop.spec.ts`
- Create: `tests/e2e/qec-dirac-findings.spec.ts`
- Create: `docs/release/qec-workbench-checklist.md`
- Create: `docs-site/src/content/docs/research/findings-and-reports.mdx`
- Create: `docs-site/src/content/docs/research/dirac-for-qec.mdx`
- Create: `docs-site/src/content/docs/research/qec-study-format.mdx`
- Modify: `docs-site/src/content/docs/research/qec-workbench.mdx`
- Modify: `docs-site/src/content/docs/reference/protocol-changelog.mdx`

**Interfaces:**
- Consumes: the entire five-plan program.
- Produces: executable acceptance journeys, migration/recovery guidance, demo Study, release checklist, and user-facing documentation.

- [ ] **Step 1: Write the complete acceptance journeys**

```ts
test('simulation researcher goes from circuit to shareable finding', async ({ page }) => {
  await openFixtureStudy(page, 'surface-code-study');
  await runCampaign(page);
  await collectDiagnosticSamples(page);
  await openFailureMicroscope(page);
  await pinCurrentEvidence(page);
  await expectExportedReport(page).toContainText('Data hash:');
});
```

Add a hardware journey: import capture → map schema → align calibration → replay → inspect anomaly → freeze incident → export evidence. Add a live journey with synthetic source → disconnect/recover → alert → inspect → user-approved incident freeze.

- [ ] **Step 2: Run acceptance journeys and capture real failures**

Run: `npx playwright test tests/e2e/qec-unified-research-loop.spec.ts tests/e2e/qec-dirac-findings.spec.ts tests/e2e/qec-hardware-replay.spec.ts tests/e2e/qec-live-observatory.spec.ts --project=chromium`

- [ ] **Step 3: Write task-oriented docs and release checklist**

Document Build/Analyze/Observe, data ownership, canonical schemas, adapter trust, unknown truth, diagnostic sampling vs sinter aggregates, compute tiers, reproducibility, evidence citations, Dirac boundaries, migration, recovery, and accessibility shortcuts. Include a small versioned demo Study using synthetic/non-sensitive data.

- [ ] **Step 4: Run the full program gate**

Run:

```bash
npm test -- --run
npm run test:coverage -- --run
npm run test:e2e
npm run build
cd kernel && pytest -q --cov=. --cov-fail-under=80
cd ../src-tauri && cargo test && cargo clippy --all-targets --all-features -- -D warnings
```

Expected: PASS, 80%+ frontend and kernel coverage, no CRITICAL/HIGH review findings, and all checklist evidence linked. If coverage configuration scopes generated/vendor files differently, document the denominator; do not lower the 80% requirement.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/qec-unified-research-loop.spec.ts tests/e2e/qec-dirac-findings.spec.ts docs/release/qec-workbench-checklist.md docs-site/src/content/docs/research/findings-and-reports.mdx docs-site/src/content/docs/research/dirac-for-qec.mdx docs-site/src/content/docs/research/qec-study-format.mdx docs-site/src/content/docs/research/qec-workbench.mdx docs-site/src/content/docs/reference/protocol-changelog.mdx
git commit -m "docs: complete QEC workbench release evidence"
```
