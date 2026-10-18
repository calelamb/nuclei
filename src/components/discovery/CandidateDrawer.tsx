import { useState } from 'react';
import { ExternalLink, FileOutput, RefreshCw, ShieldCheck } from 'lucide-react';
import { LabButton, LabCallout, LabCode, LabDrawer, formatSci } from '../lab';
import { candidateKind, primaryEvaluation, promoteBlockedReason } from '../../services/discovery/candidateView';
import { useDiscoveryStore, type RunView } from '../../stores/discoveryStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useProjectStore } from '../../stores/projectStore';
import type { CandidateRecord } from '../../types/discovery';
import { AuditSection } from './AuditSection';
import { GradientStrip } from './GradientStrip';
import { CandidateKindPill } from './pills';
import { ProgramDiff } from './ProgramDiff';
import { EvaluationFacts, Facts, FailureCallouts, GuardrailChecklist, LlmSection, ObjectivesTable, OutputBlocks, Section } from './drawerSections';

type Notice = { tone: 'success' | 'danger'; text: string } | null;

function useDrawerActions(view: RunView, candidate: CandidateRecord) {
  const runId = view.run.run_id;
  const live = useDiscoveryStore((s) => s.liveRunIds.includes(runId));
  const reevaluating = useDiscoveryStore((s) => !!s.pendingActions[`${runId}:reeval:${candidate.id}`]);
  const promote = useDiscoveryStore((s) => s.promoteCandidate);
  const auditing = useDiscoveryStore((s) => !!s.pendingActions[`${runId}:audit:${candidate.id}`]);
  const reevaluate = useDiscoveryStore((s) => s.reevaluateCandidate);
  const audit = useDiscoveryStore((s) => s.auditCandidate);
  const [notice, setNotice] = useState<Notice>(null);

  const doPromote = async () => {
    const res = await promote(runId, candidate.id);
    setNotice(res.ok ? { tone: 'success', text: `Wrote ${res.path}` } : { tone: 'danger', text: res.error });
    return res;
  };
  const openAsFile = async () => {
    const res = await doPromote();
    const root = useProjectStore.getState().projectRoot;
    if (!res.ok || !root) return;
    useProjectStore.getState().openTab({ path: `${root.replace(/\/$/, '')}/${res.path}`, content: candidate.program });
    useNavigationStore.getState().setActiveView('files');
  };
  const doReevaluate = async () => {
    const res = await reevaluate(runId, candidate.id);
    setNotice(res.ok ? { tone: 'success', text: 'Re-evaluated on a fresh seed; the new result replaced the old one.' } : { tone: 'danger', text: res.error });
  };
  const doAudit = async () => {
    const res = await audit(runId, candidate.id);
    setNotice(res.ok ? { tone: 'success', text: 'The independent audit finished; see the Audit section.' } : { tone: 'danger', text: res.error });
  };
  return { live, reevaluating, auditing, notice, doPromote, openAsFile, doReevaluate, doAudit };
}

/** Slide-over with everything the engine knows about one candidate. */
export function CandidateDrawer({ view, candidateId, onClose, onSelect }: { view: RunView; candidateId: string | null; onClose: () => void; onSelect: (id: string) => void }) {
  const candidate = candidateId ? view.candidates[candidateId] : undefined;
  if (!candidate) return null;
  return <DrawerBody view={view} candidate={candidate} onClose={onClose} onSelect={onSelect} />;
}

function DrawerBody({ view, candidate, onClose, onSelect }: { view: RunView; candidate: CandidateRecord; onClose: () => void; onSelect: (id: string) => void }) {
  const { live, reevaluating, auditing, notice, doPromote, openAsFile, doReevaluate, doAudit } = useDrawerActions(view, candidate);
  const kind = candidateKind(candidate);
  const promoteBlocked = promoteBlockedReason(kind);
  const evaluation = candidate.evaluation;
  const shown = primaryEvaluation(candidate);
  const parent = candidate.parent_id ? view.candidates[candidate.parent_id] : undefined;
  const map = shown?.metrics.gradient_map;
  const canAudit = !live && !auditing && evaluation?.status === 'scored';
  const canReevaluate = !live && !reevaluating && evaluation !== null && kind !== 'duplicate';

  return (
    <LabDrawer
      open
      onClose={onClose}
      label={`Candidate ${candidate.id}`}
      title={
        <>
          <span className="lab-mono">{candidate.id}</span>
          <CandidateKindPill kind={kind} />
          {evaluation?.fitness != null && <span className="lab-mono">fitness {formatSci(evaluation.fitness, 4)}</span>}
        </>
      }
      subtitle={`Island ${candidate.island + 1}, generation ${candidate.generation}, ${candidate.mutator.toUpperCase()}`}
      actions={
        <>
          <LabButton size="md" icon={ExternalLink} onClick={() => void openAsFile()}>Open as file</LabButton>
          <LabButton size="md" icon={FileOutput} disabled={promoteBlocked !== null} title={promoteBlocked ?? undefined} onClick={() => void doPromote()}>Promote</LabButton>
          <LabButton size="md" icon={RefreshCw} disabled={!canReevaluate} title={live ? 'Wait for the run to finish or stop it first' : evaluation === null ? 'Only evaluated candidates can be re-evaluated' : undefined} onClick={() => void doReevaluate()}>
            {reevaluating ? 'Re-evaluating…' : 'Re-evaluate'}
          </LabButton>
          <LabButton size="md" icon={ShieldCheck} disabled={!canAudit} title={live ? 'Wait for the run to finish or stop it first' : evaluation?.status !== 'scored' ? 'Only scored candidates can be audited' : undefined} onClick={() => void doAudit()}>
            {auditing ? 'Auditing…' : 'Run audit'}
          </LabButton>
        </>
      }
    >
      <div className="lab-stack disc-root">
        {notice && <LabCallout tone={notice.tone}>{notice.text}</LabCallout>}
        <FailureCallouts candidate={candidate} evaluation={shown} />
        <Section title="Lineage">
          <Facts
            rows={[
              ['Parent', parent ? <button key="p" type="button" className="lab-button lab-button--sm lab-mono" onClick={() => onSelect(parent.id)}>{parent.id}</button> : '—'],
              ['Created', candidate.created_at],
              ['Inspirations', candidate.inspiration_ids.length > 0 ? candidate.inspiration_ids.join(', ') : 'none'],
              ['In archive', candidate.in_archive ? 'yes' : 'no'],
              ['AST operators', candidate.ast_ops?.join(', ') ?? '—'],
              ['Re-evaluations', candidate.reevaluations.length],
            ]}
          />
        </Section>
        <LlmSection candidate={candidate} />
        <Section title={parent ? 'Diff against the parent' : 'Program'}>
          {parent ? <ProgramDiff label={`Diff of ${candidate.id} against ${parent.id}`} original={parent.program} modified={candidate.program} /> : <LabCode label={`Program ${candidate.id}`} maxHeight={260}>{candidate.program}</LabCode>}
        </Section>
        {shown && (
          <>
            <Section title={shown === evaluation ? 'Objectives' : 'Objectives (screen estimate)'}><ObjectivesTable evaluation={shown} /></Section>
            <Section title="Guardrails"><GuardrailChecklist evaluation={shown} /></Section>
            {map && <GradientStrip map={map} totalLines={candidate.program.split('\n').length} />}
            <Section title="Evaluation"><EvaluationFacts evaluation={shown} /></Section>
            <AuditSection candidate={candidate} running={auditing} />
            <Section title="Output"><OutputBlocks evaluation={shown} /></Section>
          </>
        )}
      </div>
    </LabDrawer>
  );
}
