import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Copy, FolderOpen } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentStore } from '../../services/experimentStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { runsDirForExperiment } from '../../services/experimentRunner';
import { createTauriExperimentFs } from '../../services/experimentFs';
import { openRunFolder } from '../../lib/openRunFolder';
import { formatStartedAt, toChips, toMetricChips } from './runDetailFormat';
import { RunHistogram } from './RunHistogram';
import { RunCircuitDiagram } from './RunCircuitDiagram';
import { formatRunLabel, metricDecimals } from './runsTableColumns';
import { PanelHeader } from '../layout/PanelHeader';
import type { CircuitSnapshot, SimulationResult } from '../../types/quantum';
import type { RunRecord } from '../../types/experiment';
import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button, IconButton, Tabs } from '../ui';
import './experiments.css';

type OutputTab = 'stdout' | 'stderr';

interface RunArtifacts {
  result: SimulationResult | null;
  snapshot: CircuitSnapshot | null;
  stdout: string;
  stderr: string;
}

const EMPTY_ARTIFACTS: RunArtifacts = { result: null, snapshot: null, stdout: '', stderr: '' };

/**
 * PRD 09 Phase D (D3) — the store only parses `manifest.json` + `metrics.json`
 * (that's all `RunsTable` needs). Run detail additionally needs the raw
 * `result.json` / `snapshot.json` / `stdout.txt` / `stderr.txt`, read directly
 * off disk on demand — never crashing on a missing/corrupt artifact (a user
 * may legitimately delete files inside a run directory).
 */
async function loadArtifacts(runDir: string): Promise<RunArtifacts> {
  const fs = createTauriExperimentFs();
  const read = async (name: string): Promise<string | null> => {
    try {
      return await fs.readTextFile(fs.join(runDir, name));
    } catch {
      return null;
    }
  };
  const [resultText, snapshotText, stdout, stderr] = await Promise.all([
    read('result.json'),
    read('snapshot.json'),
    read('stdout.txt'),
    read('stderr.txt'),
  ]);

  let result: SimulationResult | null = null;
  let snapshot: CircuitSnapshot | null = null;
  try {
    result = resultText ? (JSON.parse(resultText) as SimulationResult) : null;
  } catch {
    result = null;
  }
  try {
    snapshot = snapshotText ? (JSON.parse(snapshotText) as CircuitSnapshot) : null;
  } catch {
    snapshot = null;
  }

  return { result, snapshot, stdout: stdout ?? '', stderr: stderr ?? '' };
}

type RowValue =
  | { kind: 'text'; text: string }
  | { kind: 'chips'; chips: string[] }
  | { kind: 'copy'; text: string }
  | { kind: 'error'; summary: string };

interface ManifestRowData {
  label: string;
  value: RowValue;
}

const text = (t: string): RowValue => ({ kind: 'text', text: t });

function copyToClipboard(value: string): void {
  navigator.clipboard?.writeText(value).catch(() => {
    // Clipboard can be denied (permissions / insecure context); the value stays selectable.
  });
}

function ManifestRow({ row, onViewTraceback }: { row: ManifestRowData; onViewTraceback?: () => void }) {
  const colors = useThemeStore((s) => s.colors);
  const { value } = row;
  const mono = { color: colors.text, fontSize: 11, fontFamily: TYPOGRAPHY.fontMono };
  return (
    <div style={{ display: 'flex', gap: 10, padding: '4px 0', alignItems: 'baseline' }}>
      <dt style={{ width: 130, flexShrink: 0, color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans }}>
        {row.label}
      </dt>
      <dd style={{ margin: 0, minWidth: 0, flex: 1 }}>
        {value.kind === 'text' && <span style={{ ...mono, wordBreak: 'break-word' }}>{value.text}</span>}
        {value.kind === 'chips' && (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {value.chips.map((chip) => (
              <span key={chip} style={{ ...mono, padding: '1px 8px', borderRadius: 'var(--radius-xs)', background: colors.bgPanel, border: `1px solid ${colors.border}` }}>
                {chip}
              </span>
            ))}
          </span>
        )}
        {value.kind === 'copy' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ ...mono, wordBreak: 'break-all' }}>{value.text}</span>
            <IconButton size="sm" aria-label={`Copy ${row.label}`} onClick={() => copyToClipboard(value.text)}>
              <Copy size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />
            </IconButton>
          </span>
        )}
        {value.kind === 'error' && (
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span style={{ ...mono, color: colors.error, wordBreak: 'break-word' }}>{value.summary}</span>
            {onViewTraceback && (
              <button type="button" className="nuclei-link-button" onClick={onViewTraceback}>View traceback ↓</button>
            )}
          </span>
        )}
      </dd>
    </div>
  );
}

/** The last non-empty line of a traceback: the exception itself, without the stack above it. */
function lastErrorLine(error: string): string {
  const lines = error.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return lines[lines.length - 1] ?? error;
}

function manifestRows(run: RunRecord, decimals: ReadonlyMap<string, number>): ManifestRowData[] {
  const m = run.manifest;
  const rows: ManifestRowData[] = [
    { label: 'Status', value: text(m.status) },
    { label: 'Point index', value: text(String(m.point_index)) },
    { label: 'Params', value: { kind: 'chips', chips: toChips(m.params) } },
    { label: 'Seed', value: text(`${m.seed} (honored: ${m.seed_honored ? 'yes' : 'no'})`) },
    { label: 'Backend', value: text(`${m.backend.provider}/${m.backend.target}`) },
    { label: 'Shots', value: text(String(m.shots)) },
    { label: 'Language', value: text(m.language) },
    { label: 'Entry', value: text(m.entry) },
    { label: 'Code SHA-256', value: { kind: 'copy', text: m.code_sha256 } },
    { label: 'Git', value: m.git ? { kind: 'copy', text: `${m.git.commit}${m.git.dirty ? ' (dirty)' : ''}` } : text('not a repo') },
    { label: 'Versions', value: { kind: 'chips', chips: toChips(m.versions) } },
    { label: 'Started at', value: text(formatStartedAt(m.started_at)) },
    { label: 'Duration', value: text(`${m.duration_ms.toLocaleString()} ms`) },
  ];
  // A complete run has no error to show; only failed runs get the row.
  if (m.error) rows.push({ label: 'Error', value: { kind: 'error', summary: lastErrorLine(m.error) } });
  if (Object.keys(run.metrics).length > 0) {
    rows.push({ label: 'Metrics', value: { kind: 'chips', chips: toMetricChips(run.metrics, decimals) } });
  }
  return rows;
}

export function RunDetail() {
  const colors = useThemeStore((s) => s.colors);
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const selectedFileName = useExperimentUiStore((s) => s.selectedExperimentFileName);
  const selectedRunDir = useExperimentUiStore((s) => s.selectedRunDir);
  const selectRun = useExperimentUiStore((s) => s.selectRun);
  const experiments = useExperimentStore((s) => s.experiments);
  const runsByExperiment = useExperimentStore((s) => s.runsByExperiment);

  const experiment = experiments.find((e) => e.fileName === selectedFileName) ?? null;
  const run = selectedFileName
    ? (runsByExperiment[selectedFileName] ?? []).find((r) => r.dir === selectedRunDir) ?? null
    : null;

  const backRef = useRef<HTMLButtonElement>(null);
  const outputRef = useRef<HTMLElement>(null);
  const siblingRuns = selectedFileName ? runsByExperiment[selectedFileName] : undefined;
  const decimals = useMemo(() => metricDecimals(siblingRuns ?? []), [siblingRuns]);

  const [artifacts, setArtifacts] = useState<RunArtifacts>(EMPTY_ARTIFACTS);
  const [tab, setTab] = useState<OutputTab>(run?.manifest.status === 'failed' ? 'stderr' : 'stdout');

  useEffect(() => {
    // When there's no selection, the component renders the "select a run"
    // fallback below (which never reads `artifacts`), so there's nothing to
    // reset here — avoids a synchronous setState-in-effect for a value nothing
    // will read.
    if (!projectRoot || !experiment || !selectedRunDir) return;
    let cancelled = false;
    const fs = createTauriExperimentFs();
    const runsDir = runsDirForExperiment(fs.join, projectRoot, experiment.fileName);
    const runDir = fs.join(runsDir, selectedRunDir);
    loadArtifacts(runDir).then((loaded) => {
      if (!cancelled) setArtifacts(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [projectRoot, experiment, selectedRunDir]);

  // Opening a run moves focus to Back, so the keyboard user lands inside the detail.
  const hasRun = Boolean(experiment && run && projectRoot);
  useEffect(() => {
    if (hasRun) backRef.current?.focus();
  }, [hasRun]);

  if (!experiment || !run || !projectRoot) {
    return (
      <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
        Select a run to see its details.
      </div>
    );
  }

  const fs = createTauriExperimentFs();
  const runsDir = runsDirForExperiment(fs.join, projectRoot, experiment.fileName);
  const runDirPath = fs.join(runsDir, run.dir);
  const output = tab === 'stdout' ? artifacts.stdout : artifacts.stderr;
  // A failed run usually produced no measurements or circuit; hide the empty sections.
  const showOutputs = run.manifest.status !== 'failed' || artifacts.result !== null || artifacts.snapshot !== null;

  return (
    <div
      style={{ height: '100%', overflow: 'auto', background: colors.bg }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        const target = e.target;
        if (target instanceof HTMLElement && target.closest('input, textarea, select, [role="menu"]')) return;
        e.preventDefault();
        selectRun(null);
      }}
    >
      {/* Shared PanelHeader (PRD 11 Phase C) — replaces the hand-rolled header.
          Leading = back-to-runs, title = run dir, actions = open run folder,
          overflow = Help→docs. */}
      <PanelHeader
        title={formatRunLabel(run.dir, run.manifest.started_at)}
        helpHref="https://getnuclei.dev/docs/research/experiments/"
        leading={
          <Button ref={backRef} variant="ghost" size="sm" onClick={() => selectRun(null)} icon={<ArrowLeft size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}>
            Back to runs
          </Button>
        }
        actions={
          <Button size="sm" onClick={() => void openRunFolder(runDirPath)} title="Open run folder" icon={<FolderOpen size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}>
            Open run folder
          </Button>
        }
      />

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <section>
          <div className="nuclei-overline" style={{ marginBottom: 8 }}>
            Manifest
          </div>
          <dl style={{ margin: 0 }}>
            {manifestRows(run, decimals).map((row) => (
              <ManifestRow
                key={row.label}
                row={row}
                onViewTraceback={() => {
                  setTab('stderr');
                  outputRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
                }}
              />
            ))}
          </dl>
        </section>

        {showOutputs && (
          <>
        <section>
          <div className="nuclei-overline" style={{ marginBottom: 8 }}>
            Measurements
          </div>
          <RunHistogram measurements={artifacts.result?.measurements ?? {}} />
        </section>

        <section>
          <div className="nuclei-overline" style={{ marginBottom: 8 }}>
            Circuit
          </div>
          <RunCircuitDiagram snapshot={artifacts.snapshot} />
        </section>

          </>
        )}

        <section ref={outputRef}>
          <Tabs
            aria-label="Run output"
            value={tab}
            onChange={setTab}
            options={[{ value: 'stdout', label: 'stdout' }, { value: 'stderr', label: 'stderr' }]}
            className="nuclei-output-tabs"
          />
          <pre role="tabpanel" aria-label={tab} style={{
            margin: 0, padding: 12, background: colors.bgPanel, border: `1px solid ${colors.border}`,
            borderRadius: 'var(--radius-soft)', color: tab === 'stderr' ? colors.error : colors.text,
            fontSize: 11, fontFamily: TYPOGRAPHY.fontMono, whiteSpace: 'pre-wrap',
            maxHeight: 200, overflow: 'auto',
          }}>
            {output || `No ${tab} recorded for this run.`}
          </pre>
        </section>
      </div>
    </div>
  );
}
