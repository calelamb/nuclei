import { useMemo, useState } from 'react';
import { Archive, FlaskConical, GitBranch, LayoutDashboard, ListTree, ShieldCheck } from 'lucide-react';
import { LabSegmented } from '../lab';
import { candidateKind } from '../../services/discovery/candidateView';
import { useCandidateList } from './useCandidateList';
import { useDiscoveryStore, type DiscoveryKpis, type RunView } from '../../stores/discoveryStore';
import { CandidateDrawer } from './CandidateDrawer';
import { RunHeader } from './RunHeader';
import { RunKpis } from './RunKpis';
import { RunNotices } from './RunNotices';
import { ConjecturesTab } from './conjecture/ConjecturesTab';
import { ArchiveTab } from './tabs/ArchiveTab';
import { CandidatesTab } from './tabs/CandidatesTab';
import { GuardrailsTab } from './tabs/GuardrailsTab';
import { LineageTab } from './tabs/LineageTab';
import { OverviewTab } from './tabs/OverviewTab';

export type RunTab = 'overview' | 'lineage' | 'archive' | 'candidates' | 'guardrails' | 'conjectures';

const PREFIX = 'discovery-run';

/** The run view: header, notices, KPI strip, tabs and the candidate drawer. */
export function RunDetail({ view, kpis, initialTab = 'overview' }: { view: RunView; kpis: DiscoveryKpis; initialTab?: RunTab }) {
  const [tab, setTab] = useState<RunTab>(initialTab);
  const selectedCandidateId = useDiscoveryStore((s) => s.selectedCandidateId);
  const selectCandidate = useDiscoveryStore((s) => s.selectCandidate);
  const list = useCandidateList(view);
  const rejected = useMemo(() => list.filter((c) => candidateKind(c) === 'rejected').length, [list]);

  return (
    <div className="lab-stack">
      <RunHeader view={view} />
      <RunNotices view={view} />
      <RunKpis kpis={kpis} redQueen={view.run.spec.mutator.kind === 'red_queen'} />
      <LabSegmented<RunTab>
        label="Run sections"
        idPrefix={PREFIX}
        value={tab}
        onChange={setTab}
        items={[
          { id: 'overview', label: 'Overview', icon: LayoutDashboard },
          { id: 'lineage', label: 'Lineage', icon: GitBranch },
          { id: 'archive', label: 'Archive', icon: Archive },
          { id: 'candidates', label: 'Candidates', icon: ListTree, badge: list.length },
          { id: 'guardrails', label: 'Guardrails', icon: ShieldCheck, badge: rejected > 0 ? rejected : undefined },
          { id: 'conjectures', label: 'Conjectures', icon: FlaskConical },
        ]}
      />
      <div role="tabpanel" id={`${PREFIX}-panel-${tab}`} aria-labelledby={`${PREFIX}-tab-${tab}`}>
        {tab === 'overview' && <OverviewTab view={view} onOpen={selectCandidate} />}
        {tab === 'lineage' && <LineageTab view={view} selectedId={selectedCandidateId} onOpen={selectCandidate} />}
        {tab === 'archive' && <ArchiveTab archive={view.run.archive} onOpen={selectCandidate} />}
        {tab === 'candidates' && <CandidatesTab view={view} selectedId={selectedCandidateId} onOpen={selectCandidate} />}
        {tab === 'guardrails' && <GuardrailsTab view={view} onOpen={selectCandidate} />}
        {tab === 'conjectures' && <ConjecturesTab view={view} />}
      </div>
      <CandidateDrawer view={view} candidateId={selectedCandidateId} onClose={() => selectCandidate(null)} onSelect={selectCandidate} />
    </div>
  );
}
