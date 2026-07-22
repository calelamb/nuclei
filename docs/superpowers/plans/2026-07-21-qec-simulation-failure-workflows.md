# QEC Simulation and Failure Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete Stim/sinter edit-to-evidence loop with synchronized circuit views, Campaign Center, targeted diagnostic sampling, Failure Microscope, Cohorts, Error Atlas, and Diff Peel.

**Architecture:** Existing QEC panels become selection-aware registered instruments driven by one playback cursor. Campaign rows are normalized into canonical sessions; aggregate points remain aggregate, while a new seedable diagnostic-sampling path materializes individual syndrome/decode records for the Failure Microscope. Derived analyses are versioned recipes over canonical data.

**Tech Stack:** React/TypeScript/Zustand, D3/SVG/Canvas, Python Stim/sinter/PyMatching, P2 QEC Data Engine, Vitest, pytest, Playwright.

## Global Constraints

- P1 and P2 are complete.
- Preserve existing `qec_decode_sample` behavior and add diagnostic sampling through new additive messages.
- Never imply sinter aggregate CSV contains shot-level syndrome traces.
- A selected aggregate point presents `Collect diagnostic samples` before opening shot-level analysis.
- All synchronized panels derive from stable `QecEntityRef` IDs and one `QecPlaybackStore`; no cross-panel mutation or effect chains.
- Canvas/SVG views must remain interactive at existing detector-graph fixture sizes and degrade through semantic zoom for larger graphs.

---

### Task 1: Add shared QEC playback and panel-selection adapters

**Files:**
- Create: `src/types/qecPlayback.ts`
- Create: `src/stores/qecPlaybackStore.ts`
- Create: `src/stores/qecPlaybackStore.test.ts`
- Create: `src/components/qec/selection/qecSelectionAdapters.ts`
- Create: `src/components/qec/selection/qecSelectionAdapters.test.ts`

**Interfaces:**
- Consumes: P1 Research Selection and existing `QecSnapshot`/`CircuitSnapshot`.
- Produces: `QecPlaybackCursor`, `useQecPlaybackStore`, `tickRef`, `detectorRef`, `campaignPointRef`, and validated cursor ranges.

- [ ] **Step 1: Write failing playback-boundary tests**

```ts
it('clamps playback when a new circuit has fewer ticks', () => {
  useQecPlaybackStore.setState({ cursor: { domain: 'tick', value: 40 }, playing: false, speed: 1 });
  useQecPlaybackStore.getState().setBounds({ domain: 'tick', min: 0, max: 12 });
  expect(useQecPlaybackStore.getState().cursor).toEqual({ domain: 'tick', value: 12 });
});
```

- [ ] **Step 2: Run and observe missing store failure**

Run: `npm test -- src/stores/qecPlaybackStore.test.ts src/components/qec/selection/qecSelectionAdapters.test.ts`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement immutable playback and stable-ref helpers**

```ts
export type QecPlaybackDomain = 'tick' | 'round' | 'ns';
export interface QecPlaybackCursor { domain: QecPlaybackDomain; value: number }
export interface QecPlaybackBounds { domain: QecPlaybackDomain; min: number; max: number }

interface QecPlaybackState {
  cursor: QecPlaybackCursor;
  bounds: QecPlaybackBounds;
  playing: boolean;
  speed: 0.25 | 0.5 | 1 | 2 | 4;
  setBounds(bounds: QecPlaybackBounds): void;
  seek(cursor: QecPlaybackCursor): void;
  step(delta: -1 | 1): void;
  play(): void;
  pause(): void;
}
```

Panel helpers construct IDs as `tick:<index>`, `detector:<index>`, and `campaign:<strong_id>` with the active session/dataset IDs.

- [ ] **Step 4: Verify clamp, stepping, circuit reset, and ref identity**

Run: `npm test -- src/stores/qecPlaybackStore.test.ts src/components/qec/selection/qecSelectionAdapters.test.ts`

Expected: PASS without mutating prior cursor/bounds values.

- [ ] **Step 5: Commit**

```bash
git add src/types/qecPlayback.ts src/stores/qecPlaybackStore.ts src/stores/qecPlaybackStore.test.ts src/components/qec/selection
git commit -m "feat: synchronize QEC playback and selection"
```

### Task 2: Upgrade Timeline into a synchronized instrument

**Files:**
- Modify: `src/components/qec/QecTimelinePanel.tsx`
- Create: `src/components/qec/timeline/TimelineViewport.tsx`
- Create: `src/components/qec/timeline/timelineModel.ts`
- Create: `src/components/qec/timeline/timelineModel.test.ts`
- Modify: `src/components/qec/qecPanels.test.tsx`

**Interfaces:**
- Consumes: playback cursor, Research Selection, current snapshots.
- Produces: semantic timeline model, click/keyboard tick selection, repeated-block groups, and source navigation events.

- [ ] **Step 1: Write failing semantic-zoom tests**

```ts
it('groups distant ticks and preserves the selected tick', () => {
  const model = buildTimelineModel(gates, { start: 0, end: 1000, pixels: 300 }, 417);
  expect(model.columns.length).toBeLessThanOrEqual(300 / 6);
  expect(model.columns.some((column) => column.tickRange.includes(417))).toBe(true);
});
```

- [ ] **Step 2: Run and observe missing model failure**

Run: `npm test -- src/components/qec/timeline/timelineModel.test.ts`

Expected: FAIL because `buildTimelineModel` is missing.

- [ ] **Step 3: Extract pure model and render accessible viewport**

```ts
export interface TimelineColumn {
  id: string;
  tickRange: readonly [number, number];
  gates: readonly TimelineGate[];
  noiseCount: number;
  detectorCount: number;
  containsSelection: boolean;
}

export function buildTimelineModel(
  gates: readonly TimelineGate[],
  viewport: { start: number; end: number; pixels: number },
  selectedTick: number | null,
): readonly TimelineColumn[] { /* deterministic binning and exact selected column */ }
```

`TimelineViewport` exposes buttons for grouped columns, `aria-label="Ticks 400 through 423, 12 gates, 2 detectors"`, and Enter/Space selection. Clicking sets playback and Research Selection once through event handlers.

- [ ] **Step 4: Verify current fixtures and synchronized selection**

Run: `npm test -- src/components/qec/timeline/timelineModel.test.ts src/components/qec/qecPanels.test.tsx`

Expected: PASS; existing noise probability hover remains available.

- [ ] **Step 5: Commit**

```bash
git add src/components/qec/QecTimelinePanel.tsx src/components/qec/timeline src/components/qec/qecPanels.test.tsx
git commit -m "feat: synchronize the QEC timeline"
```

### Task 3: Upgrade Lattice and Detector Graph selection/overlays

**Files:**
- Modify: `src/components/qec/CodeLatticePanel.tsx`
- Modify: `src/components/qec/DetectorGraphPanel.tsx`
- Modify: `src/components/qec/DetectorGraphCanvas.tsx`
- Create: `src/components/qec/lattice/latticeOverlay.ts`
- Create: `src/components/qec/lattice/latticeOverlay.test.ts`
- Create: `src/components/qec/detector/graphViewport.ts`
- Create: `src/components/qec/detector/graphViewport.test.ts`

**Interfaces:**
- Consumes: shared playback/selection and existing geometry.
- Produces: `LatticeOverlay`, semantic `GraphViewport`, focus isolation, keyboard-neighborhood table, and overlay-mode selector.

- [ ] **Step 1: Write failing overlay and semantic-zoom tests**

```ts
it('focuses a detector neighborhood without dropping selected logical edges', () => {
  const viewport = buildGraphViewport(layout, { detectorIds: [42], radius: 2 }, overlay);
  expect(viewport.nodes.map((node) => node.id)).toContain(42);
  expect(viewport.edges.filter((edge) => edge.logical).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run and observe failure**

Run: `npm test -- src/components/qec/lattice/latticeOverlay.test.ts src/components/qec/detector/graphViewport.test.ts`

Expected: FAIL because pure overlay builders do not exist.

- [ ] **Step 3: Implement derived overlays and event-only store updates**

Overlay modes are `structure`, `probability`, `observed-frequency`, `decoder-correction`, and `calibration-correlation`. Unsupported modes render a disabled option with an explanation, never fabricated values.

Add `onQubitSelect`, `onDetectorSelect`, and `onEdgeSelect` callbacks to presentational canvases. A hidden-but-keyboard-accessible neighborhood table lists detector ID, degree, coordinates, fired state, and adjacent edge probabilities.

- [ ] **Step 4: Verify canvas performance and accessibility**

Run: `npm test -- src/components/qec/lattice src/components/qec/detector src/components/qec/qecPanels.test.tsx && npm run build`

Expected: PASS; 5,000-edge fixture redraw stays below 16 ms median in the browser performance harness.

- [ ] **Step 5: Commit**

```bash
git add src/components/qec/CodeLatticePanel.tsx src/components/qec/DetectorGraphPanel.tsx src/components/qec/DetectorGraphCanvas.tsx src/components/qec/lattice src/components/qec/detector
git commit -m "feat: link lattice and detector investigations"
```

### Task 4: Normalize campaign output into canonical sessions

**Files:**
- Create: `kernel/qec_data/adapters/nuclei_campaign.py`
- Create: `kernel/tests/qec_data/test_nuclei_campaign_adapter.py`
- Modify: `src/services/qecCampaignRunner.ts`
- Modify: `src/services/qecCampaignRunner.test.ts`
- Modify: `src/hooks/useQecCampaignRun.ts`

**Interfaces:**
- Consumes: current sinter `stats.csv`, campaign manifest, P2 storage/adapter API.
- Produces: `nuclei-campaign@1` adapter and a canonical simulation Session reference recorded in the campaign run manifest.

- [ ] **Step 1: Write failing back-compat normalization tests**

```python
def test_existing_campaign_directory_imports_without_rewriting_stats(campaign_dir) -> None:
    before = (campaign_dir / 'stats.csv').read_bytes()
    session = import_campaign_directory(campaign_dir)
    assert session.kind is SessionKind.SIMULATION_CAMPAIGN
    assert (campaign_dir / 'stats.csv').read_bytes() == before
```

- [ ] **Step 2: Run and observe missing adapter failure**

Run: `cd kernel && pytest tests/qec_data/test_nuclei_campaign_adapter.py -q`

Expected: FAIL because the adapter is missing.

- [ ] **Step 3: Implement additive normalization hook**

On completed/partial campaign writes, request Data Engine import of the run directory. Add only `qec_data_session_id` and `qec_data_schema_version` to a new sidecar `qec-session-ref.json`; do not modify sinter CSV or old manifest schemas.

- [ ] **Step 4: Verify old and new campaigns**

Run: `cd kernel && pytest tests/qec_data/test_nuclei_campaign_adapter.py -q && cd .. && npm test -- src/services/qecCampaignRunner.test.ts`

Expected: PASS; Data Engine absence leaves current campaign behavior intact with a visible non-fatal normalization warning.

- [ ] **Step 5: Commit**

```bash
git add kernel/qec_data/adapters/nuclei_campaign.py kernel/tests/qec_data/test_nuclei_campaign_adapter.py src/services/qecCampaignRunner.ts src/services/qecCampaignRunner.test.ts src/hooks/useQecCampaignRun.ts
git commit -m "feat: index QEC campaigns as canonical sessions"
```

### Task 5: Build the Campaign Center preflight and live allocation UI

**Files:**
- Create: `src/components/qec/campaign/CampaignCenter.tsx`
- Create: `src/components/qec/campaign/CampaignPreflight.tsx`
- Create: `src/components/qec/campaign/CampaignAllocationView.tsx`
- Create: `src/components/qec/campaign/campaignPreflight.ts`
- Create: `src/components/qec/campaign/campaignPreflight.test.ts`
- Create: `src/components/qec/campaign/CampaignCenter.test.tsx`
- Modify: `src/components/qec/QecAnalysisView.tsx`

**Interfaces:**
- Consumes: `QecCampaignExperiment`, progress/store rows, project environment.
- Produces: `CampaignPreflightResult`, launch guard, incremental allocation visualization, pause/resume/cancel/clone/branch actions.

- [ ] **Step 1: Write failing preflight math and launch-guard tests**

```ts
it('computes tasks and blocks launch when a dependency is missing', () => {
  const result = buildCampaignPreflight(spec, { installed: new Set(['stim', 'sinter']) }, 8);
  expect(result.tasks).toBe(60);
  expect(result.blockers).toContain('Decoder pymatching is not installed');
  expect(result.canLaunch).toBe(false);
});
```

- [ ] **Step 2: Run and observe missing components**

Run: `npm test -- src/components/qec/campaign`

Expected: FAIL because Campaign Center does not exist.

- [ ] **Step 3: Implement preflight and progressive scientific state**

```ts
export interface CampaignPreflightResult {
  tasks: number;
  estimatedStorageBytes: number;
  workerCount: number;
  blockers: readonly string[];
  warnings: readonly string[];
  canLaunch: boolean;
}
```

Allocation cells display shots, errors, Wilson interval width, stopping reason, and active/complete state. `pause` appears only if the kernel capability is added and tested; otherwise use Cancel with resumable partial results and label it honestly.

- [ ] **Step 4: Verify campaign lifecycle and no aggregate/shot confusion**

Run: `npm test -- src/components/qec/campaign src/components/qec/qecAnalysisPanels.test.tsx`

Expected: PASS; aggregate points never expose `Open shot` until diagnostic samples exist.

- [ ] **Step 5: Commit**

```bash
git add src/components/qec/campaign src/components/qec/QecAnalysisView.tsx
git commit -m "feat: add the QEC Campaign Center"
```

### Task 6: Upgrade campaign analyses into bounded linked panels

**Files:**
- Modify: `src/components/qec/ThresholdPanel.tsx`
- Modify: `src/components/qec/DecoderWorkbench.tsx`
- Create: `src/components/qec/analysis/DistanceNoiseHeatmap.tsx`
- Create: `src/components/qec/analysis/ConvergencePlot.tsx`
- Create: `src/components/qec/analysis/DecoderParetoPlot.tsx`
- Create: `src/components/qec/analysis/analysisModels.ts`
- Create: `src/components/qec/analysis/analysisModels.test.ts`
- Modify: `src/types/qecStats.ts`
- Modify: `src/types/qecStats.test.ts`

**Interfaces:**
- Consumes: campaign canonical session/query tiles.
- Produces: selectable `CampaignPointRef`, fit diagnostics, heatmap, convergence, Pareto, and table alternatives.

- [ ] **Step 1: Write failing analysis-model tests**

```ts
it('marks overlapping confidence intervals as inconclusive', () => {
  expect(compareLogicalRates(rate(0.01, 0.008, 0.012), rate(0.009, 0.007, 0.011)).status).toBe('inconclusive');
});
```

- [ ] **Step 2: Run and observe missing models**

Run: `npm test -- src/components/qec/analysis/analysisModels.test.ts src/types/qecStats.test.ts`

Expected: FAIL because comparison/fit diagnostic models are missing.

- [ ] **Step 3: Implement pure chart models and linked selections**

Every mark includes `entityRef`, `sampleCount`, interval, source row IDs, and ground-truth status. Chart click selects the campaign point; Shift-click adds it to comparison scope. Exports include every displayed filter and confidence method.

- [ ] **Step 4: Verify statistics, keyboard marks, tables, and exports**

Run: `npm test -- src/components/qec/analysis src/components/qec/qecAnalysisPanels.test.tsx src/types/qecStats.test.ts`

Expected: PASS with no claim of improvement for overlapping intervals.

- [ ] **Step 5: Commit**

```bash
git add src/components/qec/ThresholdPanel.tsx src/components/qec/DecoderWorkbench.tsx src/components/qec/analysis src/types/qecStats.ts src/types/qecStats.test.ts
git commit -m "feat: expand linked QEC campaign analysis"
```

### Task 7: Add targeted diagnostic sampling

**Files:**
- Create: `kernel/qec/failure_samples.py`
- Create: `kernel/tests/test_qec_failure_samples.py`
- Modify: `kernel/server.py`
- Modify: `src/types/quantum.ts`
- Create: `src/services/qecFailureSampler.ts`
- Create: `src/services/qecFailureSampler.test.ts`
- Modify: `src/hooks/useKernel.ts`

**Interfaces:**
- Consumes: materialized circuit, decoder, diagnostic seed/count, selected campaign point.
- Produces: additive `qec_failure_sample_start/progress/result` messages and canonical shot/decode records.

- [ ] **Step 1: Write failing seeded known-answer test**

```python
def test_failure_sampling_is_seeded_and_keeps_failures(repetition_circuit) -> None:
    first = collect_diagnostic_samples(repetition_circuit, 'pymatching', seed=7, max_shots=500, max_failures=5)
    second = collect_diagnostic_samples(repetition_circuit, 'pymatching', seed=7, max_shots=500, max_failures=5)
    assert first == second
    assert len(first.failures) <= 5
    assert first.sampled_shots <= 500
```

- [ ] **Step 2: Run and observe missing sampler**

Run: `cd kernel && pytest tests/test_qec_failure_samples.py -q`

Expected: FAIL because sampler is missing.

- [ ] **Step 3: Implement bounded seedable collection and additive protocol**

```python
@dataclass(frozen=True, slots=True)
class DiagnosticSampleOptions:
    seed: int
    max_shots: int
    max_failures: int
    batch_size: int = 1024
```

The result records fired detectors, observable truth, decoder prediction, correction edges, logical-failure verdict, and latency. Write results through the P2 storage API; return only session/dataset IDs and a bounded failure summary to React.

- [ ] **Step 4: Verify cancellation, caps, progress, and existing protocol fixtures**

Run: `cd kernel && pytest tests/test_qec_failure_samples.py tests/test_docs_fixtures.py -q && cd .. && npm test -- src/services/qecFailureSampler.test.ts`

Expected: PASS; old clients ignore new messages.

- [ ] **Step 5: Commit**

```bash
git add kernel/qec/failure_samples.py kernel/tests/test_qec_failure_samples.py kernel/server.py src/types/quantum.ts src/services/qecFailureSampler.ts src/services/qecFailureSampler.test.ts src/hooks/useKernel.ts
git commit -m "feat: collect QEC diagnostic failure samples"
```

### Task 8: Build the Failure Microscope

**Files:**
- Create: `src/components/qec/failure/FailureMicroscope.tsx`
- Create: `src/components/qec/failure/SyndromeReplay.tsx`
- Create: `src/components/qec/failure/DecoderTrace.tsx`
- Create: `src/components/qec/failure/FailureContext.tsx`
- Create: `src/components/qec/failure/FailureComparisonRail.tsx`
- Create: `src/components/qec/failure/failureModel.ts`
- Create: `src/components/qec/failure/failureModel.test.ts`
- Create: `src/components/qec/failure/FailureMicroscope.test.tsx`

**Interfaces:**
- Consumes: `shot-window`/`graph-overlay` tiles, playback, Research Selection.
- Produces: `FailureCase`, syndrome replay, decoder trace, circuit/calibration context slots, and compare rail.

- [ ] **Step 1: Write failing scientific-state tests**

```tsx
it('labels hardware truth as unavailable instead of corrected/failed', () => {
  render(<FailureMicroscope failure={hardwareFailure({ truthStatus: 'unavailable' })} />);
  expect(screen.getByText('Ground truth unavailable')).toBeVisible();
  expect(screen.queryByText('Confirmed logical failure')).toBeNull();
});
```

- [ ] **Step 2: Run and observe missing Microscope failure**

Run: `npm test -- src/components/qec/failure`

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement linked replay and exact truth-state language**

```ts
export type TruthStatus = 'known' | 'observed' | 'inferred' | 'unavailable';
export interface FailureCase {
  shotRef: QecEntityRef;
  firedDetectorIds: readonly number[];
  predictedLogicalFlips: readonly boolean[];
  actualLogicalFlips: readonly boolean[] | null;
  truthStatus: TruthStatus;
  correctionEdgeIds: readonly string[];
  decoderLatencyNs: number | null;
}
```

Syndrome replay drives shared round cursor. Decoder trace uses existing graph geometry. Comparison rail queries nearest corrected/failing samples using an explicit similarity metric displayed in the Inspector.

- [ ] **Step 4: Verify keyboard replay, selection sync, and partial contexts**

Run: `npm test -- src/components/qec/failure && npm run build`

Expected: PASS for simulation, unavailable hardware truth, missing calibration, decoder timeout, and empty-neighbor cases.

- [ ] **Step 5: Commit**

```bash
git add src/components/qec/failure
git commit -m "feat: add the QEC Failure Microscope"
```

### Task 9: Add Cohorts, Error Atlas, and Diff Peel

**Files:**
- Create: `src/types/qecCohort.ts`
- Create: `src/types/qecCohort.test.ts`
- Create: `kernel/qec_data/recipes/syndrome_clusters.py`
- Create: `kernel/qec_data/recipes/error_atlas.py`
- Create: `kernel/tests/qec_data/test_failure_recipes.py`
- Create: `src/components/qec/cohorts/CohortBuilder.tsx`
- Create: `src/components/qec/atlas/ErrorAtlas.tsx`
- Create: `src/components/qec/compare/DiffPeel.tsx`
- Create: `src/components/qec/compare/DiffPeel.test.tsx`

**Interfaces:**
- Consumes: canonical queries and selections.
- Produces: versioned `QecCohortDefinition`, deterministic cluster/atlas recipes, and reusable `DiffPeel` compound component.

- [ ] **Step 1: Write failing deterministic recipe and Diff Peel tests**

```python
def test_cluster_recipe_is_stable_for_same_dataset(cluster_fixture) -> None:
    a = cluster_syndromes(cluster_fixture, metric='jaccard', seed=11)
    b = cluster_syndromes(cluster_fixture, metric='jaccard', seed=11)
    assert a == b
```

```tsx
it('supports keyboard adjustment of the comparison divider', () => {
  render(<DiffPeel before={<div>A</div>} after={<div>B</div>} label="Circuit revisions" />);
  const separator = screen.getByRole('separator', { name: 'Circuit revisions' });
  fireEvent.keyDown(separator, { key: 'ArrowRight' });
  expect(separator).toHaveAttribute('aria-valuenow', '55');
});
```

- [ ] **Step 2: Run and observe failures**

Run: `cd kernel && pytest tests/qec_data/test_failure_recipes.py -q && cd .. && npm test -- src/types/qecCohort.test.ts src/components/qec/compare/DiffPeel.test.tsx`

Expected: FAIL because recipes/types/components are missing.

- [ ] **Step 3: Implement immutable cohort definitions and bounded aggregates**

Cohorts store canonical filters and parent dataset IDs, never copied rows. Error Atlas tiles include detector/edge/path counts, time coverage, confidence, and recipe version. Diff Peel accepts two render slots and a controlled percentage; it does not clone scientific state.

- [ ] **Step 4: Verify reproducibility and visual interactions**

Run: `cd kernel && pytest tests/qec_data/test_failure_recipes.py -q && cd .. && npm test -- src/types/qecCohort.test.ts src/components/qec/cohorts src/components/qec/atlas src/components/qec/compare`

Expected: PASS; clusters are labeled as derived and correlations as non-causal.

- [ ] **Step 5: Commit**

```bash
git add src/types/qecCohort.ts src/types/qecCohort.test.ts kernel/qec_data/recipes kernel/tests/qec_data/test_failure_recipes.py src/components/qec/cohorts src/components/qec/atlas src/components/qec/compare
git commit -m "feat: add QEC cohorts and error atlas"
```

### Task 10: Verify and document the simulation research loop

**Files:**
- Create: `tests/e2e/qec-simulation-investigation.spec.ts`
- Modify: `docs-site/src/content/docs/research/qec-studio.mdx`
- Create: `docs-site/src/content/docs/research/failure-microscope.mdx`
- Modify: `docs-site/src/content/docs/research/campaigns.mdx`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: complete simulation workflow.
- Produces: Wave 3 demo, screenshots, and user-facing scientific caveats.

- [ ] **Step 1: Write the end-to-end workflow first**

```ts
test('@qec edit campaign outlier failure decoder cohort', async ({ page }) => {
  await openQecFixtureProject(page);
  await runTinySurfaceCampaign(page);
  await page.getByRole('button', { name: /d=5.*p=0.01/i }).click();
  await page.getByRole('button', { name: 'Collect diagnostic samples' }).click();
  await expect(page.getByRole('region', { name: 'Failure Microscope' })).toBeVisible();
  await page.getByRole('button', { name: 'Compare decoder' }).click();
  await page.getByRole('button', { name: 'Save as cohort' }).click();
  await expect(page.getByRole('treeitem', { name: /cohort/i })).toBeVisible();
});
```

- [ ] **Step 2: Run and observe incomplete-flow failure**

Run: `npx playwright test tests/e2e/qec-simulation-investigation.spec.ts --project=chromium`

Expected: FAIL until all panel navigation and fixture wiring is complete.

- [ ] **Step 3: Complete docs and screenshots**

Document aggregate-versus-shot distinction, diagnostic seeding, truth status, confidence interpretation, cohort filters, cluster metric, Error Atlas limitations, and export lineage.

- [ ] **Step 4: Run Wave 3 gate**

Run:

```bash
npm test
npm run lint
npm run build
npx playwright test tests/e2e/qec-simulation-investigation.spec.ts --project=chromium
cd kernel && pytest tests/test_qec_campaign.py tests/test_qec_failure_samples.py tests/qec_data -q --cov=qec --cov=qec_data --cov-fail-under=80
```

Expected: PASS; screenshot review confirms the approved white/light-blue design and the full edit→Finding-ready investigation path.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/qec-simulation-investigation.spec.ts docs-site/src/content/docs/research/qec-studio.mdx docs-site/src/content/docs/research/failure-microscope.mdx docs-site/src/content/docs/research/campaigns.mdx CHANGELOG.md
git commit -m "docs: ship the QEC simulation investigation loop"
```
