import { useEffect, useMemo } from 'react';
import { ArrowRight, CheckCircle2, Circle, ListChecks, ShieldCheck, Star } from 'lucide-react';
import { isStateVerified } from '../../services/challengeGrading';
import {
  type ChallengePracticeTab,
  filterChallenges,
  useChallengeModeStore,
} from '../../stores/challengeModeStore';
import { QUANTUM_CHALLENGES } from '../../data/challenges';
import { ProblemFilters } from './ProblemFilters';
import { Badge, Tabs } from '../ui';
import { DIFFICULTY_TONE } from './difficultyTone';
import type {
  ChallengeCategory,
  ProblemProgress,
  ProblemStatus,
  QuantumChallenge,
} from '../../types/challenge';
import './challenges.css';

const CATEGORY_LABELS: Record<ChallengeCategory, string> = {
  'state-preparation': 'State prep',
  algorithms: 'Algorithms',
  optimization: 'Optimization',
  protocols: 'Protocols',
};

const STATUS_LABELS: Record<ProblemStatus, string> = {
  not_started: 'Not started',
  attempted: 'Attempted',
  solved: 'Solved',
};

const PRACTICE_TABS: Array<{
  value: ChallengePracticeTab;
  label: string;
  detail: string;
  icon: typeof ListChecks;
}> = [
  { value: 'all', label: 'All practice', detail: 'Circuit builders and protocol drills', icon: ListChecks },
  { value: 'qkd', label: 'QKD protocols', detail: 'BB84, QBER, intercept-resend, E91', icon: ShieldCheck },
];

function StatusCell({ status, optimal }: { status: ProblemStatus; optimal?: boolean }) {
  return (
    <div className="prow__status" data-status={status} title={STATUS_LABELS[status]}>
      {status === 'solved' ? <CheckCircle2 size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" fill={status === 'attempted' ? 'currentColor' : 'none'} stroke={status === 'attempted' ? 'none' : 'currentColor'} />}
      <span className="prow__sr">{STATUS_LABELS[status]}</span>
      {status === 'solved' && optimal && <Star size={12} fill="currentColor" strokeWidth={0} aria-label="Solved optimally" />}
    </div>
  );
}

function ProblemRow({ challenge, progress, onClick }: {
  challenge: QuantumChallenge;
  progress?: ProblemProgress;
  onClick: () => void;
}) {
  const status = progress?.status ?? 'not_started';
  const attempts = progress?.attempts ?? 0;
  const bestScore = progress?.bestScore ?? 0;

  return (
    <button type="button" className="prow prow-grid" onClick={onClick} aria-label={`${challenge.title}, ${STATUS_LABELS[status].toLowerCase()}`}>
      <StatusCell status={status} optimal={progress?.solvedOptimally} />

      <div className="prow__main">
        <div className="prow__title-row">
          <span className="prow__title">{challenge.title}</span>
          {isStateVerified(challenge) && <ShieldCheck className="prow__verified" size={12} aria-label="State-verified grading" />}
        </div>
        <div className="prow__tags">{challenge.tags.slice(0, 3).join(' \u2022 ')}</div>
      </div>

      <span className="prow__level">
        <Badge tone={DIFFICULTY_TONE[challenge.difficulty]} style={{ textTransform: 'capitalize' }}>{challenge.difficulty}</Badge>
      </span>

      <span className="prow__cat">{CATEGORY_LABELS[challenge.category]}</span>

      <span className="prow__best">
        {attempts > 0 ? `${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}, best ${bestScore}%` : '\u2014'}
      </span>
    </button>
  );
}

export function ProblemBrowser() {
  const setChallenges = useChallengeModeStore((s) => s.setChallenges);
  const challenges = useChallengeModeStore((s) => s.challenges);
  const difficultyFilter = useChallengeModeStore((s) => s.difficultyFilter);
  const categoryFilter = useChallengeModeStore((s) => s.categoryFilter);
  const searchQuery = useChallengeModeStore((s) => s.searchQuery);
  const statusFilter = useChallengeModeStore((s) => s.statusFilter);
  const practiceTab = useChallengeModeStore((s) => s.practiceTab);
  const progress = useChallengeModeStore((s) => s.progress);
  const setActiveProblem = useChallengeModeStore((s) => s.setActiveProblem);
  const setPracticeTab = useChallengeModeStore((s) => s.setPracticeTab);

  useEffect(() => {
    if (challenges.length === 0) setChallenges(QUANTUM_CHALLENGES);
  }, [challenges.length, setChallenges]);

  const filtered = useMemo(() => (
    filterChallenges(challenges, difficultyFilter, categoryFilter, searchQuery, statusFilter, progress, practiceTab)
  ), [challenges, difficultyFilter, categoryFilter, searchQuery, statusFilter, progress, practiceTab]);

  const qkdCount = challenges.filter((challenge) => challenge.practiceTrack === 'qkd').length;
  const solvedCount = Object.values(progress).filter((entry) => entry.status === 'solved').length;
  const isQkdTab = practiceTab === 'qkd';

  return (
    <div className="pbrowse">
      <Tabs
        className="pbrowse__tabs"
        aria-label="Practice track"
        value={practiceTab}
        onChange={setPracticeTab}
        options={PRACTICE_TABS.map((tab) => {
          const Icon = tab.icon;
          return {
            value: tab.value,
            label: tab.label,
            icon: <Icon size={14} aria-hidden="true" />,
            count: tab.value === 'qkd' ? qkdCount : challenges.length,
            title: tab.detail,
          };
        })}
      />

      <ProblemFilters />

      <div className="pbrowse__head">
        <h2 className="pbrowse__title">{isQkdTab ? 'QKD protocol practice' : 'Quantum problem set'}</h2>
        {isQkdTab && <p className="pbrowse__lede">Practice the classical post-processing and security checks behind QKD.</p>}
        <div className="pbrowse__stats">
          <span>{filtered.length} visible problems</span>
          <span>{solvedCount} solved</span>
          <span>{isQkdTab ? 'Browser + desktop Python value contracts' : 'Qiskit-first function contracts'}</span>
          <span>
            Run visible tests <ArrowRight size={12} aria-hidden="true" /> Submit <ArrowRight size={12} aria-hidden="true" /> {isQkdTab ? 'Inspect return value' : 'Inspect quantum output'}
          </span>
        </div>
      </div>

      <div className="pbrowse__list">
        {filtered.length === 0 ? (
          <div className="pbrowse__empty">No problems match the current filters.</div>
        ) : (
          <div className="pbrowse__table">
            <div className="pbrowse__cols prow-grid">
              <span aria-hidden="true" />
              <span>Title</span>
              <span>Difficulty</span>
              <span>Category</span>
              <span>Attempts and best</span>
            </div>
            {filtered.map((challenge) => (
              <ProblemRow key={challenge.id} challenge={challenge} progress={progress[challenge.id]} onClick={() => setActiveProblem(challenge)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
