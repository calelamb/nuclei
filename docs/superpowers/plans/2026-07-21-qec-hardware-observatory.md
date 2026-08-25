# QEC Hardware Replay and Live Observatory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give hardware teams a vendor-neutral path from recorded syndrome and calibration imports to synchronized replay, then to durable live monitoring with safe control-plane actions and tiered local/remote scale.

**Architecture:** Hardware adapters normalize topology, syndrome, calibration, decode, and provenance records into P2 canonical sessions. Replay uses the same selection and Failure Microscope contracts as simulation. A supervised ingestion service records live batches before analysis, applies bounded backpressure, and feeds an observatory from durable query tiles. Commands are allowlisted, authenticated, audited, and never enter a device's hard real-time loop.

**Tech Stack:** Python 3.11+, PyArrow/Parquet/DuckDB, websockets, optional Arrow Flight, React/TypeScript/Zustand, D3 Canvas/SVG, Tauri/Rust, Zod/jsonschema, Vitest, pytest, Playwright.

## Global Constraints

- P1–P3 are complete and their Study, Session, Dataset, Selection, query-tile, playback, and Failure Microscope contracts remain source-compatible.
- Offline/replay ships before live ingestion. Every live acceptance test must first pass against a deterministic synthetic adapter.
- Record normalized live data durably before publishing it to analysis subscribers; acknowledgements never claim durability before the atomic write succeeds.
- Nuclei is an observability and control-plane client. Device feedback, decoder deadlines, FPGA links, and safety interlocks remain in vendor systems.
- Live commands are opt-in, capability-scoped, allowlisted, confirmed for consequential actions, and appended to a tamper-evident audit log.
- UI uses the Nuclei light palette: white and pale-blue surfaces, dark readable text, cyan/blue data accents, and semantic amber/red only for warnings or failures.
- Laptop, workstation, and cluster tiers share canonical schemas and query semantics; tier changes affect execution location and quotas, not scientific meaning.

---

### Task 1: Extend canonical hardware topology and truth contracts

**Files:**
- Create: `schemas/qec-data/v1/topology.schema.json`
- Create: `schemas/qec-data/v1/fixtures/minimal-hardware-session.json`
- Modify: `schemas/qec-data/v1/session.schema.json`
- Modify: `schemas/qec-data/v1/calibration-record.schema.json`
- Modify: `kernel/qec_data/models.py`
- Modify: `src/types/qecData.ts`
- Create: `kernel/tests/test_qec_hardware_schemas.py`
- Modify: `src/types/qecData.schema.test.ts`

**Interfaces:**
- Consumes: canonical schema `qec-data/1.0.0`.
- Produces: optional topology snapshots, hardware clock metadata, calibration validity windows, and explicit logical-truth status (`known`, `unknown`, `derived`).

- [ ] **Step 1: Write failing cross-language fixture tests**

```python
def test_hardware_fixture_distinguishes_unknown_truth() -> None:
    session = load_fixture('minimal-hardware-session.json')
    assert session['logical_truth']['status'] == 'unknown'
    assert session['topology_ref'].startswith('topology:')
```

- [ ] **Step 2: Run and observe missing-schema failure**

Run: `cd kernel && pytest tests/test_qec_hardware_schemas.py -q && cd .. && npm test -- src/types/qecData.schema.test.ts`

Expected: FAIL because topology and truth-status fields do not exist.

- [ ] **Step 3: Add additive optional fields and immutable models**

```ts
export type LogicalTruth =
  | { status: 'known'; source: 'hardware' | 'reference'; value: boolean }
  | { status: 'derived'; recipeId: string; value: boolean }
  | { status: 'unknown'; reason?: string };
```

Topology includes stable node/edge IDs, coordinate systems, role labels, and effective time. Calibration values include units and `[valid_from, valid_until)`; missing truth must never be coerced to success.

- [ ] **Step 4: Verify old and hardware fixtures together**

Run: `cd kernel && pytest tests/test_qec_data_schemas.py tests/test_qec_hardware_schemas.py -q && cd .. && npm test -- src/types/qecData.schema.test.ts`

Expected: PASS, including the original P2 fixtures unchanged.

- [ ] **Step 5: Commit**

```bash
git add schemas/qec-data/v1 kernel/qec_data/models.py kernel/tests/test_qec_hardware_schemas.py src/types/qecData.ts src/types/qecData.schema.test.ts
git commit -m "feat: model QEC hardware topology and truth"
```

### Task 2: Implement recorded-hardware adapters and mapping recipes

**Files:**
- Create: `kernel/qec_data/adapters/qeci_capture.py`
- Create: `kernel/qec_data/adapters/qiskit_experiments.py`
- Create: `kernel/qec_data/adapters/mapping_recipe.py`
- Create: `kernel/tests/fixtures/qeci/minimal_capture/`
- Create: `kernel/tests/fixtures/qiskit_experiments/minimal_experiment.json`
- Create: `kernel/tests/test_hardware_adapters.py`
- Modify: `src/components/qec/import/QecImportWizard.tsx`
- Create: `src/components/qec/import/HardwareMappingStep.tsx`
- Create: `src/components/qec/import/HardwareMappingStep.test.tsx`

**Interfaces:**
- Consumes: copied/referenced recorded captures, user-supplied mapping recipes, and P2 adapter SDK.
- Produces: canonical offline sessions with immutable source hashes and reusable `*.qec-map.yaml` recipes.

- [ ] **Step 1: Write failing adapter and mapping-preview tests**

```python
def test_qeci_probe_does_not_modify_capture(tmp_path: Path) -> None:
    source = copy_fixture('qeci/minimal_capture', tmp_path)
    before = tree_hash(source)
    result = QeciCaptureAdapter().probe(source)
    assert result.confidence > 0.8
    assert tree_hash(source) == before
```

```tsx
it('blocks import until syndrome columns and time units are mapped', () => {
  render(<HardwareMappingStep preview={previewWithoutUnits} />);
  expect(screen.getByRole('button', { name: /import/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run and observe missing-adapter failures**

Run: `cd kernel && pytest tests/test_hardware_adapters.py -q && cd .. && npm test -- src/components/qec/import/HardwareMappingStep.test.tsx`

- [ ] **Step 3: Implement read-only probes, explicit mappings, and provenance**

Map detector/syndrome columns, shot/round/device timestamps, basis/observable fields, calibration references, and topology IDs. Auto-suggestions are previews only; users confirm ambiguous bit order, units, and truth semantics. Qiskit Experiments support targets serialized `ExperimentData` result/metadata exports, not arbitrary pickle execution.

- [ ] **Step 4: Verify compliance and corrupt-input errors**

Run: `cd kernel && pytest tests/test_hardware_adapters.py tests/test_adapter_compliance.py -q && cd .. && npm test -- src/components/qec/import/HardwareMappingStep.test.tsx`

Expected: PASS with actionable quarantine reports for malformed timestamps, inconsistent widths, and missing required mappings.

- [ ] **Step 5: Commit**

```bash
git add kernel/qec_data/adapters kernel/tests/fixtures/qeci kernel/tests/fixtures/qiskit_experiments kernel/tests/test_hardware_adapters.py src/components/qec/import
git commit -m "feat: import recorded QEC hardware data"
```

### Task 3: Align calibrations and score hardware data quality

**Files:**
- Create: `kernel/qec_data/calibration/alignment.py`
- Create: `kernel/qec_data/calibration/quality.py`
- Create: `kernel/tests/test_calibration_alignment.py`
- Create: `src/types/qecCalibration.ts`
- Create: `src/components/qec/hardware/CalibrationRibbon.tsx`
- Create: `src/components/qec/hardware/CalibrationRibbon.test.tsx`
- Modify: `src/components/qec/failure/FailureMicroscope.tsx`

**Interfaces:**
- Consumes: session timebase, topology snapshots, calibration validity windows.
- Produces: per-record calibration references, gap/overlap diagnostics, freshness scores, and a visible calibration ribbon.

- [ ] **Step 1: Write failing interval-boundary and quality tests**

```python
def test_alignment_uses_half_open_windows() -> None:
    records = align_calibrations([shot_at(20)], [calibration(10, 20), calibration(20, 30)])
    assert records[0].calibration_id == 'calibration:20-30'
```

- [ ] **Step 2: Run and observe missing-module failure**

Run: `cd kernel && pytest tests/test_calibration_alignment.py -q && cd .. && npm test -- src/components/qec/hardware/CalibrationRibbon.test.tsx`

- [ ] **Step 3: Implement deterministic alignment and quality reasons**

Quality is a structured result with missing, stale, overlapping, out-of-order, topology-mismatch, and unit-mismatch reasons. The ribbon shows validity windows and gaps; selecting one narrows the shared Research Selection without mutating the session.

- [ ] **Step 4: Verify timezone, boundary, gap, and accessibility behavior**

Run: `cd kernel && pytest tests/test_calibration_alignment.py -q && cd .. && npm test -- src/components/qec/hardware/CalibrationRibbon.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add kernel/qec_data/calibration kernel/tests/test_calibration_alignment.py src/types/qecCalibration.ts src/components/qec/hardware src/components/qec/failure/FailureMicroscope.tsx
git commit -m "feat: align QEC calibration context"
```

### Task 4: Build the Space-Time Syndrome Explorer

**Files:**
- Create: `src/components/qec/hardware/SpaceTimeSyndromeExplorer.tsx`
- Create: `src/components/qec/hardware/SyndromeHeatmapCanvas.tsx`
- Create: `src/components/qec/hardware/spaceTimeModel.ts`
- Create: `src/components/qec/hardware/spaceTimeModel.test.ts`
- Create: `src/components/qec/hardware/SpaceTimeSyndromeExplorer.test.tsx`
- Modify: `src/layout/qecPanelRegistry.ts`

**Interfaces:**
- Consumes: bounded syndrome tiles, playback cursor, topology coordinates, calibration ribbon, Research Selection.
- Produces: detector-by-round heatmap, temporal/lattice brushing, density summaries, and stable selection refs.

- [ ] **Step 1: Write failing level-of-detail tests**

```ts
it('aggregates cells when records outnumber pixels without losing the selection', () => {
  const model = buildSpaceTimeModel(tile, { width: 480, height: 240 }, selectedRef);
  expect(model.cells.length).toBeLessThanOrEqual(480 * 240);
  expect(model.selectionAnchor?.entityRef).toEqual(selectedRef);
});
```

- [ ] **Step 2: Run and observe missing-view failure**

Run: `npm test -- src/components/qec/hardware/spaceTimeModel.test.ts src/components/qec/hardware/SpaceTimeSyndromeExplorer.test.tsx`

- [ ] **Step 3: Implement Canvas data marks with accessible DOM summaries**

Use white/pale-blue framing, perceptually ordered blue density, and red only for confirmed failures. Add zoom/pan, round and detector brushes, reset, keyboard navigation, tooltip pinning, and linked lattice highlighting. Render table summaries and selection announcements for non-visual users.

- [ ] **Step 4: Verify large fixtures and panel registration**

Run: `npm test -- src/components/qec/hardware && npm run test:coverage -- --run`

Expected: no full-record DOM expansion and no tile request above P2 limits.

- [ ] **Step 5: Commit**

```bash
git add src/components/qec/hardware src/layout/qecPanelRegistry.ts
git commit -m "feat: add space-time syndrome explorer"
```

### Task 5: Add deterministic hardware replay

**Files:**
- Create: `src/stores/qecReplayStore.ts`
- Create: `src/stores/qecReplayStore.test.ts`
- Create: `src/components/qec/hardware/ReplayTransport.tsx`
- Create: `src/components/qec/hardware/ReplayTransport.test.tsx`
- Create: `src/hooks/useQecReplay.ts`
- Modify: `src/stores/qecPlaybackStore.ts`
- Modify: `src/components/qec/failure/FailureMicroscope.tsx`

**Interfaces:**
- Consumes: immutable recorded session, query tiles, hardware timestamps.
- Produces: play/pause/seek/speed/step state, reproducible replay bookmarks, and hardware-context Failure Microscope state.

- [ ] **Step 1: Write failing virtual-clock tests**

```ts
it('replays the same timestamp sequence independent of render cadence', () => {
  const a = advanceReplay(fixture, [16, 16, 32], 2);
  const b = advanceReplay(fixture, [64], 2);
  expect(a.cursorNs).toBe(b.cursorNs);
});
```

- [ ] **Step 2: Run and observe missing-store failure**

Run: `npm test -- src/stores/qecReplayStore.test.ts src/components/qec/hardware/ReplayTransport.test.tsx`

- [ ] **Step 3: Implement virtual time and bookmark restoration**

Playback reads recorded timestamps, never wall-clock deltas directly. Bookmarks persist session ID, cursor, selection, filters, calibration window, and visible panels. Failure Microscope labels unknown truth explicitly and shows decoder output separately from confirmed hardware outcome.

- [ ] **Step 4: Verify seek, pause, sparse gaps, and session-switch cancellation**

Run: `npm test -- src/stores/qecReplayStore.test.ts src/components/qec/hardware/ReplayTransport.test.tsx src/components/qec/failure/FailureMicroscope.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/stores/qecReplayStore.ts src/stores/qecReplayStore.test.ts src/components/qec/hardware/ReplayTransport.tsx src/components/qec/hardware/ReplayTransport.test.tsx src/hooks/useQecReplay.ts src/stores/qecPlaybackStore.ts src/components/qec/failure/FailureMicroscope.tsx
git commit -m "feat: replay recorded QEC hardware sessions"
```

### Task 6: Define live-adapter protocol and synthetic source

**Files:**
- Create: `kernel/qec_data/live/protocol.py`
- Create: `kernel/qec_data/adapters/synthetic_live.py`
- Create: `kernel/qec_data/adapters/qeci_live.py`
- Create: `kernel/tests/test_live_adapter_protocol.py`
- Create: `kernel/tests/test_synthetic_live_adapter.py`
- Modify: `kernel/qec_data/adapters/base.py`
- Modify: `docs-site/src/content/docs/reference/qec-adapter-sdk.mdx`

**Interfaces:**
- Consumes: adapter configuration and capability grants.
- Produces: ordered `LiveBatch` envelopes, heartbeats, resumable offsets, source health, and optional declarative command capabilities.

- [ ] **Step 1: Write failing protocol conformance tests**

```python
async def test_reconnect_resumes_after_last_durable_offset() -> None:
    source = SyntheticLiveAdapter(seed=7, disconnect_after=3)
    first = await collect_until_disconnect(source)
    resumed = await collect(source, resume_after=first[-1].offset, count=3)
    assert resumed[0].offset == first[-1].offset + 1
```

- [ ] **Step 2: Run and observe missing-protocol failure**

Run: `cd kernel && pytest tests/test_live_adapter_protocol.py tests/test_synthetic_live_adapter.py -q`

- [ ] **Step 3: Implement async iteration, capability declaration, and QECi mapping**

```python
@dataclass(frozen=True)
class LiveBatch:
    source_id: str
    offset: int
    observed_at_ns: int
    payload: pa.RecordBatch
    calibration_updates: tuple[CalibrationRecord, ...] = ()
```

Adapters cannot receive arbitrary Python callbacks or shell commands. QECi support is isolated behind its optional dependency and maps only documented transport fields.

- [ ] **Step 4: Verify determinism, resume, reorder rejection, and dependency absence**

Run: `cd kernel && pytest tests/test_live_adapter_protocol.py tests/test_synthetic_live_adapter.py tests/test_adapter_compliance.py -q`

- [ ] **Step 5: Commit**

```bash
git add kernel/qec_data/live kernel/qec_data/adapters kernel/tests/test_live_adapter_protocol.py kernel/tests/test_synthetic_live_adapter.py docs-site/src/content/docs/reference/qec-adapter-sdk.mdx
git commit -m "feat: define live QEC adapter protocol"
```

### Task 7: Build durable ingestion, backpressure, and recovery

**Files:**
- Create: `kernel/qec_data/live/ingestion.py`
- Create: `kernel/qec_data/live/checkpoints.py`
- Create: `kernel/qec_data/live/health.py`
- Create: `kernel/tests/test_live_ingestion.py`
- Create: `kernel/tests/test_live_recovery.py`
- Modify: `kernel/qec_data/storage.py`
- Modify: `kernel/qec_data/server.py`

**Interfaces:**
- Consumes: ordered live batches from Task 6.
- Produces: atomic Parquet partitions, durable offsets, bounded subscriber events, health metrics, and restart recovery.

- [ ] **Step 1: Write failing crash/restart and overload tests**

```python
async def test_ack_follows_atomic_commit(tmp_path: Path) -> None:
    engine = ingestion_engine(tmp_path, crash_before_rename=True)
    with pytest.raises(InjectedCrash):
        await engine.ingest(batch(offset=4))
    assert engine.checkpoints.last_durable_offset is None
```

- [ ] **Step 2: Run and observe missing-engine failure**

Run: `cd kernel && pytest tests/test_live_ingestion.py tests/test_live_recovery.py -q`

- [ ] **Step 3: Implement bounded queues and explicit overload policy**

The pipeline validates, stages, fsyncs/renames, advances a checkpoint, then publishes. Configure high/low watermarks; pause resumable sources, disconnect non-resumable sources before memory becomes unbounded, and surface a visible data-gap record. Subscribers receive coalesced invalidations, not every raw shot.

- [ ] **Step 4: Verify duplicate offsets, reorder, disk-full, restart, and slow subscribers**

Run: `cd kernel && pytest tests/test_live_ingestion.py tests/test_live_recovery.py -q --cov=qec_data.live --cov-fail-under=80`

- [ ] **Step 5: Commit**

```bash
git add kernel/qec_data/live kernel/qec_data/storage.py kernel/qec_data/server.py kernel/tests/test_live_ingestion.py kernel/tests/test_live_recovery.py
git commit -m "feat: durably ingest live QEC streams"
```

### Task 8: Build Live Observatory status, alerts, and linked views

**Files:**
- Create: `kernel/qec_data/live/alerts.py`
- Create: `kernel/tests/test_live_alerts.py`
- Create: `src/types/qecLive.ts`
- Create: `src/stores/qecObservatoryStore.ts`
- Create: `src/stores/qecObservatoryStore.test.ts`
- Create: `src/components/qec/observatory/LiveObservatory.tsx`
- Create: `src/components/qec/observatory/HealthStrip.tsx`
- Create: `src/components/qec/observatory/AlertRail.tsx`
- Create: `src/components/qec/observatory/LiveMetricGrid.tsx`
- Create: `src/components/qec/observatory/LiveObservatory.test.tsx`
- Modify: `src/layout/qecPanelRegistry.ts`

**Interfaces:**
- Consumes: ingestion health, bounded metric tiles, calibration events, declarative alert rules.
- Produces: source/lag/rate/durability status, linked live plots, alerts with evidence windows, and incident entry points.

- [ ] **Step 1: Write failing alert-hysteresis and stale-source tests**

```python
def test_alert_hysteresis_prevents_flapping() -> None:
    states = evaluate_series(rule(open_above=0.02, close_below=0.015), [0.019, 0.021, 0.018, 0.014])
    assert states == ['closed', 'open', 'open', 'closed']
```

- [ ] **Step 2: Run and observe missing modules**

Run: `cd kernel && pytest tests/test_live_alerts.py -q && cd .. && npm test -- src/stores/qecObservatoryStore.test.ts src/components/qec/observatory/LiveObservatory.test.tsx`

- [ ] **Step 3: Implement observable health and evidence-bound alerts**

The top health strip always shows connection, durable offset, ingest lag, dropped/gap counts, calibration freshness, and decoder latency. Alerts use minimum duration, hysteresis, severity, cooldown, and a stored query window. Entering Observe preset never hides degraded/dropped state behind animation.

- [ ] **Step 4: Verify reconnect, stale, lag, alert navigation, and keyboard flow**

Run: `cd kernel && pytest tests/test_live_alerts.py -q && cd .. && npm test -- src/stores/qecObservatoryStore.test.ts src/components/qec/observatory/LiveObservatory.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add kernel/qec_data/live/alerts.py kernel/tests/test_live_alerts.py src/types/qecLive.ts src/stores/qecObservatoryStore.ts src/stores/qecObservatoryStore.test.ts src/components/qec/observatory src/layout/qecPanelRegistry.ts
git commit -m "feat: add QEC live observatory"
```

### Task 9: Add safe control-plane commands and incident freeze

**Files:**
- Create: `src-tauri/src/qec_control/mod.rs`
- Create: `src-tauri/src/qec_control/policy.rs`
- Create: `src-tauri/src/qec_control/audit.rs`
- Create: `src-tauri/src/commands/qec_control.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/services/qecControlClient.ts`
- Create: `src/services/qecControlClient.test.ts`
- Create: `src/components/qec/observatory/IncidentFreezeDialog.tsx`
- Create: `src/components/qec/observatory/IncidentFreezeDialog.test.tsx`

**Interfaces:**
- Consumes: adapter-declared capabilities, explicit user grants, active Study/session.
- Produces: allowlisted commands, confirmation challenges, append-only audit entries, and immutable incident snapshots.

- [ ] **Step 1: Write failing deny-by-default and audit-chain tests**

```rust
#[test]
fn undeclared_command_is_denied() {
    let result = authorize(&Policy::default(), &request("pause_run"));
    assert!(matches!(result, Err(ControlError::CapabilityDenied { .. })));
}
```

- [ ] **Step 2: Run and observe missing-module failure**

Run: `cd src-tauri && cargo test qec_control && cd .. && npm test -- src/services/qecControlClient.test.ts src/components/qec/observatory/IncidentFreezeDialog.test.tsx`

- [ ] **Step 3: Implement constrained commands and incident bundles**

Use structured payloads only, token/auth checks from P2, per-adapter allowlists, nonce/expiry, confirmation for pause/stop/config changes, and chained audit hashes. Incident freeze captures offsets, query windows, alert state, calibration/topology refs, UI selection, adapter versions, and data hashes; it does not copy secrets.

- [ ] **Step 4: Verify replay attack, expiry, denial, redaction, and successful freeze**

Run: `cd src-tauri && cargo test qec_control && cd .. && npm test -- src/services/qecControlClient.test.ts src/components/qec/observatory/IncidentFreezeDialog.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/qec_control src-tauri/src/commands/qec_control.rs src-tauri/src/lib.rs src/services/qecControlClient.ts src/services/qecControlClient.test.ts src/components/qec/observatory/IncidentFreezeDialog.tsx src/components/qec/observatory/IncidentFreezeDialog.test.tsx
git commit -m "feat: secure QEC control-plane actions"
```

### Task 10: Add laptop, workstation, and cluster execution tiers

**Files:**
- Create: `kernel/qec_data/execution/tiers.py`
- Create: `kernel/qec_data/execution/cache.py`
- Create: `kernel/qec_data/execution/flight_client.py`
- Create: `kernel/tests/test_execution_tiers.py`
- Create: `src/types/qecCompute.ts`
- Create: `src/stores/qecComputeStore.ts`
- Create: `src/stores/qecComputeStore.test.ts`
- Create: `src/components/qec/compute/ComputeTargetPicker.tsx`
- Create: `src/components/qec/compute/ComputeTargetPicker.test.tsx`
- Modify: `src/services/qecDataClient.ts`

**Interfaces:**
- Consumes: identical `QecQuerySpec`/recipe requests plus configured execution targets.
- Produces: quota-aware local/remote jobs, content-addressed cache entries, cancellation, and transparent provenance.

- [ ] **Step 1: Write failing routing and cache-identity tests**

```python
def test_tier_does_not_change_recipe_identity() -> None:
    local = recipe_cache_key(recipe, inputs, tier='laptop')
    remote = recipe_cache_key(recipe, inputs, tier='cluster')
    assert local == remote
```

- [ ] **Step 2: Run and observe missing-execution failure**

Run: `cd kernel && pytest tests/test_execution_tiers.py -q && cd .. && npm test -- src/components/qec/compute/ComputeTargetPicker.test.tsx`

- [ ] **Step 3: Implement explicit tier policy**

Laptop uses bounded local workers and conservative memory; workstation permits larger concurrency; cluster submits via optional TLS Arrow Flight with cancellation and server-advertised quotas. Credentials remain in OS-managed storage/Tauri, never Study manifests. Every result records target, engine version, adapter version, and cache key.

- [ ] **Step 4: Verify unavailable-remote fallback and cancellation**

Run: `cd kernel && pytest tests/test_execution_tiers.py -q && cd .. && npm test -- src/stores/qecComputeStore.test.ts src/components/qec/compute/ComputeTargetPicker.test.tsx`

Expected: no silent tier fallback; the user must approve local execution when cost/semantics may differ.

- [ ] **Step 5: Commit**

```bash
git add kernel/qec_data/execution kernel/tests/test_execution_tiers.py src/types/qecCompute.ts src/stores/qecComputeStore.ts src/components/qec/compute src/services/qecDataClient.ts
git commit -m "feat: tier QEC query execution"
```

### Task 11: Prove hardware/live resilience and document operations

**Files:**
- Create: `kernel/tests/soak/test_live_ingestion_soak.py`
- Create: `kernel/tests/bench/test_qec_tile_latency.py`
- Create: `tests/e2e/qec-hardware-replay.spec.ts`
- Create: `tests/e2e/qec-live-observatory.spec.ts`
- Create: `docs-site/src/content/docs/research/hardware-data.mdx`
- Create: `docs-site/src/content/docs/research/live-observatory.mdx`
- Create: `docs-site/src/content/docs/reference/qec-live-operations.mdx`
- Modify: `docs-site/src/content/docs/reference/protocol-changelog.mdx`

**Interfaces:**
- Consumes: complete hardware and live wave.
- Produces: reproducible resilience evidence, operator runbooks, and documented protocol additions.

- [ ] **Step 1: Write E2E acceptance flows before final polish**

```ts
test('recorded capture imports, aligns calibration, and replays into the microscope', async ({ page }) => {
  await importFixture(page, 'hardware/minimal-capture');
  await expect(page.getByText('Calibration aligned')).toBeVisible();
  await page.getByRole('button', { name: 'Play replay' }).click();
  await expect(page.getByTestId('playback-cursor')).not.toHaveText('0 ns');
});
```

- [ ] **Step 2: Run E2E and observe any remaining failures**

Run: `npx playwright test tests/e2e/qec-hardware-replay.spec.ts tests/e2e/qec-live-observatory.spec.ts --project=chromium`

- [ ] **Step 3: Add deterministic soak/latency harnesses and operational docs**

The soak test uses a bounded deterministic source, injected disconnects, slow subscribers, and restart checkpoints; mark it separately from the fast suite but run it in scheduled CI. Document data gaps, disk sizing, retention, TLS/credentials, alert tuning, incident freeze, command audits, and recovery.

- [ ] **Step 4: Run the complete hardware gate**

Run:

```bash
cd kernel && pytest tests/test_qec_hardware_schemas.py tests/test_hardware_adapters.py tests/test_calibration_alignment.py tests/test_live_adapter_protocol.py tests/test_synthetic_live_adapter.py tests/test_live_ingestion.py tests/test_live_recovery.py tests/test_live_alerts.py tests/test_execution_tiers.py -q --cov=qec_data --cov-fail-under=80
cd ../src-tauri && cargo test qec_control
cd .. && npm test -- src/components/qec src/stores/qecReplayStore.test.ts src/stores/qecObservatoryStore.test.ts && npx playwright test tests/e2e/qec-hardware-replay.spec.ts tests/e2e/qec-live-observatory.spec.ts --project=chromium
```

Expected: PASS; then separately run `cd kernel && pytest tests/soak/test_live_ingestion_soak.py tests/bench/test_qec_tile_latency.py -q` and attach measured values to the release checklist without inventing fixed latency claims before measurement.

- [ ] **Step 5: Commit**

```bash
git add kernel/tests/soak kernel/tests/bench tests/e2e/qec-hardware-replay.spec.ts tests/e2e/qec-live-observatory.spec.ts docs-site/src/content/docs/research/hardware-data.mdx docs-site/src/content/docs/research/live-observatory.mdx docs-site/src/content/docs/reference/qec-live-operations.mdx docs-site/src/content/docs/reference/protocol-changelog.mdx
git commit -m "test: qualify QEC hardware operations"
```
