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

import './qecImportWizard.css';

import type { QecImportClient as ClientContract } from '../../../services/qecDataClient';
import { useQecJobStore } from '../../../stores/qecJobStore';
import type {
  ImportPreviewResult,
  ImportProbeResult,
  ImportValidationResult,
} from '../../../types/qecDataProtocol';
import {
  IMPORT_STAGES,
  buildMapping,
  completeRows,
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

function StepRail({ stage }: { stage: number }): ReactElement {
  return (
    <ol className="qec-import-steps" aria-label="Import stages">
      {IMPORT_STAGES.map((label, index) => (
        <li key={label} aria-current={index === stage ? 'step' : undefined} data-complete={index < stage || undefined}>
          <span aria-hidden="true">{index < stage ? <Check size={13} /> : <Circle size={11} />}</span>
          <span>{label}</span>
        </li>
      ))}
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
      <header><FileCheck2 aria-hidden="true" size={19} /><div><strong>Project source</strong><span>No absolute or canonical data paths are accepted.</span></div></header>
      <dl className="qec-import-facts">
        <FieldValue label="Source" value={source} />
        <FieldValue label="Source size" value={probe.value ? formatBytes(probe.value.sourceByteSize) : 'Not reported'} />
        <FieldValue label="SHA-256" value={firstHash ?? 'Not reported'} />
        <FieldValue label="Source spans" value="Recorded by adapter during import" />
      </dl>
      <p className="qec-import-policy"><Copy aria-hidden="true" size={15} /><strong>Copy-only import</strong><span>Original preserved; canonical data receives a project-local source copy.</span></p>
    </div>
  );
}

function LoadingState({ label }: { label: string }): ReactElement {
  return <div className="qec-import-loading" role="status"><LoaderCircle aria-hidden="true" size={22} /><span>{label}</span></div>;
}

function InlineError({ message }: { message: string }): ReactElement {
  return <div className="qec-import-error" role="alert"><AlertCircle aria-hidden="true" size={18} /><span>{message}</span></div>;
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
        const label = `${adapter.adapterId.replaceAll('-', ' ')} · ${Math.round(adapter.confidence * 100)}% confidence`;
        return (
          <label key={`${adapter.adapterId}:${adapter.adapterVersion}`}>
            <input aria-label={`${adapter.adapterId[0]?.toUpperCase()}${adapter.adapterId.slice(1)} adapter, ${Math.round(adapter.confidence * 100)}% confidence`} type="radio" name="qec-adapter" checked={selected === adapter.adapterId} onChange={() => onSelect(adapter.adapterId)} />
            <Database aria-hidden="true" size={17} />
            <span><strong className="qec-import-capitalize">{label}</strong><small className="qec-mono">v{adapter.adapterVersion} · {adapter.sourceKind}</small></span>
            {Object.keys(adapter.details).length > 0 && <small className="qec-import-adapter-details">{Object.entries(adapter.details).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</small>}
          </label>
        );
      })}
    </fieldset>
  );
}

interface MappingStageProps {
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
  return (
    <div className="qec-import-mapping">
      <div className="qec-import-mapping__header"><strong>{count} mapped {count === 1 ? 'field' : 'fields'}</strong><button type="button" onClick={props.onAdd}><Plus aria-hidden="true" size={15} />Add field mapping</button></div>
      <div className="qec-import-mapping__labels" aria-hidden="true"><span>Canonical field</span><span>Source field</span><span /></div>
      {props.rows.map((row, index) => (
        <div className="qec-import-mapping__row" key={row.id}>
          <label><span>Canonical field {index + 1}</span><input aria-label={`Canonical field ${index + 1}`} value={row.canonical} onChange={(event) => props.onChange(row.id, 'canonical', event.target.value)} /></label>
          <label><span>Source field {index + 1}</span><input aria-label={`Source field ${index + 1}`} value={row.source} onChange={(event) => props.onChange(row.id, 'source', event.target.value)} /></label>
          <button type="button" aria-label={`Remove mapping ${index + 1}`} onClick={() => props.onRemove(row.id)}><Trash2 aria-hidden="true" size={15} /></button>
        </div>
      ))}
      <MappingOptionsForm options={props.options} onChange={props.onOptions} />
      <label className="qec-import-review"><input aria-label="Mapping reviewed" type="checkbox" checked={props.reviewed} onChange={(event) => props.onReviewed(event.target.checked)} /><span><strong>Mapping reviewed</strong><small>Widths, units, field meaning, and record class are explicit where required.</small></span></label>
    </div>
  );
}

function MappingOptionsForm({ options, onChange }: { options: MappingOptions; onChange(value: MappingOptions): void }): ReactElement {
  const set = (key: keyof MappingOptions, value: string): void => onChange({ ...options, [key]: value });
  return (
    <fieldset className="qec-import-options">
      <legend>Scientific meaning (never inferred)</legend>
      <label>Record class<select value={options.outputKind} onChange={(event) => set('outputKind', event.target.value)}><option value="">Adapter-native / validate</option><option value="syndromes">Syndrome events</option><option value="campaign_points">Sinter campaign aggregates</option><option value="calibration">Calibration records</option></select></label>
      <label>Detector width<input type="number" min="1" value={options.detectorCount} onChange={(event) => set('detectorCount', event.target.value)} /></label>
      <label>Observable width<input type="number" min="1" value={options.observableCount} onChange={(event) => set('observableCount', event.target.value)} /></label>
      <label>Timestamp unit<input value={options.timestampUnit} onChange={(event) => set('timestampUnit', event.target.value)} placeholder="e.g. ns" /></label>
      <label>Bit order<select value={options.bitOrder} onChange={(event) => set('bitOrder', event.target.value)}><option value="">Choose explicitly</option><option value="lsb0">LSB0</option></select></label>
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
  if (!preview.value) return <button type="button" className="qec-import-secondary" onClick={onLoad}>Load bounded preview</button>;
  const records = preview.value.batches.reduce((total, batch) => total + batch.recordCount, 0);
  return (
    <div className="qec-import-preview">
      <dl className="qec-import-facts"><FieldValue label="Preview records" value={String(records)} /><FieldValue label="Expected rows" value={preview.value.totalRecords === null ? 'Not reported' : String(preview.value.totalRecords)} /><FieldValue label="Provenance" value={preview.value.provenanceId ?? 'Not reported'} /><FieldValue label="Truncation" value={preview.value.truncated ? 'Preview truncated' : 'Complete bounded preview'} /></dl>
      <table><caption>Canonical batch summary</caption><thead><tr><th>Record kind</th><th>Records</th><th>Sequence</th></tr></thead><tbody>{preview.value.batches.map((batch) => <tr key={batch.segmentId}><td>{batch.recordKind}</td><td>{batch.recordCount}</td><td className="qec-mono">{batch.sequenceStart}–{batch.sequenceEnd}</td></tr>)}</tbody></table>
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
      <button type="button" className="qec-import-secondary" onClick={onValidate}>Validate mapping</button>
      {state.error && <InlineError message={state.error} />}
      {state.value?.valid && <div className="qec-import-success" role="status"><CheckCircle2 aria-hidden="true" size={18} /><div><strong>Validation passed</strong><span className="qec-mono">{state.value.provenanceId ?? 'Provenance pending'}</span></div></div>}
      {state.value && !state.value.valid && (
        <div className="qec-import-quarantine" role="alert">
          <header><ShieldAlert aria-hidden="true" size={19} /><div><strong>Quarantine required</strong><span>Original bytes remain preserved. Correct the mapped fields, then validate again.</span></div></header>
          <ul>{state.value.issues.map((issue) => <li key={`${issue.code}:${issue.field ?? ''}`} data-severity={issue.severity}><strong>{issue.field ?? issue.code}</strong><span>{issue.message}</span></li>)}</ul>
          <button type="button" ref={alertRef} aria-label={`Review ${firstError?.field ?? 'invalid'} mapping`} onClick={onReviewMapping}>Review mapping: {firstError?.message ?? 'Correct invalid fields.'}</button>
        </div>
      )}
      {state.value?.valid && state.value.issues.length > 0 && <ul className="qec-import-warnings" aria-label="Validation warnings">{state.value.issues.map((issue) => <li key={issue.code}><AlertCircle aria-hidden="true" size={15} />{issue.message}</li>)}</ul>}
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
      <label>Session ID<input aria-label="Session ID" value={props.sessionId} aria-invalid={issue !== null} onChange={(event) => props.onSessionId(event.target.value)} placeholder="capture-2026-07-22" />{issue && <small role="alert">{issue}</small>}</label>
      <label>Session kind<select value={props.sessionKind} onChange={(event) => props.onSessionKind(event.target.value as DestinationStageProps['sessionKind'])}><option value="hardware_import">Hardware import</option><option value="simulation_campaign">Simulation campaign</option><option value="hardware_live">Hardware live</option><option value="replay">Replay</option></select></label>
      <div className="qec-import-policy"><Copy aria-hidden="true" size={15} /><strong>Destination: qec-data/sessions/{props.sessionId || '<session-id>'}</strong><span>The source is copied; the original file is never edited or referenced in place.</span></div>
    </div>
  );
}

function ImportStage({ source, client }: { source: string; client: QecImportClient }): ReactElement {
  const jobs = useQecJobStore((state) => state.jobs);
  const job = Object.values(jobs).reverse().find((candidate) => candidate.source === source);
  const cancelJob = useQecJobStore((state) => state.cancelJob);
  const error = useQecJobStore((state) => state.launchError);
  if (!job) return error
    ? <InlineError message={error} />
    : <div className="qec-import-notice"><Database aria-hidden="true" size={20} /><div><strong>Ready for canonical import</strong><span>Import progress and completion remain in this tray if you change the active source.</span></div></div>;
  if (job.status === 'complete') return <div className="qec-import-success" role="status"><CheckCircle2 aria-hidden="true" size={19} /><div><strong>{job.recordsWritten ?? 0} records written</strong><span>{job.partitionsWritten ?? 0} canonical partitions · Original preserved</span></div></div>;
  if (job.status === 'cancelled') return <div className="qec-import-notice qec-import-terminal" role="status"><Circle aria-hidden="true" size={19} /><div><strong>Import cancelled</strong><span>Canonical writing stopped; the original source remains preserved.</span></div></div>;
  if (job.status === 'failed') return <div className="qec-import-error qec-import-terminal" role="alert"><AlertCircle aria-hidden="true" size={19} /><div><strong>Import failed</strong><span>{job.error ?? error ?? 'Canonical data was not completed.'}</span></div></div>;
  return <div className="qec-import-progress" role="progressbar" aria-label="QEC data import" aria-valuetext={job.message}><LoaderCircle aria-hidden="true" size={18} /><strong>{job.message}</strong><span className="qec-mono">{job.id}</span>{['running', 'starting'].includes(job.status) && <button type="button" aria-label={`Cancel import ${job.id}`} onClick={() => void cancelJob(client, job.id)}>Cancel</button>}</div>;
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
  if (!mappingReady) return 'review at least one explicit field mapping';
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
  const mappingReady = mappingIsReviewed(adapterId, rows, reviewed);
  const chooseAdapter = (id: string): void => { setAdapterId(id); invalidate(); };
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
  if (stage === 2) return <MappingStage rows={editor.rows} options={editor.options} reviewed={editor.reviewed} onAdd={editor.addRow} onChange={editor.changeRow} onRemove={editor.removeRow} onOptions={editor.changeOptions} onReviewed={editor.changeReviewed} />;
  if (stage === 3) return <PreviewStage validation={requests.validation.value} preview={requests.preview} onLoad={() => void requests.loadPreview(editor.adapterId, editor.mapping)} />;
  if (stage === 4) return <ValidationStage state={requests.validation} alertRef={requests.validationAlertRef} onValidate={() => void requests.validate(editor.adapterId, editor.mapping)} onReviewMapping={props.onReviewMapping} />;
  if (stage === 5) return <DestinationStage sessionId={props.sessionId} sessionKind={props.sessionKind} onSessionId={props.onSessionId} onSessionKind={props.onSessionKind} />;
  return <ImportStage source={source} client={props.client} />;
}

interface WizardFooterProps {
  stage: number; canAdvance: boolean; unavailable: string | null; launching: boolean;
  onBack(): void; onNext(): void; onImport(): void;
}

function WizardFooter(props: WizardFooterProps): ReactElement {
  return (
    <footer className="qec-import-wizard__footer">
      <div className="qec-import-nav"><button type="button" aria-label="Previous stage" disabled={props.stage === 0} onClick={props.onBack}><ArrowLeft aria-hidden="true" size={15} />Back</button><button type="button" aria-label="Next stage" disabled={!props.canAdvance} onClick={props.onNext}>Next<ArrowRight aria-hidden="true" size={15} /></button></div>
      <div className="qec-import-commit">{props.unavailable && <span role="status"><AlertCircle aria-hidden="true" size={14} />Import unavailable: {props.unavailable}</span>}<button type="button" disabled={props.unavailable !== null || props.launching} aria-busy={props.launching} onClick={props.onImport}>{props.launching ? <LoaderCircle aria-hidden="true" size={16} /> : <CheckCircle2 aria-hidden="true" size={16} />}Import data</button></div>
    </footer>
  );
}

function QecImportWizardSession({ source, client, onClose }: QecImportWizardProps): ReactElement {
  const [stage, setStage] = useState(0);
  const [sessionId, setSessionId] = useState('');
  const [sessionKind, setSessionKind] = useState<DestinationStageProps['sessionKind']>('hardware_import');
  const probe = useSourceProbe(client, source);
  const requests = useImportRequests(client, source);
  const editor = useMappingEditor(requests.invalidate);
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
    <section className="qec-import-wizard" aria-label={`Import ${source}`}>
      <header className="qec-import-wizard__header"><div><span>Canonical QEC data</span><h2>Import source</h2><p className="qec-mono">{source}</p></div>{onClose && <button type="button" aria-label="Close import wizard" onClick={onClose}><X aria-hidden="true" size={17} /></button>}</header>
      <div className="qec-import-wizard__body">
        <StepRail stage={stage} />
        <div className="qec-import-stage">
          <header><span>Stage {stage + 1} of {IMPORT_STAGES.length}</span><h3 tabIndex={-1} ref={stageHeadingRef}>{activeStage}</h3><p>{stageDescription(activeStage)}</p></header>
          <div className="qec-import-stage__content">
            <StageContent stage={stage} source={source} client={client} probe={probe} editor={editor} requests={requests} sessionId={sessionId} sessionKind={sessionKind} onSessionId={setSessionId} onSessionKind={setSessionKind} onReviewMapping={() => setStage(2)} />
          </div>
        </div>
      </div>
      <WizardFooter stage={stage} canAdvance={nextAllowed(stage, probe.value, editor.adapterId, editor.mappingReady, valid, sessionId)} unavailable={unavailable} launching={launching} onBack={() => setStage((current) => Math.max(0, current - 1))} onNext={() => setStage((current) => Math.min(IMPORT_STAGES.length - 1, current + 1))} onImport={() => void start()} />
    </section>
  );
}

export function QecImportWizard(props: QecImportWizardProps): ReactElement {
  return <QecImportWizardSession key={props.source} {...props} />;
}
