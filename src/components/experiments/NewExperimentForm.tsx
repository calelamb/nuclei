import { useEffect, useMemo, useRef, useState } from 'react';
import { mkdir, writeTextFile } from '@tauri-apps/plugin-fs';
import { stringify } from 'yaml';
import { Plus, Trash2 } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { usePlatform } from '../../platform/PlatformProvider';
import { useProjectStore } from '../../stores/projectStore';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useExperimentStore, type DiscoveredExperiment } from '../../services/experimentStore';
import { createTauriExperimentFs } from '../../services/experimentFs';
import { BackendSelector } from '../hardware/BackendSelector';
import {
  buildSweepFromRows,
  discoverEntryFiles,
  newSweepRow,
  parseNumberField,
  slugify,
  specToYamlDoc,
  sweepToRows,
  type SweepRowState,
} from './experimentFormHelpers';
import {
  expandGrid,
  experimentSpecSchema,
  GridExpansionError,
  inferLanguage,
  MAX_GRID_POINTS,
  type ExperimentSpec,
} from '../../types/experiment';
import type { BackendInfo } from '../../types/hardware';

const SIMULATOR_BACKEND: BackendInfo = {
  name: 'statevector',
  provider: 'simulator',
  qubitCount: 32,
  connectivity: [],
  queueLength: 0,
  averageErrorRate: 0,
  gateSet: [],
  status: 'online',
};

interface NewExperimentFormProps {
  projectRoot: string;
  /** Present when editing an existing experiment; absent for "New experiment". */
  existing?: DiscoveredExperiment;
  onClose(): void;
}

function fieldFromSpec(spec: ExperimentSpec, nextId: () => string) {
  return {
    name: spec.name,
    entry: spec.entry,
    backendName: spec.backend.target,
    shots: String(spec.shots),
    seed: String(spec.seed),
    notes: spec.notes ?? '',
    sweepRows: sweepToRows(spec.sweep, nextId),
  };
}

function formatZodErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

export function NewExperimentForm({ projectRoot, existing, onClose }: NewExperimentFormProps) {
  const colors = useThemeStore((s) => s.colors);
  const platform = usePlatform();
  const hardwareBackends = useHardwareStore((s) => s.backends);

  const rowIdRef = useRef(0);
  const nextRowId = () => `row-${rowIdRef.current++}`;

  // The form edits SWEEP experiments; campaign yamls are edited as text
  // until QEC Studio's UI phases land (PRD 10 D–F).
  const initial = existing && existing.spec.type !== 'qec_campaign'
    ? fieldFromSpec(existing.spec, nextRowId)
    : { name: '', entry: '', backendName: SIMULATOR_BACKEND.name, shots: '1024', seed: '42', notes: '', sweepRows: [] as SweepRowState[] };

  const [name, setName] = useState(initial.name);
  const [entry, setEntry] = useState(initial.entry);
  const [backendName, setBackendName] = useState<string | null>(initial.backendName);
  const [shots, setShots] = useState(initial.shots);
  const [seed, setSeed] = useState(initial.seed);
  const [notes, setNotes] = useState(initial.notes);
  const [sweepRows, setSweepRows] = useState<SweepRowState[]>(initial.sweepRows);
  const [entryFiles, setEntryFiles] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const dirtyRef = useRef(false);
  const markDirty = () => { dirtyRef.current = true; };

  // Discover candidate entry files for the datalist — best-effort, never blocks.
  useEffect(() => {
    let cancelled = false;
    void discoverEntryFiles(platform, projectRoot).then((files) => {
      if (!cancelled) setEntryFiles(files);
    });
    return () => { cancelled = true; };
  }, [platform, projectRoot]);

  // Convergence: while editing an existing experiment, an external change to
  // its YAML (hand-edit on disk, picked up by the store's watcher) re-syncs
  // the form's fields — but only until the user starts typing, so we never
  // clobber in-progress edits.
  useEffect(() => {
    if (!existing) return;
    return useExperimentStore.subscribe((state) => {
      if (dirtyRef.current) return;
      const updated = state.experiments.find((e) => e.fileName === existing.fileName);
      if (!updated || updated.spec.type === 'qec_campaign') return;
      const fields = fieldFromSpec(updated.spec, nextRowId);
      setName(fields.name);
      setEntry(fields.entry);
      setBackendName(fields.backendName);
      setShots(fields.shots);
      setSeed(fields.seed);
      setNotes(fields.notes);
      setSweepRows(fields.sweepRows);
    });
  }, [existing]);

  const backends: BackendInfo[] = useMemo(() => {
    const rest = hardwareBackends.filter((b) => b.provider !== 'simulator');
    return [SIMULATOR_BACKEND, ...rest];
  }, [hardwareBackends]);
  const selectedBackend = backends.find((b) => b.name === backendName) ?? null;

  const candidate: unknown = useMemo(() => ({
    schema: 1,
    name: name.trim() || 'untitled',
    entry: entry.trim(),
    language: inferLanguage(entry.trim()),
    backend: selectedBackend
      ? { provider: selectedBackend.provider, target: selectedBackend.name }
      : { provider: 'simulator', target: 'statevector' },
    shots: parseNumberField(shots),
    seed: parseNumberField(seed),
    sweep: buildSweepFromRows(sweepRows),
    ...(notes.trim() ? { notes: notes.trim() } : {}),
  }), [name, entry, selectedBackend, shots, seed, sweepRows, notes]);

  const validation = useMemo(() => {
    const parsed = experimentSpecSchema.safeParse(candidate);
    if (!parsed.success) {
      return { ok: false as const, spec: null, errors: formatZodErrors(parsed.error), gridSize: null as number | null };
    }
    try {
      const gridSize = expandGrid(parsed.data.sweep).length;
      return { ok: true as const, spec: parsed.data, errors: [] as string[], gridSize };
    } catch (e) {
      if (e instanceof GridExpansionError) {
        return { ok: false as const, spec: null, errors: [e.message], gridSize: e.count > 0 ? e.count : null };
      }
      throw e;
    }
  }, [candidate]);

  const entryKnown = entry.trim().length > 0 && entryFiles.includes(entry.trim());
  const canSubmit = validation.ok && !submitting && entry.trim().length > 0;

  const handleAddRow = () => { markDirty(); setSweepRows((rows) => [...rows, newSweepRow(nextRowId())]); };
  const handleRemoveRow = (id: string) => { markDirty(); setSweepRows((rows) => rows.filter((r) => r.id !== id)); };
  const updateRow = (id: string, patch: Partial<SweepRowState>) => {
    markDirty();
    setSweepRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validation.ok || !validation.spec) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const spec = validation.spec;
      const fileName = existing?.fileName ?? `${slugify(spec.name)}.experiment.yaml`;
      const dir = `${projectRoot}/experiments`;
      const path = `${dir}/${fileName}`;
      const yamlText = stringify(specToYamlDoc(spec));

      await mkdir(dir, { recursive: true });
      await writeTextFile(path, yamlText);

      useProjectStore.getState().openTab({ path, content: yamlText });
      await useExperimentStore.getState().reload(projectRoot, createTauriExperimentFs());
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', color: colors.textMuted, fontSize: 11,
    fontFamily: "'Geist Sans', sans-serif", marginBottom: 4,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px', fontSize: 12,
    fontFamily: "'Fira Code', monospace", background: colors.bgPanel,
    border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.text, outline: 'none',
  };

  return (
    <form
      onSubmit={(e) => { void handleSubmit(e); }}
      style={{
        padding: 12, borderTop: `1px solid ${colors.border}`,
        display: 'flex', flexDirection: 'column', gap: 10,
        fontFamily: "'Geist Sans', sans-serif",
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: colors.text, fontSize: 12, fontWeight: 600 }}>
          {existing ? 'Edit experiment' : 'New experiment'}
        </span>
        <button
          type="button" onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', fontSize: 11 }}
        >
          Close
        </button>
      </div>

      <div>
        <label style={labelStyle} htmlFor="exp-name">Name</label>
        <input
          id="exp-name" value={name}
          onChange={(e) => { markDirty(); setName(e.target.value); }}
          placeholder="theta-sweep" style={inputStyle}
        />
      </div>

      <div>
        <label style={labelStyle} htmlFor="exp-entry">Entry file</label>
        <input
          id="exp-entry" list="exp-entry-files" value={entry}
          onChange={(e) => { markDirty(); setEntry(e.target.value); }}
          placeholder="vqe_h2.py" style={inputStyle}
        />
        <datalist id="exp-entry-files">
          {entryFiles.map((f) => <option key={f} value={f} />)}
        </datalist>
        {entry.trim() && !entryKnown && (
          <div style={{ color: colors.warning, fontSize: 10, marginTop: 3 }}>
            Not found among scanned project files — will be validated against the project root.
          </div>
        )}
      </div>

      <div>
        <label style={labelStyle}>Backend</label>
        <BackendSelector backends={backends} selected={backendName} onSelect={(n) => { markDirty(); setBackendName(n); }} />
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle} htmlFor="exp-shots">Shots</label>
          <input
            id="exp-shots" type="number" min={1} value={shots}
            onChange={(e) => { markDirty(); setShots(e.target.value); }} style={inputStyle}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle} htmlFor="exp-seed">Seed</label>
          <input
            id="exp-seed" type="number" value={seed}
            onChange={(e) => { markDirty(); setSeed(e.target.value); }} style={inputStyle}
          />
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={labelStyle}>Sweep parameters</span>
          <button
            type="button" onClick={handleAddRow}
            style={{
              display: 'flex', alignItems: 'center', gap: 3, background: 'transparent',
              border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.accent,
              cursor: 'pointer', fontSize: 10, padding: '2px 6px',
            }}
          >
            <Plus size={11} /> Add
          </button>
        </div>
        {sweepRows.map((row) => (
          <div key={row.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            <input
              value={row.name} placeholder="theta"
              onChange={(e) => updateRow(row.id, { name: e.target.value })}
              style={{ ...inputStyle, width: 80 }}
            />
            <select
              value={row.mode}
              onChange={(e) => updateRow(row.id, { mode: e.target.value as 'range' | 'values' })}
              style={{ ...inputStyle, width: 80 }}
            >
              <option value="range">range</option>
              <option value="values">values</option>
            </select>
            {row.mode === 'range' ? (
              <>
                <input value={row.rangeStart} onChange={(e) => updateRow(row.id, { rangeStart: e.target.value })} placeholder="start" style={{ ...inputStyle, width: 60 }} />
                <input value={row.rangeStop} onChange={(e) => updateRow(row.id, { rangeStop: e.target.value })} placeholder="stop" style={{ ...inputStyle, width: 60 }} />
                <input value={row.rangeStep} onChange={(e) => updateRow(row.id, { rangeStep: e.target.value })} placeholder="step" style={{ ...inputStyle, width: 60 }} />
              </>
            ) : (
              <input
                value={row.valuesText} placeholder="0, 1, 2"
                onChange={(e) => updateRow(row.id, { valuesText: e.target.value })}
                style={{ ...inputStyle, flex: 1 }}
              />
            )}
            <button
              type="button" onClick={() => handleRemoveRow(row.id)}
              aria-label={`Remove sweep parameter ${row.name || row.id}`}
              style={{ background: 'transparent', border: 'none', color: colors.error, cursor: 'pointer' }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      <div>
        <label style={labelStyle} htmlFor="exp-notes">Notes (optional)</label>
        <textarea
          id="exp-notes" value={notes} rows={2}
          onChange={(e) => { markDirty(); setNotes(e.target.value); }}
          style={{ ...inputStyle, fontFamily: "'Geist Sans', sans-serif", resize: 'vertical' }}
        />
      </div>

      <div style={{ color: colors.textDim, fontSize: 11 }}>
        Grid size: {validation.gridSize ?? '—'} point{validation.gridSize === 1 ? '' : 's'} (cap {MAX_GRID_POINTS})
      </div>

      {validation.errors.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, color: colors.error, fontSize: 11 }}>
          {validation.errors.map((err) => <li key={err}>{err}</li>)}
        </ul>
      )}
      {submitError && (
        <div style={{ color: colors.error, fontSize: 11 }}>{submitError}</div>
      )}

      <button
        type="submit" disabled={!canSubmit}
        style={{
          padding: '7px 12px', background: canSubmit ? colors.accent : colors.border,
          color: canSubmit ? '#0a1220' : colors.textDim, border: 'none', borderRadius: 4,
          cursor: canSubmit ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600,
        }}
      >
        {submitting ? 'Saving…' : existing ? 'Save changes' : 'Create experiment'}
      </button>
    </form>
  );
}
