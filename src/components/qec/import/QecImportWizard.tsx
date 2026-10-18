import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Database,
  FileCheck2,
  LoaderCircle,
  Plus,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { Button, Checkbox, IconButton, Select, TextInput } from '../../ui';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../ui/Table';
import { ICON_SIZE, ICON_STROKE } from '../../../styles/tokens';

import './qecImportWizard.css';

import type { QecImportClient as ClientContract } from '../../../services/qecDataClient';
import { useQecJobStore, type QecJobRecord } from '../../../stores/qecJobStore';
import { useResearchSelectionStore } from '../../../stores/researchSelectionStore';
import type {
  ImportPreviewResult,
  ImportProbeResult,
  ImportValidationResult,
} from '../../../types/qecDataProtocol';
import {
  IMPORT_STAGES,
  adapterDisplayName,
  adapterUsesNativeMapping,
  buildMapping,
  completeRows,
  countLabel,
  formatBytes,
  mappingIsReviewed,
  sessionIdIssue,
  stageDescription,
  supportedAdapters,
  type MappingOptions,
  type MappingRow,
} from './qecImportModel';

export type QecImportClient = ClientContract;

interface QecImportWizardProps {
  source: string;
  client: QecImportClient;
  onClose?: () => void;
  /** Rendered inside a dialog that already carries the title and close button. */
  hosted?: boolean;
}

const EMPTY_OPTIONS: MappingOptions = {
  outputKind: '', detectorCount: '', observableCount: '', timestampUnit: '', bitOrder: '',
};

interface AsyncState<T> {
  value: T | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_ASYNC = Object.freeze({ value: null, loading: false, error: null });

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'QEC Data Engine request failed.';
}

function StepRail({ stage, finished }: { stage: number; finished: boolean }): ReactElement {
  return (
    <ol className="qec-import-steps" aria-label="Import stages">
      {IMPORT_STAGES.map((label, index) => {
        const done = index < stage || finished;
        return (
        <li key={label} aria-current={index === stage && !finished ? 'step' : undefined} data-complete={done || undefined}>
          <span aria-hidden="true">{done ? <Check size={ICON_SIZE.sm} /> : <Circle size={ICON_SIZE.xs} />}</span>
          <span>{label}</span>
        </li>
        );
      })}
    </ol>
  );
}

function FieldValue({ label, value }: { label: string; value: string }): ReactElement {
  return <div><dt>{label}</dt><dd className="qec-mono">{value}</dd></div>;
}

function SourceStage({ source, probe }: { source: string; probe: AsyncState<ImportProbeResult> }): ReactElement {
  const firstHash = probe.value?.results.find((adapter) => adapter.sourceSha256)?.sourceSha256;
  if (probe.loading) return <LoadingState label="Probing source adapters" />;
  if (probe.error) return <InlineError message={probe.error} />;
  return (
    <div className="qec-import-card">
      <header><FileCheck2 aria-hidden="true" size={20} /><div><strong>Project source</strong><span>No absolute or canonical data paths are accepted.</span></div></header>
      <dl className="qec-import-facts">
        <FieldValue label="Source" value={source} />
        <FieldValue label="Source size" value={probe.value ? formatBytes(probe.value.sourceByteSize) : 'Not reported'} />
        <FieldValue label="SHA-256" value={firstHash ?? 'Not reported'} />
        <FieldValue label="Source spans" value="Recorded by adapter during import" />
      </dl>
      <p className="qec-import-policy"><Copy aria-hidden="true" size={16} /><strong>Copy-only import</strong><span>Original preserved; canonical data receives a project-local source copy.</span></p>
    </div>
  );
}

function LoadingState({ label }: { label: string }): ReactElement {
  return <div className="qec-import-loading" role="status"><LoaderCircle aria-hidden="true" size={20} /><span>{label}</span></div>;
}

function InlineError({ message }: { message: string }): ReactElement {
  return <div className="qec-import-error" role="alert"><AlertCircle aria-hidden="true" size={16} /><span>{message}</span></div>;
}

interface AdapterStageProps {
  probe: ImportProbeResult | null;
  selected: string;
  onSelect(id: string): void;
}

function AdapterStage({ probe, selected, onSelect }: AdapterStageProps): ReactElement {
  const adapters = supportedAdapters(probe);
  if (adapters.length === 0) return <InlineError message="No compatible adapter supports this source." />;
  return (
    <fieldset className="qec-import-adapters">
      <legend>Compatible adapters</legend>
      {adapters.map((adapter) => {
        const name = adapterDisplayName(adapter.adapterId);
        const confidence = Math.round(adapter.confidence * 100);
        const checked = selected === adapter.adapterId;
        return (
          <label key={`${adapter.adapterId}:${adapter.adapterVersion}`} className="qec-import-adapter" data-checked={checked || undefined}>
            <input aria-label={`${adapter.adapterId[0]?.toUpperCase()}${adapter.adapterId.slice(1)} adapter, ${confidence}% confidence`} type="radio" name="qec-adapter" checked={checked} onChange={() => onSelect(adapter.adapterId)} />
            <span className="qec-import-adapter__mark" aria-hidden="true">{checked && <Check className="nuclei-icon--bold" size={ICON_SIZE.xs} strokeWidth={3} />}</span>
            <Database aria-hidden="true" size={ICON_SIZE.md} />
            <span><strong>{name} · {confidence}% confidence</strong><small className="qec-mono">v{adapter.adapterVersion} · {adapter.sourceKind}</small></span>
            {Object.keys(adapter.details).length > 0 && <small className="qec-import-adapter-details">{Object.entries(adapter.details).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</small>}
          </label>
        );
      })}
    </fieldset>
  );
}

interface MappingStageProps {
  adapterId: string;
  rows: readonly MappingRow[];
  options: MappingOptions;
  reviewed: boolean;
  onAdd(): void;
  onChange(id: number, field: 'canonical' | 'source', value: string): void;
  onRemove(id: number): void;
  onOptions(options: MappingOptions): void;
  onReviewed(reviewed: boolean): void;
}

function MappingStage(props: MappingStageProps): ReactElement {
  const count = completeRows(props.rows).length;
  const native = adapterUsesNativeMapping(props.adapterId);
  return (
    <div className="qec-import-mapping">
      {native
        ? <div className="qec-import-mapping__header"><strong>Adapter-native fields</strong></div>
        : <><div className="qec-import-mapping__header"><strong>{count} mapped {count === 1 ? 'field' : 'fields'}</strong><Button size="sm" onClick={props.onAdd} icon={<Plus aria-hidden="true" size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}>Add field mapping</Button></div><div className="qec-import-mapping__labels" aria-hidden="true"><span>Canonical field</span><span>Source field</span><span /></div></>}
      {!native && props.rows.map((row, index) => (
        <div className="qec-import-mapping__row" key={row.id}>
          <label><span>Canonical field {index + 1}</span><TextInput mono aria-label={`Canonical field ${index + 1}`} value={row.canonical} onChange={(event) => props.onChange(row.id, 'canonical', event.target.value)} /></label>
          <label><span>Source field {index + 1}</span><TextInput mono aria-label={`Source field ${index + 1}`} value={row.source} onChange={(event) => props.onChange(row.id, 'source', event.target.value)} /></label>
          <IconButton className="qec-import-remove" aria-label={`Remove mapping ${index + 1}`} onClick={() => props.onRemove(row.id)}><Trash2 aria-hidden="true" size={ICON_SIZE.md} strokeWidth={ICON_STROKE} /></IconButton>
        </div>
      ))}
      <MappingOptionsForm adapterId={props.adapterId} options={props.options} onChange={props.onOptions} />
      <div className="qec-import-review">
        <Checkbox aria-label="Mapping reviewed" checked={props.reviewed} onCheckedChange={props.onReviewed} />
        <span><strong>Mapping reviewed</strong><small>Widths, units, field meaning, and record class are explicit where required.</small></span>
      </div>
    </div>
  );
}

function MappingOptionsForm({ adapterId, options, onChange }: { adapterId: string; options: MappingOptions; onChange(value: MappingOptions): void }): ReactElement {
  const set = (key: keyof MappingOptions, value: string): void => onChange({ ...options, [key]: value });
  if (adapterId === 'sinter-csv') {
    return <p className="qec-import-notice">Sinter defines campaign-point fields and units in its native statistics schema; no field mapping options are accepted.</p>;
  }
  if (adapterId === 'stim-results') {
    return (
      <fieldset className="qec-import-options">
        <legend>Stim result widths (required without circuit/DEM context)</legend>
        <label>Detector width<TextInput mono type="number" min="1" value={options.detectorCount} onChange={(event) => set('detectorCount', event.target.value)} /></label>
        <label>Observable width<TextInput mono type="number" min="0" value={options.observableCount} onChange={(event) => set('observableCount', event.target.value)} /></label>
      </fieldset>
    );
  }
  return (
    <fieldset className="qec-import-options">
      <legend>Scientific meaning (never inferred)</legend>
      <label>Record class<Select value={options.outputKind} onChange={(event) => set('outputKind', event.target.value)}><option value="">Adapter-native / validate</option><option value="syndromes">Syndrome events</option><option value="campaign_points">Sinter campaign aggregates</option><option value="calibration">Calibration records</option></Select></label>
      <label>Detector width<TextInput mono type="number" min="1" value={options.detectorCount} onChange={(event) => set('detectorCount', event.target.value)} /></label>
      <label>Observable width<TextInput mono type="number" min="1" value={options.observableCount} onChange={(event) => set('observableCount', event.target.value)} /></label>
      <label>Timestamp unit<TextInput mono value={options.timestampUnit} onChange={(event) => set('timestampUnit', event.target.value)} placeholder="e.g. ns" /></label>
      <label>Bit order<Select value={options.bitOrder} onChange={(event) => set('bitOrder', event.target.value)}><option value="">Choose explicitly</option><option value="lsb0">LSB0</option></Select></label>
    </fieldset>
  );
}

interface PreviewStageProps {
  validation: ImportValidationResult | null;
  preview: AsyncState<ImportPreviewResult>;
  onLoad(): void;
}

function PreviewStage({ validation, preview, onLoad }: PreviewStageProps): ReactElement {
  if (!validation?.valid) return <div className="qec-import-notice"><ShieldAlert aria-hidden="true" size={20} /><div><strong>Preview requires successful validation</strong><span>Continue to Validation. This prevents ambiguous widths, units, or status from reaching a canonical preview.</span></div></div>;
  if (preview.loading) return <LoadingState label="Loading bounded preview" />;
  if (preview.error) return <InlineError message={preview.error} />;
  if (!preview.value) return <Button onClick={onLoad} style={{ justifySelf: 'start' }}>Load bounded preview</Button>;
  const records = preview.value.batches.reduce((total, batch) => total + batch.recordCount, 0);
  return (
    <div className="qec-import-preview">
      <dl className="qec-import-facts"><FieldValue label="Preview records" value={String(records)} /><FieldValue label="Expected rows" value={preview.value.totalRecords === null ? 'Not reported' : String(preview.value.totalRecords)} /><FieldValue label="Provenance" value={preview.value.provenanceId ?? 'Not reported'} /><FieldValue label="Truncation" value={preview.value.truncated ? 'Preview truncated' : 'Complete bounded preview'} /></dl>
      <div className="qec-import-caption">Canonical batch summary</div>
      <Table label="Canonical batch summary" dense><Thead><Tr><Th>Record kind</Th><Th numeric>Records</Th><Th numeric>Sequence</Th></Tr></Thead><Tbody>{preview.value.batches.map((batch) => <Tr key={batch.segmentId}><Td text>{batch.recordKind}</Td><Td numeric>{batch.recordCount}</Td><Td numeric>{batch.sequenceStart}–{batch.sequenceEnd}</Td></Tr>)}</Tbody></Table>
    </div>
  );
}

interface ValidationStageProps {
  state: AsyncState<ImportValidationResult>;
  alertRef: React.RefObject<HTMLButtonElement | null>;
  onValidate(): void;
  onReviewMapping(): void;
}

function ValidationStage({ state, alertRef, onValidate, onReviewMapping }: ValidationStageProps): ReactElement {
  if (state.loading) return <LoadingState label="Validating mapping and source" />;
  const firstError = state.value?.issues.find((issue) => issue.severity === 'error');
  return (
    <div className="qec-import-validation">
      <Button onClick={onValidate} style={{ justifySelf: 'start' }}>{state.value?.valid ? 'Re-validate' : 'Validate mapping'}</Button>
      {state.error && <InlineError message={state.error} />}
      {state.value?.valid && <div className="qec-import-success" role="status"><CheckCircle2 aria-hidden="true" size={16} /><div><strong>Validation passed</strong><span className="qec-mono">{state.value.provenanceId ?? 'Provenance pending'}</span></div></div>}
      {state.value && !state.value.valid && (
        <div className="qec-import-quarantine" role="alert">
          <header><ShieldAlert aria-hidden="true" size={20} /><div><strong>Fix before importing</strong><span>Original bytes remain preserved. Correct the mapped fields, then validate again.</span></div></header>
          <ul>{state.value.issues.map((issue) => <li key={`${issue.code}:${issue.field ?? ''}`} data-severity={issue.severity}><strong>{issue.field ?? issue.code}</strong><span>{issue.message}</span></li>)}</ul>
          <Button ref={alertRef} aria-label={`Review ${firstError?.field ?? 'invalid'} mapping`} onClick={onReviewMapping} className="qec-import-quarantine__action">Review mapping</Button>
        </div>
      )}
      {state.value?.valid && state.value.issues.length > 0 && <ul className="qec-import-warnings" aria-label="Validation warnings">{state.value.issues.map((issue) => <li key={issue.code}><AlertCircle aria-hidden="true" size={16} />{issue.message}</li>)}</ul>}
    </div>
  );
}

interface DestinationStageProps {
  sessionId: string;
  sessionKind: 'hardware_import' | 'simulation_campaign' | 'hardware_live' | 'replay';
  onSessionId(value: string): void;
  onSessionKind(value: DestinationStageProps['sessionKind']): void;
}

function DestinationStage(props: DestinationStageProps): ReactElement {
  const issue = sessionIdIssue(props.sessionId.trim());
  return (
    <div className="qec-import-destination">
      <label>Session ID<TextInput mono aria-label="Session ID" value={props.sessionId} aria-invalid={issue !== null} onChange={(event) => props.onSessionId(event.target.value)} placeholder="capture-2026-07-22" invalid={issue !== null} />{issue && <small role="alert">{issue}</small>}</label>
      <label>Session kind<Select value={props.sessionKind} onChange={(event) => props.onSessionKind(event.target.value as DestinationStageProps['sessionKind'])}><option value="hardware_import">Hardware import</option><option value="simulation_campaign">Simulation campaign</option><option value="hardware_live">Hardware live</option><option value="replay">Replay</option></Select></label>
      <div className="qec-import-policy"><Copy aria-hidden="true" size={16} /><strong>Destination: qec-data/sessions/{props.sessionId || '<session-id>'}</strong><span>The source is copied; the original file is never edited or referenced in place.</span></div>
    </div>
  );
}

function ImportStage({ source, client }: { source: string; client: QecImportClient }): ReactElement {
  const jobs = useQecJobStore((state) => state.jobs);
  const job = Object.values(jobs).reverse().find((candidate) => candidate.source === source);
  const error = useQecJobStore((state) => state.launchError);
  if (!job) return error
    ? <InlineError message={error} />
    : <div className="qec-import-notice"><Database aria-hidden="true" size={20} /><div><strong>Ready for canonical import</strong><span>Import progress and completion remain in this tray if you change the active source.</span></div></div>;
  if (job.status === 'complete') return <div className="qec-import-success" role="status"><CheckCircle2 aria-hidden="true" size={20} /><div><strong>{countLabel(job.recordsWritten ?? 0, 'record')} written</strong><span>{countLabel(job.partitionsWritten ?? 0, 'canonical partition')} · Original preserved</span></div></div>;
  if (job.status === 'cancelled') return <div className="qec-import-notice qec-import-terminal" role="status"><Circle aria-hidden="true" size={20} /><div><strong>Import cancelled</strong><span>Canonical writing stopped; the original source remains preserved.</span></div></div>;
  if (job.status === 'failed') return <div className="qec-import-error qec-import-terminal" role="alert"><AlertCircle aria-hidden="true" size={20} /><div><strong>Import failed</strong><span>{job.error ?? error ?? 'Canonical data was not completed.'}</span></div></div>;
  return <ImportProgress job={job} client={client} />;
}

/** The running row takes focus when it appears: the Import button that had it is gone, and Back is hidden while it runs. */
function ImportProgress({ job, client }: { job: QecJobRecord; client: QecImportClient }): ReactElement {
  const cancelJob = useQecJobStore((state) => state.cancelJob);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <div ref={ref} tabIndex={-1} className="qec-import-progress" role="progressbar" aria-label="QEC data import" aria-valuetext={job.message}><LoaderCircle aria-hidden="true" size={16} /><strong>{job.message}</strong><span className="qec-mono">{job.id}</span>{['running', 'starting'].includes(job.status) && <Button size="sm" aria-label={`Cancel import ${job.id}`} onClick={() => void cancelJob(client, job.id)}>Cancel</Button>}</div>;
}

function nextAllowed(stage: number, probe: ImportProbeResult | null, adapterId: string, mappingReady: boolean, valid: boolean, sessionId: string): boolean {
  if (stage === 0) return probe !== null;
  if (stage === 1) return adapterId !== '';
  if (stage === 2) return mappingReady;
  if (stage === 4) return valid;
  if (stage === 5) return sessionId.trim() !== '';
  return stage < IMPORT_STAGES.length - 1;
}

function importUnavailable(probe: ImportProbeResult | null, adapterId: string, mappingReady: boolean, valid: boolean, sessionId: string): string | null {
  if (!probe) return 'probe must finish';
  if (!adapterId) return 'choose a supported adapter';
  if (!mappingReady) return adapterUsesNativeMapping(adapterId)
    ? 'review the adapter-native scientific requirements'
    : 'review at least one explicit field mapping';
  if (!valid) return 'mapping validation must pass';
  const sessionIssue = sessionIdIssue(sessionId.trim());
  if (sessionIssue) return sessionIssue;
  return null;
}

function useSourceProbe(client: QecImportClient, source: string): AsyncState<ImportProbeResult> {
  const [probe, setProbe] = useState<AsyncState<ImportProbeResult>>({ ...EMPTY_ASYNC, loading: true });
  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => {
      if (current) setProbe({ value: null, loading: true, error: null });
    });
    void client.probe(source).then(
      (value) => { if (current) setProbe({ value, loading: false, error: null }); },
      (error: unknown) => { if (current) setProbe({ value: null, loading: false, error: failureMessage(error) }); },
    );
    return () => { current = false; };
  }, [client, source]);
  return probe;
}

type ImportMapping = ReturnType<typeof buildMapping>;
interface RequestOwnership { generation: number; key: string; }

function nextOwnership(current: RequestOwnership, key: string): Readonly<RequestOwnership> {
  return Object.freeze({ generation: current.generation + 1, key });
}

function useImportRequests(client: QecImportClient, source: string) {
  const [validation, setValidation] = useState<AsyncState<ImportValidationResult>>(EMPTY_ASYNC);
  const [preview, setPreview] = useState<AsyncState<ImportPreviewResult>>(EMPTY_ASYNC);
  const validationAlertRef = useRef<HTMLButtonElement>(null);
  const validationOwner = useRef<Readonly<RequestOwnership>>(Object.freeze({ generation: 0, key: '' }));
  const previewOwner = useRef<Readonly<RequestOwnership>>(Object.freeze({ generation: 0, key: '' }));

  useEffect(() => {
    if (validation.value && !validation.value.valid) validationAlertRef.current?.focus();
  }, [validation.value]);

  const invalidate = useCallback((): void => {
    validationOwner.current = nextOwnership(validationOwner.current, '');
    previewOwner.current = nextOwnership(previewOwner.current, '');
    setValidation(EMPTY_ASYNC);
    setPreview(EMPTY_ASYNC);
  }, []);
  const validate = async (adapterId: string, mapping: ImportMapping): Promise<void> => {
    const key = JSON.stringify([source, adapterId, mapping]);
    const owner = nextOwnership(validationOwner.current, key);
    validationOwner.current = owner;
    setValidation({ value: null, loading: true, error: null });
    try {
      const value = await client.validate(source, adapterId, mapping);
      if (validationOwner.current === owner) setValidation({ value, loading: false, error: null });
    } catch (error: unknown) {
      if (validationOwner.current === owner) setValidation({ value: null, loading: false, error: failureMessage(error) });
    }
  };
  const loadPreview = async (adapterId: string, mapping: ImportMapping): Promise<void> => {
    const key = JSON.stringify([source, adapterId, mapping]);
    const owner = nextOwnership(previewOwner.current, key);
    previewOwner.current = owner;
    setPreview({ value: null, loading: true, error: null });
    try {
      const value = await client.preview(source, adapterId, mapping, 100);
      if (previewOwner.current === owner) setPreview({ value, loading: false, error: null });
    } catch (error: unknown) {
      if (previewOwner.current === owner) setPreview({ value: null, loading: false, error: failureMessage(error) });
    }
  };
  return { validation, preview, validationAlertRef, invalidate, validate, loadPreview };
}

function useMappingEditor(invalidate: () => void) {
  const [adapterId, setAdapterId] = useState('');
  const [rows, setRows] = useState<readonly MappingRow[]>(Object.freeze([]));
  const [nextRowId, setNextRowId] = useState(1);
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [reviewed, setReviewed] = useState(false);
  const mapping = useMemo(() => buildMapping(rows, options), [options, rows]);
  const mappingReady = mappingIsReviewed(adapterId, rows, options, reviewed);
  const chooseAdapter = (id: string): void => {
    setAdapterId(id);
    setRows(Object.freeze([]));
    setOptions(EMPTY_OPTIONS);
    setReviewed(false);
    invalidate();
  };
  const addRow = (): void => {
    setRows((current) => Object.freeze([...current, { id: nextRowId, canonical: '', source: '' }]));
    setNextRowId((current) => current + 1);
    invalidate();
  };
  const changeRow = (id: number, field: 'canonical' | 'source', value: string): void => {
    setRows((current) => Object.freeze(current.map((row) => row.id === id ? { ...row, [field]: value } : row)));
    invalidate();
  };
  const removeRow = (id: number): void => {
    setRows((current) => Object.freeze(current.filter((row) => row.id !== id)));
    invalidate();
  };
  const changeOptions = (value: MappingOptions): void => { setOptions(value); invalidate(); };
  const changeReviewed = (value: boolean): void => { setReviewed(value); invalidate(); };
  return { adapterId, rows, options, reviewed, mapping, mappingReady, chooseAdapter, addRow, changeRow, removeRow, changeOptions, changeReviewed };
}

interface StageContentProps {
  stage: number; source: string; client: QecImportClient; probe: AsyncState<ImportProbeResult>;
  editor: ReturnType<typeof useMappingEditor>;
  requests: ReturnType<typeof useImportRequests>;
  sessionId: string; sessionKind: DestinationStageProps['sessionKind'];
  onSessionId(value: string): void; onSessionKind(value: DestinationStageProps['sessionKind']): void;
  onReviewMapping(): void;
}

function StageContent(props: StageContentProps): ReactElement {
  const { stage, source, probe, editor, requests } = props;
  if (stage === 0) return <SourceStage source={source} probe={probe} />;
  if (stage === 1) return <AdapterStage probe={probe.value} selected={editor.adapterId} onSelect={editor.chooseAdapter} />;
  if (stage === 2) return <MappingStage adapterId={editor.adapterId} rows={editor.rows} options={editor.options} reviewed={editor.reviewed} onAdd={editor.addRow} onChange={editor.changeRow} onRemove={editor.removeRow} onOptions={editor.changeOptions} onReviewed={editor.changeReviewed} />;
  if (stage === 3) return <PreviewStage validation={requests.validation.value} preview={requests.preview} onLoad={() => void requests.loadPreview(editor.adapterId, editor.mapping)} />;
  if (stage === 4) return <ValidationStage state={requests.validation} alertRef={requests.validationAlertRef} onValidate={() => void requests.validate(editor.adapterId, editor.mapping)} onReviewMapping={props.onReviewMapping} />;
  if (stage === 5) return <DestinationStage sessionId={props.sessionId} sessionKind={props.sessionKind} onSessionId={props.onSessionId} onSessionKind={props.onSessionKind} />;
  return <ImportStage source={source} client={props.client} />;
}

interface WizardFooterProps {
  stage: number; canAdvance: boolean; unavailable: string | null; launching: boolean;
  finished: boolean; running: boolean; sessionId: string | null;
  onBack(): void; onNext(): void; onImport(): void; onClose?(): void;
}

const LAST_STAGE = IMPORT_STAGES.length - 1;
const RUNNING_STATUSES: ReadonlySet<string> = new Set(['starting', 'running', 'cancelling']);

function FinishedFooter({ sessionId, onClose }: { sessionId: string | null; onClose?(): void }): ReactElement {
  const selectPrimary = useResearchSelectionStore((state) => state.selectPrimary);
  const showRef = useRef<HTMLButtonElement>(null);
  // The Import button that had focus is gone; keep keyboard focus (and so Escape) inside the dialog.
  useEffect(() => { showRef.current?.focus(); }, []);
  const showSession = (): void => {
    if (sessionId) selectPrimary({ kind: 'session', id: sessionId, sessionId }, 'user');
    onClose?.();
  };
  return (
    <footer className="qec-import-wizard__footer qec-import-wizard__footer--finished">
      <div className="qec-import-commit">
        {onClose && <Button onClick={onClose}>Close</Button>}
        <Button ref={showRef} variant="primary" disabled={!sessionId} onClick={showSession}>Show session</Button>
      </div>
    </footer>
  );
}

function WizardFooter(props: WizardFooterProps): ReactElement {
  if (props.finished) return <FinishedFooter sessionId={props.sessionId} onClose={props.onClose} />;
  // The reason belongs where the person can act on it: the Import stage, not on stage 1 before anything was chosen.
  const reason = props.stage === LAST_STAGE ? props.unavailable : null;
  return (
    <footer className="qec-import-wizard__footer">
      <div className="qec-import-nav">{!props.running && <Button aria-label="Previous stage" disabled={props.stage === 0} onClick={props.onBack} icon={<ArrowLeft aria-hidden="true" size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}>Back</Button>}</div>
      <div className="qec-import-commit">
        {reason && <span role="status"><AlertCircle aria-hidden="true" size={14} />Import unavailable: {reason}</span>}
        {/* One primary action per stage: Next while the mapping is being built, Import data only on the last stage. */}
        {props.stage === LAST_STAGE
          ? <Button variant="primary" disabled={props.unavailable !== null} title={props.unavailable ? `Import unavailable: ${props.unavailable}` : undefined} loading={props.launching} onClick={props.onImport} icon={props.launching ? undefined : <CheckCircle2 aria-hidden="true" size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}>Import data</Button>
          : <Button variant="primary" aria-label="Next stage" disabled={!props.canAdvance} onClick={props.onNext}>Next<ArrowRight aria-hidden="true" size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} /></Button>}
      </div>
    </footer>
  );
}

/** The newest import job for this source launched since this wizard opened; earlier jobs never finish a fresh run. */
function useImportJob(source: string) {
  const jobs = useQecJobStore((state) => state.jobs);
  const [priorIds] = useState(() => new Set(Object.keys(useQecJobStore.getState().jobs)));
  const fresh = Object.entries(jobs).filter(([id]) => !priorIds.has(id)).map(([, job]) => job);
  return fresh.reverse().find((candidate) => candidate.source === source) ?? null;
}

/** Preselect the best supported adapter once the probe lands, so Next is never a dead end on stage 2. */
function useDefaultAdapter(probe: ImportProbeResult | null, adapterId: string, choose: (id: string) => void): void {
  useEffect(() => {
    if (adapterId !== '') return;
    const first = supportedAdapters(probe)[0];
    if (first) choose(first.adapterId);
  }, [probe, adapterId, choose]);
}

function QecImportWizardSession({ source, client, onClose, hosted = false }: QecImportWizardProps): ReactElement {
  const [stage, setStage] = useState(0);
  const [sessionId, setSessionId] = useState('');
  const [sessionKind, setSessionKind] = useState<DestinationStageProps['sessionKind']>('hardware_import');
  const probe = useSourceProbe(client, source);
  const requests = useImportRequests(client, source);
  const editor = useMappingEditor(requests.invalidate);
  useDefaultAdapter(probe.value, editor.adapterId, editor.chooseAdapter);
  const job = useImportJob(source);
  const finished = job?.status === 'complete';
  const valid = requests.validation.value?.valid === true;
  const unavailable = importUnavailable(probe.value, editor.adapterId, editor.mappingReady, valid, sessionId);
  const runImport = useQecJobStore((state) => state.runImport);
  const launching = useQecJobStore((state) => state.launching);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { stageHeadingRef.current?.focus(); }, [stage]);
  const start = async (): Promise<void> => {
    if (unavailable) return;
    setStage(IMPORT_STAGES.length - 1);
    await runImport(client, {
      source, adapterId: editor.adapterId, mapping: editor.mapping,
      sessionId: sessionId.trim(), sessionKind,
      sourceHash: requests.validation.value?.sourceSha256 ?? probe.value?.results.find((item) => item.adapterId === editor.adapterId)?.sourceSha256 ?? null,
      provenanceId: requests.validation.value?.provenanceId ?? null,
      sourceByteSize: probe.value?.sourceByteSize ?? null,
    });
  };

  const activeStage = IMPORT_STAGES[stage];
  return (
    <section className={hosted ? 'qec-import-wizard qec-import-wizard--hosted' : 'qec-import-wizard'} aria-label={`Import ${source}`}>
      {!hosted && <header className="qec-import-wizard__header"><div><span>Canonical QEC data</span><h2>Import source</h2><p className="qec-mono">{source}</p></div>{onClose && <IconButton variant="secondary" aria-label="Close import wizard" onClick={onClose}><X aria-hidden="true" size={ICON_SIZE.md} strokeWidth={ICON_STROKE} /></IconButton>}</header>}
      <div className="qec-import-wizard__body">
        <StepRail stage={stage} finished={finished} />
        <div className="qec-import-stage">
          <header><span>Stage {stage + 1} of {IMPORT_STAGES.length}</span><h3 tabIndex={-1} ref={stageHeadingRef}>{activeStage}</h3><p>{stageDescription(activeStage)}</p></header>
          <div className="qec-import-stage__content">
            <StageContent stage={stage} source={source} client={client} probe={probe} editor={editor} requests={requests} sessionId={sessionId} sessionKind={sessionKind} onSessionId={setSessionId} onSessionKind={setSessionKind} onReviewMapping={() => setStage(2)} />
          </div>
        </div>
      </div>
      <WizardFooter stage={stage} canAdvance={nextAllowed(stage, probe.value, editor.adapterId, editor.mappingReady, valid, sessionId)} unavailable={unavailable} launching={launching} finished={finished} running={launching || (job !== null && RUNNING_STATUSES.has(job.status))} sessionId={job?.sessionId ?? (sessionId.trim() || null)} onClose={onClose} onBack={() => setStage((current) => Math.max(0, current - 1))} onNext={() => setStage((current) => Math.min(IMPORT_STAGES.length - 1, current + 1))} onImport={() => void start()} />
    </section>
  );
}

export function QecImportWizard(props: QecImportWizardProps): ReactElement {
  return <QecImportWizardSession key={props.source} {...props} />;
}
