import { useEffect, useState } from 'react';
import { ArrowLeft, FolderOpen } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentStore } from '../../services/experimentStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { runsDirForExperiment } from '../../services/experimentRunner';
import { createTauriExperimentFs } from '../../services/experimentFs';
import { openRunFolder } from '../../lib/openRunFolder';
import { RunHistogram } from './RunHistogram';
import { RunCircuitDiagram } from './RunCircuitDiagram';
import { PanelHeader } from '../layout/PanelHeader';
import type { CircuitSnapshot, SimulationResult } from '../../types/quantum';
import type { RunRecord } from '../../types/experiment';

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

function ManifestRow({ label, value }: { label: string; value: string }) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div style={{ display: 'flex', gap: 10, padding: '3px 0' }}>
      <dt style={{ width: 130, flexShrink: 0, color: colors.textDim, fontSize: 11, fontFamily: "'Geist Sans', sans-serif" }}>
        {label}
      </dt>
      <dd style={{ margin: 0, color: colors.text, fontSize: 11, fontFamily: "'Fira Code', monospace", wordBreak: 'break-word' }}>
        {value}
      </dd>
    </div>
  );
}

function manifestRows(run: RunRecord): Array<{ label: string; value: string }> {
  const m = run.manifest;
  const rows = [
    { label: 'Status', value: m.status },
    { label: 'Point index', value: String(m.point_index) },
    { label: 'Params', value: JSON.stringify(m.params) },
    { label: 'Seed', value: `${m.seed} (honored: ${m.seed_honored ? 'yes' : 'no'})` },
    { label: 'Backend', value: `${m.backend.provider}/${m.backend.target}` },
    { label: 'Shots', value: String(m.shots) },
    { label: 'Language', value: m.language },
    { label: 'Entry', value: m.entry },
    { label: 'Code SHA-256', value: m.code_sha256 },
    { label: 'Git', value: m.git ? `${m.git.commit}${m.git.dirty ? ' (dirty)' : ''}` : 'not a repo' },
    { label: 'Versions', value: JSON.stringify(m.versions) },
    { label: 'Started at', value: m.started_at },
    { label: 'Duration', value: `${m.duration_ms.toLocaleString()} ms` },
    { label: 'Error', value: m.error ?? '—' },
  ];
  if (Object.keys(run.metrics).length > 0) {
    rows.push({ label: 'Metrics', value: JSON.stringify(run.metrics) });
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

  const [artifacts, setArtifacts] = useState<RunArtifacts>(EMPTY_ARTIFACTS);
  const [tab, setTab] = useState<OutputTab>('stdout');

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

  if (!experiment || !run || !projectRoot) {
    return (
      <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
        Select a run to see its details.
      </div>
    );
  }

  const fs = createTauriExperimentFs();
  const runsDir = runsDirForExperiment(fs.join, projectRoot, experiment.fileName);
  const runDirPath = fs.join(runsDir, run.dir);
  const output = tab === 'stdout' ? artifacts.stdout : artifacts.stderr;

  return (
    <div style={{ height: '100%', overflow: 'auto', background: colors.bg }}>
      {/* Shared PanelHeader (PRD 11 Phase C) — replaces the hand-rolled header.
          Leading = back-to-runs, title = run dir, actions = open run folder,
          overflow = Help→docs. */}
      <PanelHeader
        title={run.dir}
        context={experiment.spec.name}
        helpHref="https://getnuclei.dev/docs/research/experiments/"
        leading={
          <button
            onClick={() => selectRun(null)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, background: 'transparent',
              border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 12,
              fontFamily: "'Geist Sans', sans-serif", padding: 0,
            }}
          >
            <ArrowLeft size={13} /> Back to runs
          </button>
        }
        actions={
          <button
            onClick={() => void openRunFolder(runDirPath)}
            title="Open run folder"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 4,
              color: colors.textMuted, cursor: 'pointer', fontSize: 11, padding: '4px 8px',
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            <FolderOpen size={12} /> Open run folder
          </button>
        }
      />

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <section>
          <div style={{ color: colors.textDim, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Manifest
          </div>
          <dl style={{ margin: 0 }}>
            {manifestRows(run).map((row) => (
              <ManifestRow key={row.label} label={row.label} value={row.value} />
            ))}
          </dl>
        </section>

        <section>
          <div style={{ color: colors.textDim, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Measurements
          </div>
          <RunHistogram measurements={artifacts.result?.measurements ?? {}} />
        </section>

        <section>
          <div style={{ color: colors.textDim, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Circuit
          </div>
          <RunCircuitDiagram snapshot={artifacts.snapshot} />
        </section>

        <section>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {(['stdout', 'stderr'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                role="tab"
                aria-selected={tab === t}
                style={{
                  padding: '4px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                  background: tab === t ? colors.accent : 'transparent',
                  color: tab === t ? '#0a1220' : colors.textDim,
                  border: `1px solid ${tab === t ? colors.accent : colors.border}`,
                  borderRadius: 4, cursor: 'pointer', fontFamily: "'Geist Sans', sans-serif",
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <pre style={{
            margin: 0, padding: 10, background: colors.bgPanel, border: `1px solid ${colors.border}`,
            borderRadius: 6, color: tab === 'stderr' ? colors.error : colors.text,
            fontSize: 11, fontFamily: "'Fira Code', monospace", whiteSpace: 'pre-wrap',
            maxHeight: 200, overflow: 'auto',
          }}>
            {output || `No ${tab} recorded for this run.`}
          </pre>
        </section>
      </div>
    </div>
  );
}
