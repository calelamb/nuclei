# QEC Canonical Data Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import recorded Stim, sinter, CSV/JSONL, Arrow, and Parquet sources into immutable canonical QEC sessions and serve bounded progressive queries from local Parquet/DuckDB through an authenticated data engine.

**Architecture:** JSON Schema and cross-language fixtures define canonical records. A managed Python QEC Data Engine owns adapters, Arrow batches, atomic Parquet partitions, DuckDB queries, and jobs; Tauri starts it with a per-process token; React submits bounded query specs and renders progress/tiles without owning full captures.

**Tech Stack:** Python 3.11+, dataclasses, jsonschema, PyArrow 18+, Parquet, DuckDB 1.2+, websockets, pytest, React/TypeScript/Zod/Zustand, Tauri/Rust/serde.

## Global Constraints

- Inherit `docs/superpowers/plans/2026-07-21-qec-unified-workbench-program.md`.
- P1 must be complete; consume its Study and Research Selection names unchanged.
- Canonical schema begins at `qec-data/1.0.0` and is additive within major version 1.
- Original input is never rewritten. Imports either reference or copy originals and always record SHA-256.
- Browser tile payloads are capped at 1 MiB; table pages are capped at 10,000 rows.
- No SQL string interpolation. DuckDB queries use fixed templates and bound parameters or validated identifiers from allowlists.
- Adapter probing is read-only; invalid data is quarantined with an actionable validation report.

---

### Task 1: Pin and verify data-engine dependencies

**Files:**
- Modify: `kernel/requirements.txt`
- Modify: `src-tauri/src/commands/frameworks.rs`
- Create: `kernel/tests/test_qec_data_dependencies.py`
- Modify: `docs-site/src/content/docs/research/qec-workbench.mdx`

**Interfaces:**
- Consumes: existing optional Research dependency catalog.
- Produces: installable `qec-data` catalog group with `pyarrow>=18,<26`, `duckdb>=1.2,<2`, and `jsonschema>=4.23,<5`.

- [ ] **Step 1: Re-verify primary APIs and registry versions**

Run:

```bash
gh search code "RecordBatchStreamWriter" --repo apache/arrow --limit 5
gh search code "read_parquet" --repo duckdb/duckdb --limit 5
python3 -m pip index versions pyarrow
python3 -m pip index versions duckdb
```

Expected: documented APIs still exist and selected ranges have wheels for supported macOS/Windows/Linux Python versions. If a selected upper bound has been released with a breaking API, narrow the upper bound in both files before proceeding; do not widen untested ranges.

- [ ] **Step 2: Write the failing dependency-catalog test**

```python
from pathlib import Path

def test_qec_data_dependencies_are_declared() -> None:
    requirements = Path('requirements.txt').read_text(encoding='utf-8')
    assert 'pyarrow>=18,<26' in requirements
    assert 'duckdb>=1.2,<2' in requirements
    assert 'jsonschema>=4.23,<5' in requirements
```

- [ ] **Step 3: Run and observe failure**

Run: `cd kernel && pytest tests/test_qec_data_dependencies.py -q`

Expected: FAIL because dependencies are not declared.

- [ ] **Step 4: Add optional catalog entries and friendly missing-dependency metadata**

Add commented optional pins to `kernel/requirements.txt` and a `QEC Data Engine` Research catalog entry whose import probes are `pyarrow`, `duckdb`, and `jsonschema`. Reuse the existing framework catalog install/uninstall/status flow; do not create a second package installer.

- [ ] **Step 5: Verify and commit**

Run: `cd kernel && pytest tests/test_qec_data_dependencies.py -q && cd ../src-tauri && cargo test commands::frameworks`

```bash
git add kernel/requirements.txt kernel/tests/test_qec_data_dependencies.py src-tauri/src/commands/frameworks.rs docs-site/src/content/docs/research/qec-workbench.mdx
git commit -m "feat: register QEC data dependencies"
```

### Task 2: Define canonical JSON Schemas and shared fixtures

**Files:**
- Create: `schemas/qec-data/v1/session.schema.json`
- Create: `schemas/qec-data/v1/syndrome-batch.schema.json`
- Create: `schemas/qec-data/v1/decode-result.schema.json`
- Create: `schemas/qec-data/v1/calibration-record.schema.json`
- Create: `schemas/qec-data/v1/provenance.schema.json`
- Create: `schemas/qec-data/v1/fixtures/minimal-session.json`
- Create: `schemas/qec-data/v1/fixtures/minimal-batch.json`
- Create: `kernel/tests/test_qec_data_schemas.py`
- Create: `src/types/qecData.schema.test.ts`

**Interfaces:**
- Consumes: JSON Schema draft 2020-12.
- Produces: canonical `qec-data/1.0.0` schemas and cross-language fixtures.

- [ ] **Step 1: Write failing fixture-validation tests**

```python
import json
from pathlib import Path
from jsonschema import Draft202012Validator

ROOT = Path(__file__).parents[2] / 'schemas' / 'qec-data' / 'v1'

def test_minimal_session_matches_schema() -> None:
    schema = json.loads((ROOT / 'session.schema.json').read_text())
    fixture = json.loads((ROOT / 'fixtures' / 'minimal-session.json').read_text())
    Draft202012Validator(schema).validate(fixture)
```

TypeScript test reads the same fixture and passes it to the Zod schema introduced in Task 3.

- [ ] **Step 2: Run and observe missing-schema failure**

Run: `cd kernel && pytest tests/test_qec_data_schemas.py -q`

Expected: FAIL because schema files do not exist.

- [ ] **Step 3: Add strict schemas with required scientific-state fields**

The Session schema requires:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://getnuclei.dev/schemas/qec-data/v1/session.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "session_id", "kind", "status", "adapter", "provenance_id", "segments"],
  "properties": {
    "schema_version": { "const": "1.0.0" },
    "session_id": { "type": "string", "minLength": 1 },
    "kind": { "enum": ["simulation_campaign", "hardware_import", "hardware_live", "replay"] },
    "status": { "enum": ["created", "importing", "recording", "complete", "partial", "failed"] },
    "adapter": { "type": "object", "required": ["id", "version"], "properties": { "id": { "type": "string" }, "version": { "type": "string" } }, "additionalProperties": false },
    "provenance_id": { "type": "string" },
    "segments": { "type": "array", "items": { "type": "string" } }
  }
}
```

Syndrome records use base64 in JSON fixtures but map to Arrow `fixed_size_binary` in storage. Every nullable scientific value has an adjacent status enum where ambiguity exists.

- [ ] **Step 4: Verify valid and deliberately invalid fixtures**

Run: `cd kernel && pytest tests/test_qec_data_schemas.py -q`

Expected: PASS, including rejection of unknown fields, invalid status, negative sequence, and missing provenance.

- [ ] **Step 5: Commit**

```bash
git add schemas/qec-data kernel/tests/test_qec_data_schemas.py src/types/qecData.schema.test.ts
git commit -m "feat: define canonical QEC data schemas"
```

### Task 3: Implement Python and TypeScript canonical models

**Files:**
- Create: `kernel/qec_data/__init__.py`
- Create: `kernel/qec_data/models.py`
- Create: `kernel/tests/qec_data/test_models.py`
- Create: `src/types/qecData.ts`
- Modify: `src/types/qecData.schema.test.ts`

**Interfaces:**
- Consumes: Task 2 schemas/fixtures.
- Produces: frozen `SessionRecord`, `SyndromeBatch`, `DecodeRecord`, `CalibrationRecord`, `ProvenanceRecord`, and matching Zod summary/query types.

- [ ] **Step 1: Write failing immutable-model tests**

```python
from dataclasses import FrozenInstanceError
import pytest
from kernel.qec_data.models import SessionKind, SessionRecord

def test_session_record_is_immutable() -> None:
    session = SessionRecord.minimal('s1', SessionKind.HARDWARE_IMPORT, 'generic.parquet', '1.0.0', 'p1')
    with pytest.raises(FrozenInstanceError):
        session.status = 'failed'  # type: ignore[misc]
```

- [ ] **Step 2: Run and observe missing package failure**

Run: `cd kernel && pytest tests/qec_data/test_models.py -q`

Expected: FAIL because `kernel.qec_data` does not exist.

- [ ] **Step 3: Implement frozen records and Zod mirrors**

```python
from dataclasses import dataclass
from enum import StrEnum

SCHEMA_VERSION = '1.0.0'

class SessionKind(StrEnum):
    SIMULATION_CAMPAIGN = 'simulation_campaign'
    HARDWARE_IMPORT = 'hardware_import'
    HARDWARE_LIVE = 'hardware_live'
    REPLAY = 'replay'

@dataclass(frozen=True, slots=True)
class AdapterIdentity:
    id: str
    version: str

@dataclass(frozen=True, slots=True)
class SessionRecord:
    schema_version: str
    session_id: str
    kind: SessionKind
    status: str
    adapter: AdapterIdentity
    provenance_id: str
    segments: tuple[str, ...]
```

`SyndromeBatch` accepts immutable `bytes` buffers and validates `record_count`, detector width, sequence range, and optional observable/measurement widths in `__post_init__`.

In `qecData.ts`, export Zod schemas plus `QecSessionSummary`, `QecTileKind`, `QecQuerySpec`, `QecTilePayload`, and `QecQueryResult` using the exact names frozen in the master plan.

- [ ] **Step 4: Run cross-language fixture tests**

Run: `cd kernel && pytest tests/qec_data/test_models.py tests/test_qec_data_schemas.py -q && cd .. && npm test -- src/types/qecData.schema.test.ts`

Expected: PASS for the same fixtures in Python and TypeScript.

- [ ] **Step 5: Commit**

```bash
git add kernel/qec_data kernel/tests/qec_data/test_models.py src/types/qecData.ts src/types/qecData.schema.test.ts
git commit -m "feat: add canonical QEC data models"
```

### Task 4: Build atomic Parquet session storage

**Files:**
- Create: `kernel/qec_data/storage.py`
- Create: `kernel/qec_data/hashing.py`
- Create: `kernel/tests/qec_data/test_storage.py`

**Interfaces:**
- Consumes: canonical Python records and PyArrow.
- Produces: `SessionStorage.create`, `append_batch`, `commit_segment`, `recover`, `verify`, and deterministic `dataset_id`.

- [ ] **Step 1: Write failing atomicity and recovery tests**

```python
def test_uncommitted_partition_is_not_visible(tmp_path, sample_batch) -> None:
    storage = SessionStorage.create(tmp_path, sample_session())
    pending = storage.append_batch(sample_batch)
    assert pending.suffix == '.pending'
    assert storage.list_committed_partitions() == ()
    storage.commit_segment('segment-0001')
    assert len(storage.list_committed_partitions()) == 1
```

- [ ] **Step 2: Run and observe missing storage failure**

Run: `cd kernel && pytest tests/qec_data/test_storage.py -q`

Expected: FAIL because `SessionStorage` is missing.

- [ ] **Step 3: Implement pending-write, fsync, rename, checksum, and journal flow**

```python
@dataclass(frozen=True, slots=True)
class PartitionRef:
    path: Path
    sha256: str
    rows: int
    sequence_start: int
    sequence_end: int

class SessionStorage:
    @classmethod
    def create(cls, root: Path, session: SessionRecord) -> 'SessionStorage': ...
    def append_batch(self, batch: SyndromeBatch) -> Path: ...
    def commit_segment(self, segment_id: str) -> tuple[PartitionRef, ...]: ...
    def recover(self) -> RecoveryReport: ...
    def verify(self) -> VerificationReport: ...
```

Write Parquet to `*.pending`, flush/fsync, compute SHA-256, atomically rename to `part-<sequence>.parquet`, then atomically update `journal.json`. Recovery deletes invalid pending files and reports valid uncommitted files for explicit resume; it never auto-promotes unknown content.

- [ ] **Step 4: Verify duplicate, interruption, checksum, and schema-transition cases**

Run: `cd kernel && pytest tests/qec_data/test_storage.py -q`

Expected: PASS, including idempotent duplicate detection and new-segment requirement for schema changes.

- [ ] **Step 5: Commit**

```bash
git add kernel/qec_data/storage.py kernel/qec_data/hashing.py kernel/tests/qec_data/test_storage.py
git commit -m "feat: store QEC sessions atomically"
```

### Task 5: Add DuckDB catalog and bounded query tiles

**Files:**
- Create: `kernel/qec_data/catalog.py`
- Create: `kernel/qec_data/queries.py`
- Create: `kernel/qec_data/tiles.py`
- Create: `kernel/tests/qec_data/test_catalog.py`
- Create: `kernel/tests/qec_data/test_queries.py`

**Interfaces:**
- Consumes: committed Parquet partitions and `QecQuerySpec` JSON.
- Produces: `QecCatalog`, `QecQueryEngine.execute(spec, cancel)`, progressive `QueryProgress`, and bounded tile payloads.

- [ ] **Step 1: Write failing bound and cancellation tests**

```python
def test_table_query_enforces_page_cap(catalog_with_rows) -> None:
    spec = query_spec(tile='table-page', filters={'limit': 50_000})
    with pytest.raises(QueryValidationError, match='10,000'):
        QecQueryEngine(catalog_with_rows).execute(spec, NeverCancelled())

def test_cancelled_query_stops_before_tile(catalog_with_rows) -> None:
    with pytest.raises(QueryCancelled):
        QecQueryEngine(catalog_with_rows).execute(query_spec(), AlwaysCancelled())
```

- [ ] **Step 2: Run and observe missing query engine failure**

Run: `cd kernel && pytest tests/qec_data/test_catalog.py tests/qec_data/test_queries.py -q`

Expected: FAIL because catalog/query modules are missing.

- [ ] **Step 3: Implement fixed query templates and tile dataclasses**

```python
class QecQueryEngine:
    def execute(self, spec: QuerySpec, cancel: CancellationToken) -> Iterator[QueryEvent]:
        yield QueryProgress(spec.request_id, 0.0, 'planning')
        plan = build_query_plan(spec)
        cancel.raise_if_cancelled()
        table = self._catalog.execute(plan)
        payload = build_bounded_tile(spec, table, max_bytes=1_048_576)
        yield QueryTile(spec.request_id, payload, True)
```

Allowlist tile kinds and metric/column identifiers. Bind session/dataset IDs, ranges, and filter values. `heatmap` bins to requested width/height; `time-series` returns min/max/mean/count envelopes; `table-page` uses a validated cursor.

- [ ] **Step 4: Verify SQL injection rejection and tile-size bounds**

Run: `cd kernel && pytest tests/qec_data/test_catalog.py tests/qec_data/test_queries.py -q`

Expected: PASS and no generated tile serializes above 1 MiB.

- [ ] **Step 5: Commit**

```bash
git add kernel/qec_data/catalog.py kernel/qec_data/queries.py kernel/qec_data/tiles.py kernel/tests/qec_data/test_catalog.py kernel/tests/qec_data/test_queries.py
git commit -m "feat: query bounded QEC data tiles"
```

### Task 6: Define the adapter SDK and compliance kit

**Files:**
- Create: `kernel/qec_data/adapters/__init__.py`
- Create: `kernel/qec_data/adapters/base.py`
- Create: `kernel/qec_data/adapters/registry.py`
- Create: `kernel/tests/qec_data/adapter_contract.py`
- Create: `kernel/tests/qec_data/test_adapter_contract.py`

**Interfaces:**
- Consumes: canonical batches/session records.
- Produces: frozen `AdapterManifest`, `AdapterCapability`, `ProbeResult`, `ValidationReport`, `ImportMapping`, `PreviewResult`, `QecDataAdapter`, and `run_adapter_contract(adapter_factory)`.

- [ ] **Step 1: Write a failing fake-adapter compliance test**

```python
def test_contract_rejects_probe_that_mutates_source(tmp_path) -> None:
    source = tmp_path / 'source.dets'
    source.write_text('shot D0\n')
    report = run_adapter_contract(lambda: MutatingProbeAdapter(), source)
    assert 'probe_changed_source' in report.failure_codes
```

- [ ] **Step 2: Run and observe missing contract failure**

Run: `cd kernel && pytest tests/qec_data/test_adapter_contract.py -q`

Expected: FAIL because adapter types and contract runner are missing.

- [ ] **Step 3: Implement the exact master Protocol and typed unsupported results**

```python
class AdapterCapability(StrEnum):
    PROBE = 'probe'
    VALIDATE = 'validate'
    PREVIEW = 'preview'
    IMPORT = 'import_batches'
    STREAM = 'stream_batches'
    COMMAND = 'command'

@dataclass(frozen=True, slots=True)
class AdapterManifest:
    id: str
    version: str
    capabilities: frozenset[AdapterCapability]
    source_kinds: tuple[str, ...]
```

Implement the full `QecDataAdapter` Protocol from the master plan. The compliance runner checks read-only probe, deterministic bounded preview, cancellation, sequence monotonicity, provenance, declared/actual capabilities, and unsupported results.

- [ ] **Step 4: Verify good and intentionally broken adapters**

Run: `cd kernel && pytest tests/qec_data/test_adapter_contract.py -q`

Expected: PASS with each broken fixture producing its expected failure code.

- [ ] **Step 5: Commit**

```bash
git add kernel/qec_data/adapters kernel/tests/qec_data/adapter_contract.py kernel/tests/qec_data/test_adapter_contract.py
git commit -m "feat: define the QEC data adapter contract"
```

### Task 7: Implement core offline adapters

**Files:**
- Create: `kernel/qec_data/adapters/stim_results.py`
- Create: `kernel/qec_data/adapters/sinter_csv.py`
- Create: `kernel/qec_data/adapters/tabular.py`
- Create: `kernel/tests/qec_data/test_stim_results_adapter.py`
- Create: `kernel/tests/qec_data/test_sinter_adapter.py`
- Create: `kernel/tests/qec_data/test_tabular_adapter.py`
- Create: `kernel/tests/qec_data/fixtures/`

**Interfaces:**
- Consumes: adapter SDK, Stim documented formats, sinter CSV, PyArrow CSV/JSON/Parquet readers.
- Produces: registered `stim-results@1`, `sinter-csv@1`, and `tabular@1` adapters.

- [ ] **Step 1: Write golden import tests before adapters**

```python
@pytest.mark.parametrize('extension', ['01', 'b8', 'r8', 'ptb64', 'hits', 'dets'])
def test_stim_formats_normalize_to_same_detection_events(extension, stim_fixture_set) -> None:
    adapter = StimResultsAdapter()
    batches = tuple(adapter.import_batches(stim_fixture_set[extension], stim_fixture_set.mapping))
    assert decode_detector_rows(batches) == ((0, 2), (), (1,))
```

- [ ] **Step 2: Run and observe missing-adapter failures**

Run: `cd kernel && pytest tests/qec_data/test_stim_results_adapter.py tests/qec_data/test_sinter_adapter.py tests/qec_data/test_tabular_adapter.py -q`

Expected: FAIL because adapters do not exist.

- [ ] **Step 3: Implement streaming readers with explicit mappings**

Stim adapter uses Stim's documented conversion semantics and requires detector/observable counts from mapping, `.stim`, or `.dem`. Sinter adapter preserves standard CSV columns and `json_metadata`. Tabular adapter requires an explicit mapping from source columns to sequence/time/detector/observable/calibration fields; it never guesses scientific units after preview.

Each adapter emits batches capped at 65,536 records and includes source row/byte offsets in provenance.

- [ ] **Step 4: Run golden, malformed, and compliance tests**

Run: `cd kernel && pytest tests/qec_data/test_*adapter.py -q`

Expected: PASS for all native formats and clear errors for missing widths, malformed metadata, invalid bit strings, and non-monotonic sequence.

- [ ] **Step 5: Commit**

```bash
git add kernel/qec_data/adapters/stim_results.py kernel/qec_data/adapters/sinter_csv.py kernel/qec_data/adapters/tabular.py kernel/tests/qec_data
git commit -m "feat: import recorded QEC data"
```

### Task 8: Add authenticated data-engine protocol and lifecycle

**Files:**
- Create: `kernel/qec_data/protocol.py`
- Create: `kernel/qec_data/jobs.py`
- Create: `kernel/qec_data/server.py`
- Create: `kernel/tests/qec_data/test_server.py`
- Create: `src-tauri/src/commands/qec_data.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`
- Create: `src-tauri/tests/qec_data_lifecycle.rs`

**Interfaces:**
- Consumes: adapters, storage, queries, fixed port 9743.
- Produces: Tauri commands `qec_data_start`, `qec_data_stop`, `qec_data_status` and authenticated WebSocket messages.

- [ ] **Step 1: Write failing authentication and process tests**

```python
@pytest.mark.asyncio
async def test_server_rejects_wrong_token(qec_data_server) -> None:
    async with websockets.connect(qec_data_server.url) as ws:
        await ws.send(json.dumps({'type': 'authenticate', 'token': 'wrong'}))
        with pytest.raises(websockets.ConnectionClosedError) as closed:
            await ws.recv()
        assert closed.value.code == 4401
```

- [ ] **Step 2: Run and observe missing server/Tauri command failures**

Run: `cd kernel && pytest tests/qec_data/test_server.py -q && cd ../src-tauri && cargo test qec_data_lifecycle`

Expected: FAIL because server and commands are missing.

- [ ] **Step 3: Implement bounded protocol and managed child state**

Protocol request types:

```python
class MessageType(StrEnum):
    AUTHENTICATE = 'authenticate'
    IMPORT_PROBE = 'import_probe'
    IMPORT_PREVIEW = 'import_preview'
    IMPORT_START = 'import_start'
    JOB_CANCEL = 'job_cancel'
    QUERY_START = 'query_start'
    QUERY_CANCEL = 'query_cancel'
    SESSION_LIST = 'session_list'
```

Tauri creates 32 random bytes with the OS RNG, hex-encodes them, sets `NUCLEI_QEC_DATA_TOKEN`, starts `python -m kernel.qec_data.server --port 9743`, drains logs without printing the token, and returns `QecDataEndpoint { url, token }`. Add `ws://127.0.0.1:9743` to CSP `connect-src`.

- [ ] **Step 4: Verify auth, payload cap, cancellation, restart, and port squatter behavior**

Run: `cd kernel && pytest tests/qec_data/test_server.py -q && cd ../src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test qec_data`

Expected: PASS; responses above cap return `query_requires_refinement`, and stop/restart invalidates the old token.

- [ ] **Step 5: Commit**

```bash
git add kernel/qec_data/protocol.py kernel/qec_data/jobs.py kernel/qec_data/server.py kernel/tests/qec_data/test_server.py src-tauri/src/commands/qec_data.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/tauri.conf.json src-tauri/tests/qec_data_lifecycle.rs
git commit -m "feat: manage the authenticated QEC data engine"
```

### Task 9: Add frontend client, stores, and import mapping workflow

**Files:**
- Create: `src/types/qecDataProtocol.ts`
- Create: `src/services/qecDataClient.ts`
- Create: `src/services/qecDataClient.test.ts`
- Create: `src/stores/qecQueryStore.ts`
- Create: `src/stores/qecQueryStore.test.ts`
- Create: `src/stores/qecJobStore.ts`
- Create: `src/components/qec/import/QecImportWizard.tsx`
- Create: `src/components/qec/import/QecImportWizard.test.tsx`
- Modify: `src/components/qec/workbench/QecSourcesPanel.tsx`
- Modify: `src/components/qec/workbench/QecWorkbenchTray.tsx`

**Interfaces:**
- Consumes: Tauri endpoint, P1 Study/selection, P2 protocol/query types.
- Produces: `QecDataClient`, `useQecQueryStore`, `useQecJobStore`, and staged import wizard.

- [ ] **Step 1: Write client/store/wizard failing tests**

```tsx
it('does not enable Import until probe, mapping, and validation succeed', async () => {
  render(<QecImportWizard source="capture.parquet" client={fakeClient()} />);
  expect(screen.getByRole('button', { name: 'Import data' })).toBeDisabled();
  await screen.findByText('3 mapped fields');
  fireEvent.click(screen.getByRole('button', { name: 'Validate mapping' }));
  await screen.findByText('Validation passed');
  expect(screen.getByRole('button', { name: 'Import data' })).toBeEnabled();
});
```

- [ ] **Step 2: Run and observe missing modules**

Run: `npm test -- src/services/qecDataClient.test.ts src/stores/qecQueryStore.test.ts src/components/qec/import/QecImportWizard.test.tsx`

Expected: FAIL because client/stores/wizard do not exist.

- [ ] **Step 3: Implement request correlation, progressive tiles, and staged import UI**

`QecDataClient` authenticates once, validates every incoming unknown frame with Zod, correlates by `requestId`, exposes async `probe`, `preview`, `startImport`, `query`, `cancel`, and closes all pending requests with `engine_disconnected` on socket loss.

The wizard steps are Source → Adapter → Mapping → Preview → Validation → Destination → Import. It displays original/copy policy, source hash, expected rows/bytes, warnings, and quarantine details.

- [ ] **Step 4: Verify disconnect, stale-result, cancellation, and accessible wizard states**

Run: `npm test -- src/services/qecDataClient.test.ts src/stores/qecQueryStore.test.ts src/components/qec/import/QecImportWizard.test.tsx && npm run build`

Expected: PASS; a cancelled/stale request cannot overwrite a newer tile.

- [ ] **Step 5: Commit**

```bash
git add src/types/qecDataProtocol.ts src/services/qecDataClient.ts src/services/qecDataClient.test.ts src/stores/qecQueryStore.ts src/stores/qecQueryStore.test.ts src/stores/qecJobStore.ts src/components/qec/import src/components/qec/workbench/QecSourcesPanel.tsx src/components/qec/workbench/QecWorkbenchTray.tsx
git commit -m "feat: import and query canonical QEC data"
```

### Task 10: Close offline-data wave with E2E, coverage, and docs

**Files:**
- Create: `tests/e2e/qec-import.spec.ts`
- Create: `tests/e2e/fixtures/qec-project/captures/minimal.dets`
- Create: `tests/e2e/fixtures/qec-project/captures/minimal.parquet`
- Create: `docs-site/src/content/docs/research/qec-data-import.mdx`
- Create: `docs-site/src/content/docs/reference/qec-data-schema.mdx`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: complete offline import/query flow.
- Produces: Wave 2 acceptance coverage and public schema/import documentation.

- [ ] **Step 1: Write the failing end-to-end import test**

```ts
test('@qec imports a .dets capture and restores it after reload', async ({ page }) => {
  await openQecFixtureProject(page);
  await page.getByRole('button', { name: 'Import QEC data' }).click();
  await chooseFixture(page, 'captures/minimal.dets');
  await page.getByRole('button', { name: 'Validate mapping' }).click();
  await page.getByRole('button', { name: 'Import data' }).click();
  await expect(page.getByText('Import complete')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('treeitem', { name: /minimal capture/i })).toBeVisible();
});
```

- [ ] **Step 2: Run and observe missing fixture/flow failure**

Run: `npx playwright test tests/e2e/qec-import.spec.ts --project=chromium`

Expected: FAIL until fixtures and import bootstrap are complete.

- [ ] **Step 3: Add docs and deterministic fixtures**

Document copy/reference policy, validation stages, canonical schemas, data-quality states, recovery, supported Stim/sinter/tabular formats, and how to build a mapping without guessing units.

- [ ] **Step 4: Run Wave 2 gate**

Run:

```bash
npm test
npm run lint
npm run build
npx playwright test tests/e2e/qec-import.spec.ts --project=chromium
cd kernel && pytest tests/qec_data -q --cov=qec_data --cov-fail-under=80
cd ../src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test qec_data
```

Expected: all PASS; import peak memory stays below 512 MiB for the generated 10-million-record test because adapters stream fixed batches.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/qec-import.spec.ts tests/e2e/fixtures/qec-project/captures docs-site/src/content/docs/research/qec-data-import.mdx docs-site/src/content/docs/reference/qec-data-schema.mdx CHANGELOG.md
git commit -m "docs: ship canonical QEC data imports"
```
