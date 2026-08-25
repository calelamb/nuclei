# Unified QEC Workbench Design

**Status:** Approved design, pending written-spec review

**Date:** 2026-07-21

**Product:** Nuclei Research — QEC Studio

**Audience:** Simulation researchers using Stim/sinter and hardware teams importing or streaming syndrome and calibration data

## Decision Summary

Nuclei will evolve QEC Studio into a unified, light-first research workbench.
The product core is one code-to-evidence loop:

> change a code, noise model, or decoder → inspect the structure → run or
> import an experiment → locate failures → compare against a baseline → save
> reproducible evidence → iterate

The workbench serves simulation and hardware research through one canonical
session and dataset model. Simulation campaigns, recorded hardware captures,
replays, and live streams are different sources feeding the same analysis and
visualization pipeline.

Hardware support is phased:

1. Offline import and deterministic replay establish the schema, storage, and
   analysis contracts.
2. Live adapters feed the same contracts and add observability plus safe
   experiment-control commands.

Nuclei is the observability and experiment-control plane. It does not enter the
hard real-time decoder feedback loop.

The architecture is vendor-neutral. Core adapters support open and generic
formats; an adapter SDK allows vendor and laboratory integrations without
coupling proprietary formats to Nuclei core.

The workspace is designed and accepted against Nuclei's white and light-blue
visual language. A dark-blue or neon laboratory aesthetic is explicitly
rejected.

## Context

Nuclei already ships the core pieces of an unusual QEC environment:

- Stim circuits and source-mode `.stim` files
- Timeline, code lattice, and detector-graph visualizations
- Probability-weighted detector edges and boundary/logical styling
- Accurate sampled decoding through the kernel
- Interactive in-app syndrome decoding through WASM
- Declarative sinter campaigns with resume support
- Threshold and Lambda analysis with confidence intervals
- Decoder comparison
- Noise-model files and templates
- Fault-tolerant resource estimation
- File-first experiment manifests and results

The current product separates these capabilities into two experiences. Live
Stim exploration sits beside the editor, while selecting a QEC campaign
replaces the editor and visualization area with a threshold plot and decoder
table. The visualization tabs do not share one research selection, and
campaign results do not naturally lead back to the circuit, syndrome, decoder,
or calibration state responsible for an observation.

The redesign is therefore primarily an orchestration and investigation
program. New visualizations matter, but the highest-value change is connecting
the existing instruments into a continuous scientific workflow.

## Goals

1. Make the edit-to-evidence loop fast enough for daily QEC simulation work.
2. Connect circuit structure, detector behavior, decoding, campaign results,
   calibration context, and resource projections through one selection model.
3. Support recorded hardware syndrome and calibration data without forcing
   laboratories into a private Nuclei-only format.
4. Support live hardware observation and bounded control commands while
   keeping deterministic correction outside Nuclei.
5. Scale from sampled laptop previews to workstation-scale out-of-core analysis
   and optional lab-cluster compute.
6. Preserve raw inputs, transformations, statistical assumptions, exclusions,
   and environment metadata so results remain defensible.
7. Deliver a creative, polished light UI that feels like a precision scientific
   instrument instead of a generic dashboard.
8. Provide an open adapter and analysis-recipe ecosystem.
9. Keep existing QEC projects, Stim files, sinter CSVs, and experiment schemas
   valid.

## Non-Goals

- Running a decoder feedback loop inside the Tauri/React application
- FPGA firmware, pulse control, or hard real-time scheduling
- Requiring a Nuclei-hosted cloud service
- Hiding Stim, sinter, Arrow, Parquet, or QECi behind a proprietary interchange
  format
- Replacing existing `*.experiment.yaml` files with an opaque database
- Full vendor-specific adapters in core for every hardware provider
- Automatic causal claims from calibration correlations or anomaly models
- Crumble-style graphical circuit editing in the initial program
- Dark-theme visual parity for the new QEC surfaces
- Free-form VS Code-style docking as the primary layout experience

## Design Principles

### Files remain the truth

Existing circuit, noise, experiment, run, and statistics files remain readable
outside Nuclei. A Study references and organizes them; it does not replace
them.

### One product, three working presets

Build, Analyze, and Observe rearrange the same registered panels. They are not
separate applications and do not fork the scientific state.

### Raw data is append-only

Imported and captured data is immutable. Filtering, mapping, alignment, and
analysis create versioned derived datasets.

### Every number has a lineage

Metrics and figures retain their source sessions, query parameters, statistical
method, sample count, exclusions, adapter version, and environment.

### Progressive by default

The UI shows a truthful sample or aggregate quickly, then refines it. It never
freezes while trying to load a complete large capture.

### Light, precise, and calm

White analytical surfaces, pale blue spatial structure, fine borders, restrained
shadows, and compact mono numerics define the QEC visual identity.

## Users and Primary Jobs

### Simulation code researcher

- Generate or edit Stim circuits.
- Change noise, distances, rounds, and decoder configurations.
- Run and resume sinter campaigns.
- Understand which structural or decoder change moved logical performance.
- Produce publication-ready figures and reproducible results.

### Decoder researcher

- Compare accuracy, latency, throughput, and tail behavior.
- Inspect individual failure traces and clusters.
- Compare corrections across decoders on identical syndromes.
- Test a decoder through the adapter/recipe contracts.

### Hardware QEC researcher

- Import recorded syndromes, observables, topology, and calibration data.
- Align detector behavior with calibration changes.
- Replay incidents and compare operating windows.
- Monitor live ingestion and decoder telemetry.
- Capture bounded incident windows for later analysis.

### Lab operator or reviewer

- Observe stream health without entering the correction loop.
- Annotate interventions and phase boundaries.
- Use read-only mode for review.
- Reopen a saved Finding and reproduce its workspace state.

## Product Model

### Project

The existing Nuclei project remains the outer filesystem boundary.

### Study

A Study is a lightweight, git-friendly manifest at
`studies/<slug>.qec-study.yaml`. It gathers the materials for one research
question without copying them by default.

The manifest records:

- Schema version and stable Study ID
- Name, research question, description, and tags
- References to circuits, DEMs, generators, noise models, and experiments
- References to simulation and hardware sessions
- Baseline and candidate cohort definitions
- Findings and report references
- Default workspace preset
- Snapshot history

Transient cursor, hover, split sizes, and open-panel state are stored as local
workspace preferences, not scientific manifest data.

### Session

A Session is one simulation campaign, hardware import, live capture, or replay.
It has a stable ID, source kind, lifecycle, segments, topology/circuit
references, time domain, adapter identity, and provenance.

### Dataset

A Dataset is an immutable raw or derived collection of canonical records.
Derived datasets name their parents and the transformation recipe that produced
them.

### Cohort

A Cohort is a saved query selecting comparable shots, campaign points, time
windows, detectors, decoders, or calibration states. Cohorts power comparisons
without copying data.

### Finding

A Finding binds an observation or hypothesis to a reconstructible workspace
selection, visual snapshot, annotation, data lineage, and scientific status.

### Snapshot

A Snapshot is an immutable Study checkpoint containing source hashes,
environment and adapter versions, analysis parameters, cohort definitions,
Finding references, and dataset references. Large data remains referenced by
content identity rather than duplicated.

## Information Architecture

The workbench has four stable zones:

```text
┌ Sources / Data ┬────────── Investigation Canvas ──────────┬ Inspector ┐
│ circuits       │ Timeline · Lattice · Detector Graph      │ selection │
│ campaigns      │ Threshold · Failure Microscope · Drift   │ metadata  │
│ captures       │                                          │ actions   │
├────────────────┴──────────────────────────────────────────┴───────────┤
│ Runs · Streams · Background Jobs · Logs · Comparisons                │
└───────────────────────────────────────────────────────────────────────┘
```

### Sources and Data

The left zone organizes:

- Study overview
- Circuits and generators
- Noise models
- Experiments and campaigns
- Imported and live sessions
- Calibration sources
- Cohorts
- Findings and reports

Items show status, source type, size, modification/capture time, validation
state, and provenance health.

### Investigation Canvas

The center zone is a registry-driven arrangement of scientific panels. It
supports curated presets, split view, maximize, and pin. The default is never
an empty docking canvas.

### Inspector

The Inspector explains the active selection and offers context-sensitive
actions. It contains values, units, uncertainty, source, lineage, related
objects, and safe actions. On smaller displays it becomes a drawer.

### Bottom Tray

The bottom zone holds high-churn operational information:

- Runs and campaign points
- Live streams and connection health
- Background imports and analysis jobs
- Logs and validation messages
- Comparison selection

It collapses without losing job lifecycle state.

## Workspace Presets

### Build

- Editor receives the largest area.
- Timeline/lattice/detector views share a synchronized secondary canvas.
- Campaign configuration and run actions remain visible.
- Inspector emphasizes circuit/noise/decoder properties.

### Analyze

- Investigation Canvas receives the largest area.
- Campaign, comparison, Failure Microscope, and calibration panels are primary.
- Editor remains reachable in a split rather than being unmounted.

### Observe

- Stream health, decoder telemetry, topology heatmap, calibration timeline, and
  alerts dominate.
- Control actions appear only when the adapter declares capabilities and the
  connection authorizes them.
- Incident capture and replay are one action away.

## Shared Research Selection

All panels communicate through one immutable selection model. Supported
entities include:

- Study, session, segment, dataset, and cohort
- Circuit revision, tick, gate, qubit, stabilizer, detector, edge, and logical
  observable
- Campaign point, decoder, distance, noise value, and run
- Shot, round, event window, syndrome cluster, and failure pathway
- Calibration record, device region, alert, annotation, and Finding

A selection contains stable IDs and a bounded context, never the whole object.
Panels derive query specifications from that selection.

The UI presents a Research Trail such as:

`d=7 → p=.004 → shot 18,204 → detector D42 → tick 31`

Users can move backward and forward through the trail, pin a branch, or clear
only the most recent narrowing step.

## Visual and Interaction Design

### Visual foundation

The QEC workspace mirrors and extends Nuclei light mode:

| Role | Value |
|---|---|
| Primary canvas | `#FFFFFF` |
| Raised surface | `#F8FAFC` |
| Recessed tray | `#F1F5F9` |
| Strong boundary | `#E2E8F0` |
| Primary text | `#1A1A2E` |
| Secondary text | `#64748B` |
| Quantum accent | `#0891B2` |
| Bright interactive accent | `#00B4D8` |
| Analytical blue | `#2563EB` |
| Pale selection field | `#E0F2FE` |
| Pale canvas field | `#F0F9FF` |

Semantic data colors:

- Physical activity: cyan
- Detection events: medium blue
- Logical observables: deep azure
- Decoder corrections: blue plus dashed or braided stroke
- Baseline data: slate-blue
- Healthy state: restrained green
- Uncertainty and drift: amber
- Confirmed failure or data loss: red
- Dirac purple: only for assistant-authored material

Color is never the sole signal. Shape, pattern, stroke, icon, and text reinforce
all semantic states.

### Surface treatment

- White plots with fine cool-gray or pale-blue grids
- Thin borders instead of nested heavy cards
- Soft shadow only for floating controls, drawers, and Failure Cards
- No dark navy surface, decorative neon, or gratuitous glow
- Compact monospace numerics and humanist sans-serif controls
- Dense data where comparison requires it; whitespace around conclusions

### Research bar

```text
[Study: Surface Memory ▼]  [BUILD | ANALYZE | OBSERVE]
Revision a13f · Data 84.2 GB · Provenance complete       [Run / Capture]
```

### Instrument strip

The canvas-level strip provides:

- Split view
- Link or unlink selections
- Time and round controls
- Compare
- Save checkpoint
- Pin Finding
- Export
- Command palette

### Signature interactions

#### Time Lens

A shared, zoomable scrubber aligns circuit ticks, syndrome rounds, wall-clock
time, calibration boundaries, alerts, and annotations. Its scale changes from
session overview to individual event without changing the selected object.

#### Diff Peel

A draggable divider compares two circuit revisions, calibration windows,
decoders, or cohorts in spatial views. Non-spatial panels use aligned columns
or delta overlays.

#### Failure Cards

Recurring failure clusters appear as compact cards with a syndrome fingerprint,
affected region, frequency, logical impact, decoder disagreement, uncertainty,
and last-seen time. Opening a card enters the Failure Microscope.

#### Focus isolation

Selecting an object dims unrelated structure and reveals its local temporal,
graph, decoder, and calibration context.

#### Scientific hover

Tooltips include value, unit, uncertainty, source, sample count, and data status.
They never contain only a name.

#### Hotspot feedback

New activity receives a brief outline or brightness change. Persistent hotspots
accumulate a stable intensity field. Reduced-motion mode uses static outlines.

## Synchronized QEC Visualizations

### Circuit playback

One tick/round cursor drives:

- Timeline gate and annotation focus
- Lattice active-qubit and stabilizer state
- Detector graph creation/activation context
- Inspector explanation and source link

Playback supports continuous run, single step, next detector-producing moment,
and follow-selected-stabilizer modes.

### Timeline

The existing Timeline evolves with semantic zoom, repeated-block compression,
round grouping, aligned detector/observable tracks, noise-density summaries,
and source navigation.

### Code Lattice

The lattice becomes a technical-drawing surface with:

- Data/measure qubit and stabilizer roles
- Basis and boundary encoding
- Active-operation animation
- Detector and calibration overlays
- Spatial error-rate and drift heatmaps
- Diff Peel comparison
- Selection-preserving zoom and pan

### Detector Graph

The graph retains its canvas renderer and gains:

- Semantic zoom from global topology to local mechanisms
- Probability, observed-frequency, calibration-correlation, and decoder overlays
- Hyperedge visibility and projection explanation
- Filterable boundary/logical edges
- Decoder correction comparison
- Stable label and focus behavior on large graphs
- Accessible tabular neighborhood view

### Space-Time Syndrome Explorer

The default dense representation uses:

- Horizontal axis: rounds or time
- Vertical grouping: detector, stabilizer, region, or logical patch
- Intensity: firing rate, correlation, anomaly score, or selected metric
- Aligned calibration, latency, alert, and annotation tracks

Users brush an interval to filter all linked views. A 3D space-time lattice is
optional for small selections and presentation; it is not the analytical
default.

### Error Atlas

The atlas aggregates:

- Persistent detector and edge hotspots
- Syndrome cluster families
- Logical-failure pathways
- Decoder disagreement regions
- Spatial and temporal drift
- Baseline versus candidate deltas

All aggregates expose sample count, confidence, filters, and time coverage.

## Failure Microscope

The Failure Microscope opens from a failed shot, anomaly, Failure Card, alert,
or selected cluster.

It contains:

1. Syndrome replay across rounds
2. Decoder trace and correction graph
3. Circuit tick context
4. Calibration context
5. Nearest corrected and failed neighbors
6. Same syndrome or cohort under another decoder
7. Provenance and ground-truth status

Simulation sessions may provide known observable truth. Hardware sessions
explicitly distinguish observed outcome, decoder prediction, inferred label,
and unavailable truth.

The Microscope can save a bounded incident dataset, pin a Finding, create a new
Cohort, or branch a simulation campaign from the observed conditions.

## Campaign Center

The Campaign Center replaces the current run button plus fixed stacked result
view.

### Before launch

- Visual parameter-space summary
- Codes, distances, rounds, noise values, decoders, and task count
- Estimated storage and compute pressure
- Validation and dependency state
- Resume source and prior results
- Explicit warnings for statistically weak or excessively large plans

### During collection

- Start, pause where supported, resume, cancel, clone, and branch
- Adaptive shot-allocation view
- Per-point shots, errors, uncertainty, stopping rule, and convergence
- Incremental threshold and decoder analyses
- Durable progress and crash recovery

### Analysis panels

- Threshold and Lambda with fit diagnostics
- Logical error per shot and per round
- Distance × noise heatmap
- Shot-allocation and convergence plot
- Decoder accuracy/latency/throughput Pareto frontier
- Decoder disagreement matrix
- Resource-scaling projection
- Calibration-conditioned logical performance
- Sortable/paginated table equivalent for every plot

Completed runs are immutable. Iteration creates a new editable campaign derived
from a selected result.

## Live Observatory

Observe mode prioritizes:

- Ingress rate, sequence gaps, duplicate/dropped batches, and clock alignment
- Decoder p50/p95/p99 latency, throughput, backlog, and timeout rate
- Detection-event rate by patch, stabilizer, and region
- Logical prediction and observable trends
- Calibration drift aligned with QEC metrics
- Hardware topology heat overlays
- Active alerts, annotations, and operator interventions
- Rolling comparison against a healthy baseline

Alerts are explicit local rules. Initial rule families include detector-rate
excursions, latency threshold breaches, calibration drift, sequence gaps,
schema/topology changes, and logical-performance degradation.

Selecting an alert freezes a bounded incident window without stopping durable
ingestion. The incident opens directly in replay and the Failure Microscope.

## Findings and Reports

### Finding states

- Observation
- Hypothesis
- Validated result
- Rejected hypothesis

Each Finding records a visual snapshot, live selection link, dataset and
revision IDs, query and recipe parameters, annotation, uncertainty summary, and
provenance health.

### Reproducible reports

Reports arrange Findings into:

- Summary
- Methods and environment
- Campaign or capture description
- Figures and captions
- Statistical tables
- Calibration context
- Exclusions and limitations
- Provenance appendix

Exports include Markdown/MDX, PDF-ready assets, SVG/PNG figures, CSV/Parquet
extracts, and a machine-readable reproduction manifest.

## Analysis Recipes

A recipe is versioned and inspectable. It declares compatible input schema,
parameters, outputs, statistical method, resource estimate, cancellation
behavior, and provenance fields.

Initial recipes include:

- Threshold and Lambda analysis
- Decoder benchmark
- Calibration-conditioned logical error rate
- Detector correlation matrix
- Syndrome clustering
- Failure-path frequency
- Drift and changepoint detection
- Baseline-versus-candidate comparison

Adapters or plugins may contribute recipes and visualization panels through
versioned capability manifests.

## Dirac Research Lens

Dirac receives bounded summaries and the active selection, not unrestricted
raw hardware data.

Dirac may:

- Explain the active visualization or failure trace
- Suggest or configure an analysis recipe
- Build a filter, comparison, or Cohort
- Summarize differences
- Draft a Finding, methods text, or figure caption
- Identify missing provenance or weak statistical support
- Scaffold an adapter or schema mapping

Numerical statements link to query results or source records. Conjecture is
labeled. Excluded data cannot be concealed. Live hardware commands require an
exact command preview and explicit confirmation.

## Canonical Data Model

The canonical schema is additive and versioned independently from the existing
kernel protocol.

### Session record

Required concepts:

- `schema_version`
- `session_id`
- `kind`: `simulation_campaign`, `hardware_import`, `hardware_live`, or
  `replay`
- Lifecycle status and timestamps
- Adapter identity and version
- Circuit, DEM, topology, and calibration references
- Detector, observable, measurement, and logical-patch counts
- Source clock and timebase description
- Segment list
- Provenance reference

### Syndrome batch

Required concepts:

- Session and segment IDs
- Sequence range
- Shot and/or round range
- Optional source timestamps
- Packed detection-event fields
- Optional packed measurements and observables
- Optional erasure/leakage/herald fields
- Topology/circuit revision reference
- Data-quality flags

### Decode result

Required concepts:

- Input syndrome range or identity
- Decoder name, version, and configuration hash
- Prediction and optional confidence
- Correction edges or compact correction reference
- Predicted logical flips
- Optional known truth
- Pipeline-stage and total latency
- Timeout/error status

### Calibration record

Long-form records contain:

- Effective time or interval
- Scope: device, patch, qubit, coupler, resonator, readout channel, or custom
- Parameter name and semantic identifier
- Value, unit, uncertainty, and quality flag
- Source system and calibration-run reference
- Original representation

### Provenance record

Required concepts:

- Original source identities and hashes
- Copy-versus-reference policy
- Adapter and schema versions
- Mapping decisions and unit conversions
- Circuit/DEM/topology revisions
- Environment and dependency versions
- Parent datasets and transformations
- Filters, exclusions, recipes, and parameters
- User annotations and control-plane audit references

The schema distinguishes absent, unavailable, unknown, inferred, predicted,
simulated, and measured values.

## Project Storage

Existing experiment directories remain unchanged. Study-managed QEC data uses:

```text
studies/
  surface-memory.qec-study.yaml
  surface-memory/
    snapshots/
    findings/
    reports/
qec-data/
  <session-id>/
    manifest.json
    journal.json
    raw/                 # optional copied sources or capture segments
    normalized/
      syndromes/
      decodes/
      calibrations/
      annotations/
    derived/
    indexes/
```

Users choose whether imported originals are copied into the project or safely
referenced in place. Both modes record hashes. Live captures always produce
durable project/session data.

## Data Storage and Tiered Compute

### Storage choices

- Arrow record batches for ingestion and process boundaries
- Parquet partitions for durable analytical records
- Packed binary fields for dense detector/measurement data
- DuckDB catalog and out-of-core query execution
- Existing Stim native files and sinter CSV retained as original artifacts
- Content hashes connecting normalized partitions to originals

### Tier 1: preview

- Bounded sample or aggregate
- Fast time-to-first-visual
- Browser-safe result sizes
- Progressive refinement

### Tier 2: local out-of-core

- Partition pruning
- Vectorized aggregation
- Cancellable worker jobs
- Memory and disk budgets
- Persistent derived results keyed by query/recipe identity

### Tier 3: lab compute adapter

- Optional Arrow Flight boundary
- Approved query/recipe submission
- Capability and authentication negotiation
- Aggregate or selected-batch return
- No requirement to move raw data through Nuclei-owned infrastructure

## Open Adapter SDK

Adapters execute outside the React process and declare a versioned manifest.

### Capabilities

- `probe`
- `validate`
- `preview`
- `import_batches`
- `stream_batches`
- `resume`
- `health`
- `record`
- `annotate`
- `request_calibration_snapshot`
- `start_session`
- `pause_session`
- `stop_session`

No adapter receives a capability it does not declare and the user or project
does not authorize.

### Core adapters

- Stim `.01`, `.b8`, `.r8`, `.ptb64`, `.hits`, and `.dets`
- Stim circuit and DEM metadata
- Sinter CSV and Nuclei QEC campaign directories
- Generic CSV and JSON Lines mapping
- Arrow IPC and Parquet
- Qiskit ExperimentData and calibration exports
- QECi-compatible capture and live envelopes

### Compliance requirements

- Probe is read-only
- Preview is deterministic and bounded
- Inputs are schema-validated
- Memory use is bounded
- Cancellation and resume are implemented where declared
- Duplicate and sequence-gap behavior is explicit
- Backpressure state is observable
- Provenance is complete
- Errors are actionable and never silently downgraded

Vendor and laboratory adapters belong in plugins unless a broadly adopted open
format justifies promotion into core.

## Application Architecture

```text
React Workbench
  │ JSON commands, query specs, visual tiles
  ▼
Tauri Orchestrator
  │ process lifecycle, permissions, paths, credentials
  ├──────── Existing Python Kernel
  │           Stim · sinter · decoders · simulation
  │
  └──────── QEC Data Engine
              adapters · Arrow batches · Parquet · DuckDB · recipes
                         │
                         └── optional Arrow Flight compute adapter
```

### React responsibilities

- Four-zone workspace and presets
- Panel registry and layouts
- Immutable Research Selection and trail
- Study/session/catalog presentation
- Progressive query state and caching
- Visualization rendering and interaction
- Job, stream, and control status
- No full large-dataset ownership

Primary modules:

- `QecWorkbench`
- `InvestigationCanvas`
- `ResearchSelectionStore`
- `StudyStore`
- `QecQueryStore`
- `QecJobStore`
- `QecStreamStore`
- Focused visualization and Inspector components

### Tauri responsibilities

- Manage kernel, data-engine, adapter, and worker lifecycles
- Enforce filesystem and command capabilities
- Store credentials through platform-secure facilities
- Provide project paths, file watching, and native dialogs
- Issue per-session local authentication material
- Keep control-plane audit records

### Python responsibilities

- Stim/sinter/decoder integration
- Import normalization
- Arrow/Parquet/DuckDB operations
- Statistical recipes and clustering
- Progressive query execution
- Worker cancellation and resource budgets
- Remote compute-adapter client

## Control Plane and Data Plane

The existing versioned JSON WebSocket remains the control plane for commands,
lifecycle, progress, errors, and small payloads.

Large syndrome data uses a separate local data plane. React requests compact
products rather than raw complete datasets:

- Time-series tiles
- Heatmap matrices
- Histograms and confidence summaries
- Selected shot/event windows
- Graph overlays
- Paginated table batches

The data plane uses local authenticated Arrow IPC batches between trusted
processes. Remote compute may use Arrow Flight. Browser-facing results remain
bounded and typed.

## Data Flow

```text
Source
 → adapter probe
 → schema/units/topology validation
 → bounded preview and mapping confirmation
 → normalized append-only batches
 → atomic partition write and journal commit
 → catalog/index update
 → incremental recipes
 → visualization tiles
 → linked research selection
 → drill-down query or Finding
```

Live ingestion joins after adapter negotiation and follows the same normalized
batch, partition, catalog, analysis, and visualization path. Replay reads the
recorded partitions through the same interface.

## Reliability and Error Handling

### Staged validation

1. Transport/file integrity and version
2. Schema and required fields
3. Detector/measurement widths
4. Sequence, timestamp, and round order
5. Units and original representation
6. Circuit, DEM, topology, and calibration references
7. Representative preview and anomaly summary

Invalid inputs enter visible quarantine. Mapping can be corrected or partitions
excluded, but data is never silently repaired.

### Durable ingestion

- Original inputs remain untouched
- Normalized partitions write atomically
- Checksums verify committed content
- Journals record the last committed sequence
- Interrupted work resumes from a verified boundary
- Duplicate batches are detected
- Schema changes begin a new segment
- Disk thresholds warn before loss
- Durable capture outranks expensive live analysis

### Backpressure

The UI always exposes connection state, ingress rate, queue depth, gaps,
duplicates, dropped batches, clock skew, analysis lag, disk pressure, and
telemetry freshness.

If visualization cannot keep up, refresh frequency degrades while capture
continues. If durable recording cannot keep up, the adapter's declared safe
policy is invoked and Nuclei raises a prominent incident. Silent dropping is
forbidden.

### Control safety

- No generic shell capability
- No arbitrary frontend-to-hardware messages
- Schema-validated commands
- Capability and permission enforcement in Tauri
- Explicit confirmation for disruptive commands
- Read-only mode
- Visible connection and adapter identity
- Complete audit trail
- Hard real-time correction remains external

### Privacy

Data remains local unless a user configures an external compute adapter or
explicitly sends bounded context to Dirac. Secrets are never stored in source or
Study manifests.

## Scientific Honesty

Every result displays or exposes:

- Sample count
- Uncertainty method
- Filters and exclusions
- Decoder identity and version
- Circuit/DEM/topology revision
- Calibration alignment quality
- Ground-truth status
- Recipe and environment version

Automated anomaly and correlation results are labeled as observations or
hypotheses. The UI does not claim causation.

## Accessibility

- All actions are keyboard reachable
- Focus order follows the visible four-zone structure
- Charts provide navigable data/table alternatives
- Legends and selections do not depend on color alone
- Screen-reader summaries describe chart purpose, selection, and major result
- Time Lens and playback are usable without drag
- Reduced-motion behavior replaces animation with static state changes
- Normal text meets at least WCAG 2.1 AA contrast
- Interactive targets meet desktop accessibility sizing and focus requirements

## Testing Strategy

### Test-driven workflow

Every implementation task follows red, green, refactor, and verification. New
scientific logic is introduced through known-answer or property tests before
production code.

### Correctness tests

- Golden Stim, DEM, sinter, hardware-like, calibration, and decoder fixtures
- Property tests for packed bits, batches, partitions, alignment, filters, and
  aggregates
- Known-answer statistical tests
- Cross-language TypeScript/Rust/Python schema tests
- Native-format round trips
- Missing/unknown/inferred ground-truth cases
- Partial calibration, sequence gap, malformed topology, and version failures

### Adapter compliance kit

One reusable suite verifies manifest, read-only probing, deterministic preview,
validation, bounded resources, resume, deduplication, cancellation,
backpressure, provenance, permissions, and error quality.

A synthetic stream adapter generates bursts, clock drift, gaps, duplicates,
reconnects, schema transitions, and corrupted records.

### Performance and soak tests

Measured budgets are defined for:

- Time to first preview
- Sustained ingestion throughput
- Recording backlog
- Query latency by tier
- Interaction frame time
- Import/replay memory ceiling
- Detector graph capacity
- Cancellation and recovery

Generated large datasets avoid giant repository fixtures. Multi-hour soak tests
verify bounded memory, stable disk growth, recovery, and no silent loss.

### UI tests

Each major panel covers empty, loading, progressive, populated, stale, partial,
disconnected, and error states.

The suite includes:

- Keyboard and screen-reader interaction
- Reduced motion
- Light-theme contrast
- Laptop and wide-monitor screenshot regression
- Linked selection and Research Trail
- Time Lens and Diff Peel
- Failure Microscope
- Build/Analyze/Observe preset transitions
- Progressive and cancelled queries

### End-to-end acceptance flows

1. Edit Stim → run campaign → select threshold outlier → inspect failed shot →
   compare decoder → pin Finding.
2. Import hardware capture → map topology/calibration → replay → isolate drift
   cohort → export report.
3. Connect synthetic live stream → record under load → trigger alert → freeze
   incident → replay after disconnect.
4. Stop and resume a large import or campaign without duplication.
5. Open an old Study after schema upgrades and reproduce its saved figures.

## Backward Compatibility and Migration

- Existing `.stim`, `.dem`, Stim result, sinter CSV, noise YAML, and experiment
  files remain valid.
- Existing QEC visualization panels become registered workbench panels rather
  than being deleted.
- Existing campaign results can be referenced by a Study without conversion.
- Normalization is additive and can be rebuilt from original artifacts.
- Kernel protocol additions remain versioned and additive.
- Canonical data schemas include explicit migrations and fixture coverage.
- Old Studies open read-only if a required adapter/recipe is unavailable, with
  a clear recovery path.

## Program Decomposition

The implementation plan must split the program into independently shippable
tracks with explicit dependencies:

1. Workbench shell, Study model, selection system, and light design foundation
2. Synchronized simulation visualizations and campaign integration
3. Failure Microscope, cohorts, diffing, and Error Atlas
4. Canonical schema, local data engine, storage, and generic offline import
5. Calibration alignment and hardware replay
6. Adapter SDK and compliance kit
7. Live ingestion and Observatory
8. Tiered compute and large-data hardening
9. Findings, reports, recipes, and Dirac Research Lens
10. Migration, documentation, performance, accessibility, and release hardening

Each track must include frontend design artifacts, component states, tests,
performance budgets, docs, migration behavior, and a release/demo gate.

## Acceptance Criteria

- A simulation researcher can complete the edit-to-Finding workflow without
  manually correlating filenames or reopening disconnected panels.
- A selected tick, detector, shot, campaign point, and calibration interval can
  drive all compatible views through one Research Selection.
- A hardware capture can be imported, validated, replayed, aligned with
  calibration data, and investigated without converting it outside Nuclei.
- A synthetic live stream can be recorded under load with visible backpressure,
  explicit gaps, recoverable state, and no silent data loss.
- A live incident can become a bounded replay dataset and Failure Microscope
  session without stopping ingestion.
- Large sessions use progressive tiles and out-of-core queries; React never
  owns the complete dataset.
- Every publication export includes machine-readable provenance.
- Adapter plugins cannot exceed declared and authorized capabilities.
- Existing Nuclei QEC projects continue to open and run.
- All new QEC surfaces meet the approved white/light-blue visual direction and
  light-theme accessibility criteria.
- Critical and high review findings, scientific golden-test failures, silent
  data-loss paths, and backward-compatibility regressions block release.

## Risks and Mitigations

### Scope expansion

**Risk:** Simulation workbench, hardware import, live observability, plugins,
and reporting could become multiple products.

**Mitigation:** One Study, Session, Dataset, Research Selection, panel registry,
and query contract. Build/Analyze/Observe are presets over the same product.

### Large-data complexity

**Risk:** Browser memory and JSON transport fail at realistic capture sizes.

**Mitigation:** Separate data plane, Arrow batches, Parquet/DuckDB, compact
visual tiles, progressive queries, and generated load tests.

### Proprietary hardware formats

**Risk:** Core becomes an unmaintainable collection of vendor integrations.

**Mitigation:** Open adapter SDK, generic/core formats, capability manifests,
and vendor plugins.

### False scientific confidence

**Risk:** Polished correlations or AI summaries appear causal or authoritative.

**Mitigation:** Ground-truth status, uncertainty, lineage, explicit hypothesis
states, and evidence-linked Dirac output.

### Lab safety

**Risk:** A desktop UI sends unsafe or ambiguous commands.

**Mitigation:** Control-plane-only boundary, Tauri capability enforcement,
schema validation, confirmation, read-only mode, and audit logs.

### Visual density

**Risk:** The four-zone workspace becomes overwhelming.

**Mitigation:** Curated presets, progressive disclosure, linked focus,
contextual Inspector, command palette, and excellent empty states.

### Theme divergence

**Risk:** QEC becomes visually detached from Nuclei.

**Mitigation:** Extend existing light tokens, reserve Dirac purple for Dirac,
and reject hardcoded dark-navy QEC surfaces.

## External Standards and Reuse

The implementation plan should validate versions and APIs against primary
sources before coding:

- Stim circuit, DEM, and result formats:
  <https://github.com/quantumlib/Stim/tree/main/doc>
- Sinter collection and resume behavior:
  <https://github.com/quantumlib/Stim>
- Riverlane QECi interface:
  <https://www.riverlane.com/get-qec-ready/qeci>
- Apache Arrow columnar and IPC formats:
  <https://arrow.apache.org/docs/format/Columnar.html>
- Apache Arrow Flight:
  <https://arrow.apache.org/docs/format/Flight.html>
- Apache Parquet:
  <https://parquet.apache.org/docs/>
- DuckDB and Parquet queries:
  <https://duckdb.org/docs/stable/data/parquet/overview>
- Qiskit Experiments data and calibration model:
  <https://qiskit-community.github.io/qiskit-experiments/>

## Approved Decisions

- Target both Stim/sinter simulation researchers and hardware teams.
- Deliver hardware support in offline/replay then live phases.
- Use an open adapter architecture rather than embedding every vendor in core.
- Design for tiered laptop, workstation, and optional lab-cluster scale.
- Keep Nuclei outside the deterministic correction loop while allowing safe
  observability and experiment-control commands.
- Use the Unified Workbench as the core architecture.
- Add Study snapshots and reports without turning the product into a notebook.
- Provide an Observe preset without creating a separate monitoring product.
- Build synchronized visualization, Failure Microscope, Error Atlas, Campaign
  Center, Live Observatory, Findings, recipes, and Dirac Research Lens.
- Use a white and light-blue visual system aligned with Nuclei light mode.
- Do not spend this program on dark-mode QEC design parity.
