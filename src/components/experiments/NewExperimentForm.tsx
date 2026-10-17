import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs';
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
  findNameCollision,
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
import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button, IconButton, Select, TextArea, TextInput } from '../ui';

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
  /** Optional shared flag the parent reads to confirm before swapping targets. */
  dirtyRef?: MutableRefObject<boolean>;
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

type FormField = 'name' | 'entry' | 'shots' | 'seed' | 'sweep' | 'notes' | 'form';

interface FormIssue {
  field: FormField;
  text: string;
}

const FIELD_COPY: Record<string, { field: FormField; text: string }> = {
  name: { field: 'name', text: 'Give the experiment a name.' },
  entry: { field: 'entry', text: 'Choose the file to run.' },
  shots: { field: 'shots', text: 'Shots must be a whole number of at least 1.' },
  seed: { field: 'seed', text: 'Seed must be a whole number.' },
};

/** Maps a Zod issue to a human-readable message attached to the field it concerns. */
function humanizeIssue(issue: { path: PropertyKey[]; message: string }): FormIssue {
  const head = String(issue.path[0] ?? '');
  const known = FIELD_COPY[head];
  if (known) return known;
  const path = issue.path.map(String).join('.');
  const field: FormField = head === 'sweep' ? 'sweep' : head === 'notes' ? 'notes' : 'form';
  return { field, text: path ? `${path}: ${issue.message}` : issue.message };
}

function formatZodErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): FormIssue[] {
  return error.issues.map(humanizeIssue);
}

export function NewExperimentForm({ projectRoot, existing, dirtyRef: sharedDirtyRef, onClose }: NewExperimentFormProps) {
  const colors = useThemeStore((s) => s.colors);
  const platform = usePlatform();
  const hardwareBackends = useHardwareStore((s) => s.backends);
  const knownExperiments = useExperimentStore((s) => s.experiments);

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

  const ownDirtyRef = useRef(false);
  const dirtyRef = sharedDirtyRef ?? ownDirtyRef;
  const [touched, setTouched] = useState<ReadonlySet<FormField>>(new Set());
  const markDirty = (field: FormField = 'form') => {
    dirtyRef.current = true;
    setTouched((prev) => (prev.has(field) ? prev : new Set([...prev, field])));
  };
  const handleClose = () => {
    if (dirtyRef.current && !window.confirm('Discard your unsaved changes to this experiment?')) return;
    onClose();
  };

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
  }, [existing, dirtyRef]);

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
      return { ok: true as const, spec: parsed.data, errors: [] as FormIssue[], gridSize };
    } catch (e) {
      if (e instanceof GridExpansionError) {
        return { ok: false as const, spec: null, errors: [{ field: 'sweep' as FormField, text: e.message }], gridSize: e.count > 0 ? e.count : null };
      }
      throw e;
    }
  }, [candidate]);

  const entryKnown = entry.trim().length > 0 && entryFiles.includes(entry.trim());
  const visibleIssues = validation.errors.filter((i) => touched.has(i.field) || i.field === 'form' && touched.size > 0);
  const gridLabel = sweepRows.length === 0
    ? '1 point (no sweep)'
    : validation.gridSize === null
      ? '—'
      : `${validation.gridSize} point${validation.gridSize === 1 ? '' : 's'}`;
  const collision = existing ? undefined : findNameCollision(knownExperiments, name);
  const collisionText = collision
    ? `An experiment named "${collision.spec.name}" already exists (${collision.fileName}). Choose a different name.`
    : null;
  const canSubmit = validation.ok && !submitting && entry.trim().length > 0 && !collision;
  const disabledReason = canSubmit || submitting
    ? undefined
    : collisionText
      ? collisionText
      : entry.trim().length === 0
        ? 'Choose an entry file to continue'
        : validation.errors[0]?.text;

  const handleAddRow = () => { markDirty('sweep'); setSweepRows((rows) => [...rows, newSweepRow(nextRowId())]); };
  const handleRemoveRow = (id: string) => { markDirty('sweep'); setSweepRows((rows) => rows.filter((r) => r.id !== id)); };
  const updateRow = (id: string, patch: Partial<SweepRowState>) => {
    markDirty('sweep');
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
      if (!existing && await exists(path)) {
        setSubmitError(`A file named ${fileName} already exists in experiments/. Choose a different name.`);
        return;
      }
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
    fontFamily: TYPOGRAPHY.fontSans, marginBottom: 4,
  };
  return (
    <form
      onSubmit={(e) => { void handleSubmit(e); }}
      style={{
        padding: 12, borderTop: `1px solid ${colors.border}`,
        display: 'flex', flexDirection: 'column', gap: 10,
        fontFamily: TYPOGRAPHY.fontSans,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: colors.text, fontSize: 12, fontWeight: 600 }}>
          {existing ? `Edit ${existing.spec.name}` : 'New experiment'}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={handleClose}>Close</Button>
      </div>

      <div>
        <label style={labelStyle} htmlFor="exp-name">Name</label>
        <TextInput
          id="exp-name" mono value={name}
          onChange={(e) => { markDirty('name'); setName(e.target.value); }}
          placeholder="e.g. theta-sweep"
        />
      </div>

      <div>
        <label style={labelStyle} htmlFor="exp-entry">Entry file</label>
        <TextInput
          id="exp-entry" mono list="exp-entry-files" value={entry}
          onChange={(e) => { markDirty('entry'); setEntry(e.target.value); }}
          placeholder="e.g. vqe_h2.py"
        />
        <datalist id="exp-entry-files">
          {entryFiles.map((f) => <option key={f} value={f} />)}
        </datalist>
        {entry.trim() && !entryKnown && (
          <div style={{ color: colors.warning, fontSize: 11, marginTop: 4 }}>
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
          <TextInput
            id="exp-shots" mono type="number" min={1} value={shots}
            onChange={(e) => { markDirty('shots'); setShots(e.target.value); }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle} htmlFor="exp-seed">Seed</label>
          <TextInput
            id="exp-seed" mono type="number" value={seed}
            onChange={(e) => { markDirty('seed'); setSeed(e.target.value); }}
          />
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={labelStyle}>Sweep parameters</span>
          <Button type="button" size="sm" onClick={handleAddRow} icon={<Plus size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}>Add</Button>
        </div>
        {sweepRows.map((row) => (
          <div
            key={row.id} data-sweep-row
            style={{
              display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8, padding: 8,
              border: `1px solid ${colors.border}`, borderRadius: 'var(--radius-soft)', background: colors.bgPanel,
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <TextInput
                mono value={row.name} placeholder="theta" aria-label="Parameter name"
                onChange={(e) => updateRow(row.id, { name: e.target.value })}
                style={{ flex: 1 }}
              />
              <Select
                value={row.mode} aria-label="Sweep mode"
                onChange={(e) => updateRow(row.id, { mode: e.target.value as 'range' | 'values' })}
                style={{ width: 96, flexShrink: 0 }}
              >
                <option value="range">range</option>
                <option value="values">values</option>
              </Select>
              <IconButton aria-label={`Remove sweep parameter ${row.name || row.id}`} onClick={() => handleRemoveRow(row.id)}>
                <Trash2 size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
              </IconButton>
            </div>
            {row.mode === 'range' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                <TextInput mono value={row.rangeStart} onChange={(e) => updateRow(row.id, { rangeStart: e.target.value })} placeholder="start" aria-label="Range start" />
                <TextInput mono value={row.rangeStop} onChange={(e) => updateRow(row.id, { rangeStop: e.target.value })} placeholder="stop" aria-label="Range stop" />
                <TextInput mono value={row.rangeStep} onChange={(e) => updateRow(row.id, { rangeStep: e.target.value })} placeholder="step" aria-label="Range step" />
              </div>
            ) : (
              <TextInput
                mono value={row.valuesText} placeholder="0, 1, 2" aria-label="Values (comma separated)"
                onChange={(e) => updateRow(row.id, { valuesText: e.target.value })}
              />
            )}
          </div>
        ))}
      </div>

      <div>
        <label style={labelStyle} htmlFor="exp-notes">Notes (optional)</label>
        <TextArea
          id="exp-notes" value={notes} rows={2}
          onChange={(e) => { markDirty('notes'); setNotes(e.target.value); }}
        />
      </div>

      <div style={{ color: colors.textDim, fontSize: 11 }}>
        Grid size: {gridLabel}{sweepRows.length > 0 ? ` · max ${MAX_GRID_POINTS}` : ''}
      </div>

      <div className="nuclei-experiment-form__footer">
      {visibleIssues.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, color: colors.error, fontSize: 11 }}>
          {visibleIssues.map((err) => <li key={err.text}>{err.text}</li>)}
        </ul>
      )}
      {collisionText && (
        <div role="alert" style={{ color: colors.error, fontSize: 11 }}>{collisionText}</div>
      )}
      {disabledReason && !collisionText && visibleIssues.length === 0 && name.trim().length > 0 && (
        <div style={{ color: colors.textDim, fontSize: 11 }}>{disabledReason}</div>
      )}
      {submitError && (
        <div role="alert" style={{ color: colors.error, fontSize: 11 }}>{submitError}</div>
      )}

      <Button type="submit" variant="primary" size="lg" disabled={!canSubmit} title={disabledReason}>
        {submitting ? 'Saving…' : existing ? 'Save changes' : 'Create experiment'}
      </Button>
      </div>
    </form>
  );
}
