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
  ALIGN_STEPS_RANGE,
  EARLY_STOP_RANGE,
  METRIC_EVERY_RANGE,
  METRIC_REGULARIZATION_RANGE,
  NOISE_P_RANGE,
  NOISE_SHOTS_MAX,
  NOISE_SHOTS_MIN_FINITE,
  QML_EPOCHS_RANGE,
  QML_SAMPLES_RANGE,
  SAMPLES_RANGE,
  SPSA_A_RANGE,
  SPSA_C_RANGE,
  availableAnalyses,
  clampNoiseShots,
  defaultAnalyses,
  isChannelNoiseActive,
  validateScaling,
} from '../../services/trainability/settings';
import { RUN_SHORTCUT_LABEL, overallFraction, runDisabledReason } from './targetBarMath';
import { GRADIENT_METHODS, KERNEL_ALIGNMENT_MODES, QML_DATASETS, QML_OPTIMIZERS, TRAINABILITY_ANALYSES, ACTIVE_JOB_STATUSES, type GradientMethod, type KernelAlignmentMode, type QmlDataset, type QmlOptimizer, type TrainabilityAnalysis, type TrainabilityMethod, type GradientInit } from '../../types/trainability';

const OPTIMIZER_LABELS: Record<QmlOptimizer, string> = { adam: 'Adam', gd: 'Gradient descent', spsa: 'SPSA' };
const GRADIENT_METHOD_LABELS: Record<GradientMethod, string> = { adjoint: 'Adjoint', parameter_shift: 'Parameter-shift' };

const ANALYSIS_LABELS: Record<TrainabilityAnalysis, string> = {
  gradients: 'Gradients',
  scaling: 'Scaling',
  lie: 'Lie algebra',
  expressibility: 'Expressibility',
  entanglement: 'Entanglement',
  landscape: 'Landscape',
  quantum_kernel: 'Quantum kernel',
  variational_train: 'Variational training',
  classical_baseline: 'Classical baseline',
  kernel_alignment_search: 'Kernel alignment search',
  variational_qng: 'Variational QNG',
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
  const observableSource = useTrainabilityStore((s) => s.observableSource);
  const settings = useTrainabilityStore((s) => s.settings);
  const unavailable = useTrainabilityStore((s) => s.unavailable);
  const jobs = useTrainabilityStore((s) => s.jobs);
  const activeJobId = useTrainabilityStore((s) => s.activeJobId);
  const analysesOverride = useTrainabilityStore((s) => s.analysesOverride);
  const { setObservable, adoptFileObservable, setSettings, toggleAnalysis, cancel } = useTrainabilityStore.getState();

  const info = inspect.data;
  const available = availableAnalyses(info);
  const chosen = (analysesOverride ?? defaultAnalyses(info)).filter((a) => available.includes(a));
  const job = activeJobId ? jobs[activeJobId] : undefined;
  const running = !!job && ACTIVE_JOB_STATUSES.includes(job.status);
  const scalingCheck = validateScaling(settings);
  const scalingInvalid = chosen.includes('scaling') && (scalingCheck.qubits.error !== null || scalingCheck.layers.error !== null);
  const noParams = info !== null && info.parameters.length === 0;
  const disabledReason = runDisabledReason({
    unavailable: !!unavailable,
    running,
    chosenCount: chosen.length,
    scalingInvalid,
    inspecting: inspect.status === 'loading',
    noParameters: noParams,
  });
  const canRun = !unavailable && !running && disabledReason === null;
  const declared = info?.observable_declared?.trim() || null;
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
              hint={
                observable.trim() === ''
                  ? 'Empty uses Local Z, overriding any observable the file declares.'
                  : preset
                    ? preset.description
                    : 'Pauli sum, e.g. 0.5*Z0*Z1 + X2'
              }
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
            {observableSource === 'file' && (
              <div className="lab-row" style={{ marginTop: 'var(--space-1)' }}>
                <LabPill tone="dirac" outline title="Declared by this file as nuclei_observable. Edit the field or pick a preset to override it.">
                  from file
                </LabPill>
              </div>
            )}
            {observableSource !== 'file' && declared !== null && declared !== observable.trim() && (
              <div className="lab-row" style={{ marginTop: 'var(--space-1)', flexWrap: 'wrap' }}>
                <span className="lab-muted">This file declares</span>
                <span className="lab-mono" style={{ overflowWrap: 'anywhere' }}>{declared}</span>
                <LabButton size="sm" variant="ghost" onClick={() => adoptFileObservable()}>
                  Use the file&apos;s
                </LabButton>
              </div>
            )}
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

        {(chosen.includes('quantum_kernel') || chosen.includes('variational_train') || chosen.includes('classical_baseline') || chosen.includes('kernel_alignment_search') || chosen.includes('variational_qng')) && (
          <div className="lab-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            <LabField label="QML dataset" htmlFor="trainability-qml-dataset" hint="Binary, 2 features in [0, 2π)">
              <LabSelect id="trainability-qml-dataset" value={settings.qmlDataset} onChange={(e) => setSettings({ qmlDataset: e.target.value as QmlDataset })}>
                {QML_DATASETS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </LabSelect>
            </LabField>
            <LabField label="Dataset size" htmlFor="trainability-qml-samples" hint={`${QML_SAMPLES_RANGE.min}–${QML_SAMPLES_RANGE.max}`}>
              <LabNumber id="trainability-qml-samples" aria-label="Dataset size" value={settings.qmlSamples} min={QML_SAMPLES_RANGE.min} max={QML_SAMPLES_RANGE.max} onCommit={(qmlSamples) => setSettings({ qmlSamples })} />
            </LabField>
            {(chosen.includes('quantum_kernel') || chosen.includes('classical_baseline') || chosen.includes('kernel_alignment_search')) && (
              <LabField label="Ridge λ" htmlFor="trainability-ridge" hint="Kernel ridge regularization">
                <LabNumber id="trainability-ridge" aria-label="Ridge lambda" value={settings.ridgeLambda} min={0} max={100} onCommit={(ridgeLambda) => setSettings({ ridgeLambda })} />
              </LabField>
            )}
            {chosen.includes('classical_baseline') && (
              <LabField label="Linear floor" htmlFor="trainability-baseline-linear" hint="Also score the linear kernel">
                <LabButton
                  id="trainability-baseline-linear"
                  size="sm"
                  variant={settings.baselineIncludeLinear ? 'secondary' : 'ghost'}
                  aria-pressed={settings.baselineIncludeLinear}
                  onClick={() => setSettings({ baselineIncludeLinear: !settings.baselineIncludeLinear })}
                  style={settings.baselineIncludeLinear ? { background: 'var(--lab-quantum-soft)' } : undefined}
                >
                  Linear kernel
                </LabButton>
              </LabField>
            )}
            {chosen.includes('kernel_alignment_search') && (
              <>
                <LabField label="Alignment mode" htmlFor="trainability-align-mode" hint="What SPSA tunes">
                  <LabSelect id="trainability-align-mode" value={settings.alignMode} onChange={(e) => setSettings({ alignMode: e.target.value as KernelAlignmentMode })}>
                    {KERNEL_ALIGNMENT_MODES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </LabSelect>
                </LabField>
                <LabField label="Alignment steps" htmlFor="trainability-align-steps" hint={`${ALIGN_STEPS_RANGE.min}–${ALIGN_STEPS_RANGE.max} SPSA steps`}>
                  <LabNumber id="trainability-align-steps" aria-label="Alignment steps" value={settings.alignSteps} min={ALIGN_STEPS_RANGE.min} max={ALIGN_STEPS_RANGE.max} onCommit={(alignSteps) => setSettings({ alignSteps })} />
                </LabField>
              </>
            )}
            {chosen.includes('variational_qng') && (
              <>
                <LabField label="Metric λ" htmlFor="trainability-qng-reg" hint={`${METRIC_REGULARIZATION_RANGE.min}–${METRIC_REGULARIZATION_RANGE.max}, (g + λI)⁻¹`}>
                  <LabNumber id="trainability-qng-reg" aria-label="Metric regularization" value={settings.qngMetricRegularization} min={METRIC_REGULARIZATION_RANGE.min} max={METRIC_REGULARIZATION_RANGE.max} integer={false} step={0.001} onCommit={(qngMetricRegularization) => setSettings({ qngMetricRegularization })} />
                </LabField>
                <LabField label="Metric every" htmlFor="trainability-qng-every" hint={`Rebuild metric every ${METRIC_EVERY_RANGE.min}–${METRIC_EVERY_RANGE.max} epochs`}>
                  <LabNumber id="trainability-qng-every" aria-label="Metric every" value={settings.qngMetricEvery} min={METRIC_EVERY_RANGE.min} max={METRIC_EVERY_RANGE.max} onCommit={(qngMetricEvery) => setSettings({ qngMetricEvery })} />
                </LabField>
              </>
            )}
            {(chosen.includes('variational_train') || chosen.includes('variational_qng')) && (
              <>
                <LabField label="Epochs" htmlFor="trainability-epochs" hint={`${QML_EPOCHS_RANGE.min}–${QML_EPOCHS_RANGE.max}`}>
                  <LabNumber id="trainability-epochs" aria-label="Epochs" value={settings.epochs} min={QML_EPOCHS_RANGE.min} max={QML_EPOCHS_RANGE.max} onCommit={(epochs) => setSettings({ epochs })} />
                </LabField>
                <LabField label="Learning rate" htmlFor="trainability-lr" hint={settings.optimizer === 'spsa' ? 'Unused by SPSA' : 'Optimizer step size'}>
                  <LabNumber id="trainability-lr" aria-label="Learning rate" value={settings.learningRate} min={0} max={2} onCommit={(learningRate) => setSettings({ learningRate })} />
                </LabField>
                {chosen.includes('variational_train') && (
                <>
                <LabField label="Optimizer" htmlFor="trainability-optimizer" hint="Full-batch optimizer">
                  <LabSelect id="trainability-optimizer" value={settings.optimizer} onChange={(e) => setSettings({ optimizer: e.target.value as QmlOptimizer })}>
                    {QML_OPTIMIZERS.map((o) => (
                      <option key={o} value={o}>{OPTIMIZER_LABELS[o]}</option>
                    ))}
                  </LabSelect>
                </LabField>
                <LabField
                  label="Gradient method"
                  htmlFor="trainability-gradient-method"
                  hint={settings.optimizer === 'spsa' ? 'SPSA estimates its own gradient' : 'How ∂⟨O⟩/∂θ is computed'}
                >
                  <LabSelect
                    id="trainability-gradient-method"
                    value={settings.gradientMethod}
                    disabled={settings.optimizer === 'spsa'}
                    onChange={(e) => setSettings({ gradientMethod: e.target.value as GradientMethod })}
                  >
                    {GRADIENT_METHODS.map((m) => (
                      <option key={m} value={m}>{GRADIENT_METHOD_LABELS[m]}</option>
                    ))}
                  </LabSelect>
                </LabField>
                <LabField label="Early stop" htmlFor="trainability-early-stop" hint={`Patience ${EARLY_STOP_RANGE.min}–${EARLY_STOP_RANGE.max}, 0 = off`}>
                  <LabNumber id="trainability-early-stop" aria-label="Early stop patience" value={settings.earlyStopPatience} min={EARLY_STOP_RANGE.min} max={EARLY_STOP_RANGE.max} onCommit={(earlyStopPatience) => setSettings({ earlyStopPatience })} />
                </LabField>
                {settings.optimizer === 'spsa' && (
                  <>
                    <LabField label="SPSA a" htmlFor="trainability-spsa-a" hint={`${SPSA_A_RANGE.min}–${SPSA_A_RANGE.max}`}>
                      <LabNumber id="trainability-spsa-a" aria-label="SPSA a" value={settings.spsaA} min={SPSA_A_RANGE.min} max={SPSA_A_RANGE.max} integer={false} step={0.01} onCommit={(spsaA) => setSettings({ spsaA })} />
                    </LabField>
                    <LabField label="SPSA c" htmlFor="trainability-spsa-c" hint={`${SPSA_C_RANGE.min}–${SPSA_C_RANGE.max}`}>
                      <LabNumber id="trainability-spsa-c" aria-label="SPSA c" value={settings.spsaC} min={SPSA_C_RANGE.min} max={SPSA_C_RANGE.max} integer={false} step={0.01} onCommit={(spsaC) => setSettings({ spsaC })} />
                    </LabField>
                  </>
                )}
                </>
                )}
              </>
            )}
          </div>
        )}

        {(chosen.includes('gradients') || chosen.includes('quantum_kernel') || chosen.includes('variational_train') || chosen.includes('classical_baseline') || chosen.includes('kernel_alignment_search') || chosen.includes('variational_qng')) && (
          <div className="lab-stack" style={{ gap: 'var(--space-2)' }}>
            <div className="lab-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }} role="group" aria-label="Noise (simulated)">
              <span className="lab-muted" style={{ flex: '0 0 auto', paddingTop: 18 }}>Noise (simulated)</span>
              <LabField label="Shots" htmlFor="trainability-noise-shots" hint={`0 = exact, else ${NOISE_SHOTS_MIN_FINITE}–${NOISE_SHOTS_MAX}`}>
                <LabNumber id="trainability-noise-shots" aria-label="Noise shots" value={settings.noiseShots} min={0} max={NOISE_SHOTS_MAX} onCommit={(noiseShots) => setSettings({ noiseShots: clampNoiseShots(noiseShots) })} />
              </LabField>
              <LabField label="Depolarizing p" htmlFor="trainability-noise-depol" hint={`${NOISE_P_RANGE.min}–${NOISE_P_RANGE.max}, global channel`}>
                <LabNumber id="trainability-noise-depol" aria-label="Depolarizing p" value={settings.noiseDepolarizingP} min={NOISE_P_RANGE.min} max={NOISE_P_RANGE.max} integer={false} step={0.01} onCommit={(noiseDepolarizingP) => setSettings({ noiseDepolarizingP })} />
              </LabField>
              <LabField label="Readout flip q" htmlFor="trainability-noise-readout" hint={`${NOISE_P_RANGE.min}–${NOISE_P_RANGE.max}, symmetric flip`}>
                <LabNumber id="trainability-noise-readout" aria-label="Readout flip q" value={settings.noiseReadoutFlipP} min={NOISE_P_RANGE.min} max={NOISE_P_RANGE.max} integer={false} step={0.01} onCommit={(noiseReadoutFlipP) => setSettings({ noiseReadoutFlipP })} />
              </LabField>
            </div>
            {isChannelNoiseActive(settings) && settings.method === 'ppe' && chosen.includes('gradients') && (
              <LabCallout tone="warning" title="Noise needs sampling">
                Pauli propagation is exact and noiseless, so gradients with simulated noise will fail with <span className="lab-mono">noise_unsupported</span>. Switch Method to Sampling or Auto, or clear the noise fields.
              </LabCallout>
            )}
            {isChannelNoiseActive(settings) && (
              <span className="lab-muted">Simulated channel, not a device calibration. Applies to gradients and the QML analyses (quantum kernel, variational training, classical baseline, alignment search, QNG); other analyses note it as ignored.</span>
            )}
          </div>
        )}

        <div className="lab-row" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <LabButton
            variant="primary"
            icon={Play}
            shortcut={RUN_SHORTCUT_LABEL}
            disabled={!canRun}
            aria-describedby={disabledReason ? 'trainability-run-reason' : undefined}
            title={disabledReason ?? undefined}
            onClick={onRun}
          >
            Run analyses
          </LabButton>
          {disabledReason && (
            <span id="trainability-run-reason" className="lab-muted" style={{ flex: '1 1 220px', minWidth: 0 }}>
              {disabledReason}
            </span>
          )}
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
