import { BookOpen, FileCheck2, History } from 'lucide-react';
import {
  LabCard,
  LabCitation,
  LabEmptyState,
  LabPill,
  LabSectionLabel,
  LabShell,
  LabShellBody,
  formatDuration,
  type LabTone,
} from '../lab';
import { useTrainabilityStore } from '../../stores/trainabilityStore';
import { TRAINABILITY_CITATIONS } from '../../services/trainability/citations';
import type { TrainabilityJobStatus } from '../../types/trainability';

const STATUS_TONE: Record<TrainabilityJobStatus, LabTone> = {
  starting: 'quantum',
  running: 'quantum',
  cancelling: 'warning',
  complete: 'success',
  cancelled: 'neutral',
  failed: 'danger',
};

/** Compact rail companion: recent jobs, saved certificates and references. */
export function TrainabilitySidebar() {
  const jobs = useTrainabilityStore((s) => s.jobs);
  const jobOrder = useTrainabilityStore((s) => s.jobOrder);
  const selectedJobId = useTrainabilityStore((s) => s.selectedJobId);
  const selectJob = useTrainabilityStore((s) => s.selectJob);
  const certificates = useTrainabilityStore((s) => s.savedCertificates);
  const unavailable = useTrainabilityStore((s) => s.unavailable);
  const displayedId = selectedJobId ?? jobOrder[0] ?? null;

  return (
    <LabShell label="Trainability Lab sidebar">
      <LabShellBody>
        <div className="lab-stack">
          <section aria-label="Recent jobs">
            <LabSectionLabel>
              <span className="lab-row" style={{ gap: 'var(--space-1)', flexWrap: 'wrap' }}>
                <History size={11} aria-hidden /> Recent jobs
              </span>
            </LabSectionLabel>
            {jobOrder.length === 0 ? (
              <LabEmptyState
                compact
                title="No analyses yet"
                body={
                  unavailable
                    ? 'Analyses need the desktop app; there is nothing to list in this build.'
                    : 'Run analyses from the Trainability Lab; they are kept here for the session.'
                }
              />
            ) : (
              <ul aria-label="Recent trainability jobs" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-1)' }}>
                {jobOrder.map((id) => {
                  const job = jobs[id];
                  if (!job) return null;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className="lab-button lab-button--ghost"
                        style={{
                          width: '100%',
                          minWidth: 0,
                          overflow: 'hidden',
                          justifyContent: 'flex-start',
                          gap: 'var(--space-2)',
                          background: id === displayedId ? 'var(--lab-quantum-soft)' : undefined,
                        }}
                        aria-pressed={id === displayedId}
                        onClick={() => selectJob(id)}
                      >
                        <span style={{ flexShrink: 0 }}><LabPill tone={STATUS_TONE[job.status]} dot>{job.status}</LabPill></span>
                        <span className="lab-mono" title={job.target.fileName} style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>
                          {job.target.fileName}
                        </span>
                        <span className="lab-muted lab-mono" style={{ flexShrink: 0 }}>{job.elapsedMs === null ? '…' : formatDuration(job.elapsedMs)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-label="Saved certificates">
            <LabSectionLabel>
              <FileCheck2 size={11} aria-hidden /> Saved certificates
            </LabSectionLabel>
            {certificates.length === 0 ? (
              <p className="lab-muted" style={{ margin: 0 }}>Export a certificate from the verdict rail to keep a reproducible record.</p>
            ) : (
              <ul aria-label="Saved certificates" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-1)' }}>
                {certificates.map((c) => (
                  <li key={c.jsonPath} className="lab-mono" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{c.jsonPath}</li>
                ))}
              </ul>
            )}
          </section>

          <LabCard title="References" aria-label="References">
            <ul aria-label="Citations" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
              {TRAINABILITY_CITATIONS.map((c) => (
                <li key={c.id}>
                  <LabCitation label={c.label} url={c.url} />
                  <div className="lab-muted">{c.supports}</div>
                </li>
              ))}
            </ul>
          </LabCard>
          <p className="lab-muted" style={{ margin: 0 }}>
            <BookOpen size={11} aria-hidden /> Barren plateau: gradient variance that shrinks exponentially with qubit count.
          </p>
        </div>
      </LabShellBody>
    </LabShell>
  );
}
