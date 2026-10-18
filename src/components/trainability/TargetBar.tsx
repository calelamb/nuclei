import { Play, Square } from 'lucide-react';
import {
  LabButton,
  LabCallout,
  LabCard,
  LabField,
  LabInput,
  LabNumber,
  LabPill,
  LabProgress,
  LabSelect,
  LabSkeleton,
} from '../lab';
import { useEditorStore } from '../../stores/editorStore';
import { useTrainabilityStore } from '../../stores/trainabilityStore';
import { OBSERVABLE_PRESETS, presetForSpec } from '../../services/trainability/observablePresets';
import {
  SAMPLES_RANGE,
  availableAnalyses,
  validateScaling,
} from '../../services/trainability/settings';
import { RUN_SHORTCUT_LABEL, overallFraction } from './targetBarMath';
import { TRAINABILITY_ANALYSES, ACTIVE_JOB_STATUSES, type TrainabilityAnalysis, type TrainabilityMethod, type GradientInit } from '../../types/trainability';

const ANALYSIS_LABELS: Record<TrainabilityAnalysis, string> = {
  gradients: 'Gradients',
  scaling: 'Scaling',
  lie: 'Lie algebra',
  expressibility: 'Expressibility',
  entanglement: 'Entanglement',
  landscape: 'Landscape',
};

function fileLabel(filePath: string | null): string {
  return filePath ? (filePath.split(/[\\/]/).pop() ?? filePath) : 'untitled';
}

export function TargetBar({ onRun }: { onRun: () => void }) {
  const filePath = useEditorStore((s) => s.filePath);
  const framework = useEditorStore((s) => s.framework);
  const inspect = useTrainabilityStore((s) => s.inspect);
  const observable = useTrainabilityStore((s) => s.observable);
  const observableError = useTrainabilityStore((s) => s.observableError);
  const settings = useTrainabilityStore((s) => s.settings);
  const unavailable = useTrainabilityStore((s) => s.unavailable);
  const jobs = useTrainabilityStore((s) => s.jobs);
  const activeJobId = useTrainabilityStore((s) => s.activeJobId);
  const analysesOverride = useTrainabilityStore((s) => s.analysesOverride);
  const { setObservable, setSettings, toggleAnalysis, cancel } = useTrainabilityStore.getState();

  const info = inspect.data;
  const available = availableAnalyses(info);
  const chosen = (analysesOverride ?? available).filter((a) => available.includes(a));
  const job = activeJobId ? jobs[activeJobId] : undefined;
  const running = !!job && ACTIVE_JOB_STATUSES.includes(job.status);
  const scalingCheck = validateScaling(settings);
  const scalingInvalid = chosen.includes('scaling') && (scalingCheck.qubits.error !== null || scalingCheck.layers.error !== null);
  const noParams = info !== null && info.parameters.length === 0;
  const canRun = !unavailable && !running && chosen.length > 0 && !scalingInvalid && inspect.status !== 'loading' && !noParams;
  const fraction = job ? overallFraction(job.analyses, job.progress) : null;
  const latest = job
    ? Object.entries(job.progress).sort((a, b) => a[1].fraction - b[1].fraction).find(([, p]) => p.fraction < 1)?.[1].message
    : undefined;
  const preset = presetForSpec(observable);

  return (
    <LabCard title="Target" aria-label="Trainability target">
      <div className="lab-stack" style={{ gap: 'var(--space-3)' }}>
        <div className="lab-row" style={{ flexWrap: 'wrap' }}>
          <LabPill tone="quantum" outline title={filePath ?? 'Unsaved buffer'}>
            <span className="lab-mono">{fileLabel(filePath)}</span>
          </LabPill>
          <LabPill>{info?.framework ?? framework}</LabPill>
          {info && (
            <>
              <LabPill title="Qubits"><span className="lab-mono">n = {info.n_qubits}</span></LabPill>
              <LabPill title="Free parameters"><span className="lab-mono">m = {info.parameters.length}</span></LabPill>
              {info.sweepable_params.map((name) => (
                <LabPill key={name} tone="dirac" outline title={`params.get("${name}") can be swept`}>
                  <span className="lab-mono">{name}</span>
                </LabPill>
              ))}
            </>
          )}
          {inspect.status === 'loading' && !info && <LabSkeleton height={22} width={140} />}
        </div>

        {inspect.status === 'error' && (
          <LabCallout tone="danger" title="Could not inspect this file">{inspect.error}</LabCallout>
        )}
        {noParams && (
          <LabCallout tone="info" title="No free parameters">
            This circuit has nothing to train. Use symbolic parameters (for example a Qiskit ParameterVector) to analyze it.
          </LabCallout>
        )}
        {(info?.notes ?? []).map((note) => (
          <LabCallout key={note} tone="info">{note}</LabCallout>
        ))}

        <div className="lab-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <div style={{ flex: '1 1 280px', minWidth: 220 }}>
            <LabField
              label="Observable"
              htmlFor="trainability-observable"
              hint={preset ? preset.description : 'Pauli sum, e.g. 0.5*Z0*Z1 + X2'}
              error={
                observableError
                  ? `${observableError.message}${observableError.column !== null ? ` (column ${observableError.column})` : ''}`
                  : undefined
              }
            >
              <LabInput
                id="trainability-observable"
                mono
                value={observable}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={observableError ? true : undefined}
                onChange={(e) => setObservable(e.target.value)}
              />
              {observableError?.column !== null && observableError?.column !== undefined && (
                <div className="lab-mono" aria-hidden style={{ color: 'var(--color-danger)', whiteSpace: 'pre', lineHeight: 1 }}>
                  {`${' '.repeat(Math.min(observableError.column, 120))}^`}
                </div>
              )}
            </LabField>
            <div className="lab-row" style={{ flexWrap: 'wrap', marginTop: 'var(--space-2)' }} role="group" aria-label="Observable presets">
              {OBSERVABLE_PRESETS.map((p) => (
                <LabButton
                  key={p.id}
                  size="sm"
                  variant="ghost"
                  aria-pressed={preset?.id === p.id}
                  title={p.description}
                  onClick={() => setObservable(p.spec)}
                  style={preset?.id === p.id ? { background: 'var(--lab-quantum-soft)' } : undefined}
                >
                  {p.label}
                </LabButton>
              ))}
            </div>
          </div>

          <div className="lab-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            <LabField label="Samples" htmlFor="trainability-samples" hint={`${SAMPLES_RANGE.min}–${SAMPLES_RANGE.max}`}>
              <LabNumber id="trainability-samples" aria-label="Samples" value={settings.samples} min={SAMPLES_RANGE.min} max={SAMPLES_RANGE.max} onCommit={(samples) => setSettings({ samples })} />
            </LabField>
            <LabField label="Seed" htmlFor="trainability-seed">
              <LabNumber id="trainability-seed" aria-label="Seed" value={settings.seed} min={0} max={2 ** 31 - 1} onCommit={(seed) => setSettings({ seed })} />
            </LabField>
            <LabField label="Method" htmlFor="trainability-method">
              <LabSelect id="trainability-method" value={settings.method} onChange={(e) => setSettings({ method: e.target.value as TrainabilityMethod })}>
                <option value="auto">Auto</option>
                <option value="sampling">Sampling</option>
                <option value="ppe">Pauli propagation</option>
              </LabSelect>
            </LabField>
            <LabField label="Init" htmlFor="trainability-init">
              <LabSelect id="trainability-init" value={settings.init} onChange={(e) => setSettings({ init: e.target.value as GradientInit })}>
                <option value="uniform">Uniform [0, 2π)</option>
                <option value="small">Small N(0, 0.1²)</option>
              </LabSelect>
            </LabField>
          </div>
        </div>

        <div className="lab-row" style={{ flexWrap: 'wrap' }} role="group" aria-label="Analyses to run">
          {TRAINABILITY_ANALYSES.map((a) => {
            const enabled = available.includes(a);
            const on = chosen.includes(a);
            return (
              <LabButton
                key={a}
                size="sm"
                variant={on ? 'secondary' : 'ghost'}
                aria-pressed={on}
                disabled={!enabled}
                title={enabled ? undefined : 'Needs a sweepable n_qubits parameter in the code'}
                onClick={() => toggleAnalysis(a)}
                style={on ? { background: 'var(--lab-quantum-soft)' } : undefined}
              >
                {ANALYSIS_LABELS[a]}
              </LabButton>
            );
          })}
        </div>

        {chosen.includes('scaling') && (
          <div className="lab-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            <LabField
              label="Scaling qubits"
              htmlFor="trainability-scaling-qubits"
              hint="Up to 12 values in 2–128; above 20 needs Pauli propagation"
              error={scalingCheck.qubits.error ?? undefined}
            >
              <LabInput id="trainability-scaling-qubits" mono value={settings.scalingQubitsText} onChange={(e) => setSettings({ scalingQubitsText: e.target.value })} />
            </LabField>
            <LabField label="Layers" htmlFor="trainability-scaling-layers" hint="Up to 4 values" error={scalingCheck.layers.error ?? undefined}>
              <LabInput id="trainability-scaling-layers" mono value={settings.scalingLayersText} onChange={(e) => setSettings({ scalingLayersText: e.target.value })} />
            </LabField>
          </div>
        )}

        <div className="lab-row" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <LabButton variant="primary" icon={Play} shortcut={RUN_SHORTCUT_LABEL} disabled={!canRun} onClick={onRun}>
            Run analyses
          </LabButton>
          {running && (
            <LabButton variant="danger" icon={Square} disabled={job?.status === 'cancelling'} onClick={() => void cancel()}>
              {job?.status === 'cancelling' ? 'Cancelling…' : 'Cancel'}
            </LabButton>
          )}
          {running && (
            <div style={{ flex: '1 1 200px', minWidth: 160 }} aria-live="polite">
              <LabProgress value={fraction} label="Analysis progress" />
              <div className="lab-muted lab-mono" style={{ marginTop: 'var(--space-1)' }}>{latest ?? 'Starting…'}</div>
            </div>
          )}
        </div>
      </div>
    </LabCard>
  );
}
