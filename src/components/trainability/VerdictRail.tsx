import { useMemo } from 'react';
import { AlertTriangle, FileDown, Info, OctagonAlert, type LucideIcon } from 'lucide-react';
import {
  LabButton,
  LabCallout,
  LabCard,
  LabCitation,
  LabEmptyState,
  LabPill,
  LabSkeleton,
  type LabTone,
} from '../lab';
import { usePlatform } from '../../platform/PlatformProvider';
import { useNavigationStore } from '../../stores/navigationStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTrainabilityStore } from '../../stores/trainabilityStore';
import {
  deriveSimulabilityVerdict,
  deriveTrainabilityVerdict,
  type BpRisk,
  type EvidenceItem,
  type EvidenceLevel,
  type SimulabilityVerdict,
} from '../../services/trainability/verdict';
import { certificatePaths } from '../../services/trainability/certificate';
import { diagnosticMessage } from '../../services/trainability/diagnosticCopy';
import type { TrainabilityDiagnostic, TrainabilityJobRecord, TrainabilitySeverity } from '../../types/trainability';

const RISK_TONE: Record<BpRisk, LabTone> = { high: 'danger', medium: 'warning', low: 'success', unknown: 'neutral' };
/** Human labels for the evidence chain; the verdict's internal ids never reach the UI. */
const EVIDENCE_SOURCE_LABEL: Record<EvidenceItem['source'], string> = {
  scaling: 'Scaling',
  lie: 'Lie algebra',
  gradients: 'Gradients',
  lint: 'Lint',
  circuit: 'Circuit',
};
const SIMULABILITY_LABEL: Record<SimulabilityVerdict['kind'], string> = {
  g_sim_feasible: 'Classically simulable (𝔤-sim)',
  g_sim_not_applicable: 'Small DLA, 𝔤-sim not applicable',
  exponential_dla: 'Exponential DLA',
  unknown: 'Unknown',
};
const LEVEL_TONE: Record<EvidenceLevel, LabTone> = { high: 'danger', medium: 'warning', low: 'success', info: 'neutral' };
const SEVERITY_ICON: Record<TrainabilitySeverity, LucideIcon> = { error: OctagonAlert, warning: AlertTriangle, info: Info };
const SEVERITY_TONE: Record<TrainabilitySeverity, LabTone> = { error: 'danger', warning: 'warning', info: 'neutral' };

export function TrainabilityCard({ job, diagnostics }: { job: TrainabilityJobRecord | null; diagnostics: readonly TrainabilityDiagnostic[] }) {
  const nParameters = job?.target.nParameters ?? null;
  const verdict = useMemo(
    () => deriveTrainabilityVerdict(job?.results ?? {}, diagnostics, { nParameters }),
    [job, diagnostics, nParameters],
  );
  return (
    <LabCard title="Trainability" subtitle="Barren-plateau risk">
      <div className="lab-stack" style={{ gap: 'var(--space-3)' }}>
        <div className="lab-row">
          <LabPill tone={RISK_TONE[verdict.risk]} dot>
            {verdict.notApplicable ? 'BP risk: n/a (no free parameters)' : `BP risk: ${verdict.risk}`}
          </LabPill>
          {job?.status && job.status !== 'complete' && <LabPill outline>{job.status}</LabPill>}
        </div>
        {verdict.evidence.length === 0 ? (
          <p className="lab-muted" style={{ margin: 0 }}>
            No evidence yet. Run the analyses to build the chain: scaling fit, Lie algebra, gradient statistics and lint.
          </p>
        ) : (
          <ol aria-label="Evidence chain" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--space-2)' }}>
            {verdict.evidence.map((e, index) => (
              <li key={`${e.source}-${index}-${e.text}`} className="lab-row" style={{ alignItems: 'flex-start' }}>
                <LabPill tone={LEVEL_TONE[e.level]} outline>{EVIDENCE_SOURCE_LABEL[e.source]}</LabPill>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{e.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </LabCard>
  );
}

export function SimulabilityCard({ job }: { job: TrainabilityJobRecord | null }) {
  const verdict = useMemo(() => deriveSimulabilityVerdict(job?.results ?? {}), [job]);
  const tone: LabTone = verdict.kind === 'g_sim_feasible' ? 'success' : verdict.kind === 'exponential_dla' ? 'warning' : 'neutral';
  return (
    <LabCard title="Simulability" subtitle="Classical simulation evidence">
      <div className="lab-stack" style={{ gap: 'var(--space-2)' }}>
        <div className="lab-row">
          <LabPill tone={tone} dot>{SIMULABILITY_LABEL[verdict.kind]}</LabPill>
          {verdict.ppe.used && <LabPill tone="dirac" outline>Pauli propagation</LabPill>}
        </div>
        <p style={{ margin: 0 }}>{verdict.summary}</p>
        {verdict.evidence.map((e, index) => (
          <p key={`${index}-${e}`} className="lab-muted" style={{ margin: 0 }}>{e}</p>
        ))}
        <p className="lab-muted" style={{ margin: 0, fontStyle: 'italic' }}>{verdict.caveat}</p>
      </div>
    </LabCard>
  );
}

export function LintList() {
  const lint = useTrainabilityStore((s) => s.lint);
  const requestReveal = useTrainabilityStore((s) => s.requestReveal);
  const jump = (line: number) => {
    // The Lab hides the editor; bring it back, then ask it to reveal the line.
    useNavigationStore.getState().setActiveView('files');
    requestReveal(line);
  };
  return (
    <LabCard title="Lint" subtitle="Static trainability diagnostics" flush>
      {lint.status === 'loading' && lint.diagnostics.length === 0 && (
        <div className="lab-stack" style={{ padding: 'var(--space-4)' }}>
          <LabSkeleton height={16} />
          <LabSkeleton height={16} width="75%" />
        </div>
      )}
      {lint.status === 'error' && (
        <div style={{ padding: 'var(--space-4)' }}>
          <LabCallout tone="danger" title="Lint failed">{lint.error}</LabCallout>
        </div>
      )}
      {lint.status === 'idle' && (
        <LabEmptyState compact title="No lint yet" body="Lint runs on parameterized Python files in Research mode." />
      )}
      {lint.status === 'ready' && lint.diagnostics.length === 0 && (
        <LabEmptyState compact title="No findings" body="Nothing in this circuit and observable trips a trainability rule." />
      )}
      {lint.diagnostics.length > 0 && (
        <ul aria-label="Lint diagnostics" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {lint.diagnostics.map((d, index) => {
            const Icon = SEVERITY_ICON[d.severity];
            return (
              <li key={`${d.code}-${d.line ?? 'summary'}-${d.title}-${index}`} style={{ padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--lab-hairline)' }}>
                <div className="lab-row" style={{ alignItems: 'flex-start' }}>
                  <Icon size={14} aria-hidden style={{ marginTop: 2, flexShrink: 0, color: `var(--color-${d.severity === 'info' ? 'info' : d.severity === 'warning' ? 'warning' : 'danger'})` }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="lab-row" style={{ flexWrap: 'wrap' }}>
                      <LabPill tone={SEVERITY_TONE[d.severity]} outline><span className="lab-mono">{d.code}</span></LabPill>
                      <strong>{d.title}</strong>
                      {d.line !== null && (
                        <LabButton size="sm" variant="ghost" aria-label={`Jump to line ${d.line} in the editor`} onClick={() => jump(d.line as number)}>
                          line <span className="lab-mono">{d.line}</span>
                        </LabButton>
                      )}
                    </div>
                    <p style={{ margin: 'var(--space-1) 0' }}>{diagnosticMessage(d)}</p>
                    {d.citation && <LabCitation label={d.citation.label} url={d.citation.url} />}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </LabCard>
  );
}

export function ExportCard({ job }: { job: TrainabilityJobRecord | null }) {
  const bridge = usePlatform();
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const exportState = useTrainabilityStore((s) => s.exportState);
  const done = !!job && (job.status === 'complete' || job.status === 'cancelled' || job.status === 'failed') && Object.keys(job.results).length > 0;
  const paths = job ? certificatePaths(job.target.fileName) : null;
  return (
    <LabCard title="Certificate" subtitle="Reproducible record of this analysis">
      <div className="lab-stack" style={{ gap: 'var(--space-2)' }}>
        <LabButton
          icon={FileDown}
          disabled={!done || exportState.status === 'saving'}
          onClick={() => void useTrainabilityStore.getState().exportCertificate(bridge, projectRoot)}
        >
          {exportState.status === 'saving' ? 'Exporting…' : 'Export certificate'}
        </LabButton>
        {!done && <p className="lab-muted" style={{ margin: 0 }}>Available once an analysis has finished.</p>}
        {done && paths && exportState.status === 'idle' && (
          <p className="lab-muted" style={{ margin: 0, overflowWrap: 'anywhere', minWidth: 0 }}>
            Writes <span className="lab-mono">{paths.json}</span> and <span className="lab-mono">.md</span> to the project.
          </p>
        )}
        {exportState.status === 'saved' && (
          <LabCallout tone="success" title="Certificate saved">
            <div className="lab-mono" style={{ overflowWrap: 'anywhere' }}>{exportState.certificate.jsonPath}</div>
            <div className="lab-mono" style={{ overflowWrap: 'anywhere' }}>{exportState.certificate.markdownPath}</div>
          </LabCallout>
        )}
        {exportState.status === 'error' && (
          <LabCallout tone="danger" title="Could not save the certificate">{exportState.message}</LabCallout>
        )}
      </div>
    </LabCard>
  );
}

export function VerdictRail({ job }: { job: TrainabilityJobRecord | null }) {
  const diagnostics = useTrainabilityStore((s) => s.lint.diagnostics);
  return (
    <div className="lab-stack" aria-label="Verdicts">
      <TrainabilityCard job={job} diagnostics={diagnostics} />
      <SimulabilityCard job={job} />
      <LintList />
      <ExportCard job={job} />
    </div>
  );
}
