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
import { Badge } from '../ui';
import { DIFFICULTY_TONE } from './difficultyTone';
import type {
  ChallengeCategory,
  ProblemProgress,
  ProblemStatus,
  QuantumChallenge,
} from '../../types/challenge';
import './challenges.css';

const CATEGORY_LABELS: Record<ChallengeCategory, string> = {
  'state-preparation': 'State Prep',
  algorithms: 'Algorithms',
  optimization: 'Optimization',
  protocols: 'Protocols',
};

const STATUS_LABELS: Record<ProblemStatus, string> = {
  not_started: 'Not Started',
  attempted: 'Attempted',
  solved: 'Solved',
};

const PRACTICE_TABS: Array<{
  value: ChallengePracticeTab;
  label: string;
  detail: string;
  icon: typeof ListChecks;
}> = [
  { value: 'all', label: 'All Practice', detail: 'Circuit builders and protocol drills', icon: ListChecks },
  { value: 'qkd', label: 'QKD Protocols', detail: 'BB84, QBER, intercept-resend, E91', icon: ShieldCheck },
];

function PracticeTabButton({ active, tab, count, onClick }: {
  active: boolean;
  tab: (typeof PRACTICE_TABS)[number];
  count: number;
  onClick: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button type="button" role="tab" aria-selected={active} className="ptab" onClick={onClick}>
      <span className="ptab__icon"><Icon size={16} aria-hidden="true" /></span>
      <span className="ptab__text">
        <span className="ptab__label">{tab.label}</span>
        <span className="ptab__detail">{tab.detail}</span>
      </span>
      <span className="ptab__count">{count}</span>
    </button>
  );
}

function StatusCell({ status, optimal }: { status: ProblemStatus; optimal?: boolean }) {
  return (
    <div className="prow__status" data-status={status} title={STATUS_LABELS[status]}>
      {status === 'solved' ? <CheckCircle2 size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" fill={status === 'attempted' ? 'currentColor' : 'none'} stroke={status === 'attempted' ? 'none' : 'currentColor'} />}
      {status === 'not_started'
        ? <span className="prow__sr">{STATUS_LABELS[status]}</span>
        : <span>{STATUS_LABELS[status]}</span>}
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
    <button type="button" className="prow prow-grid" onClick={onClick}>
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
      <div className="pbrowse__tabs" role="tablist" aria-label="Practice track">
        {PRACTICE_TABS.map((tab) => (
          <PracticeTabButton
            key={tab.value}
            tab={tab}
            active={practiceTab === tab.value}
            count={tab.value === 'qkd' ? qkdCount : challenges.length}
            onClick={() => setPracticeTab(tab.value)}
          />
        ))}
      </div>

      <ProblemFilters />

      <div className="pbrowse__head">
        <h2 className="pbrowse__title">{isQkdTab ? 'QKD Protocol Practice' : 'Quantum Problem Set'}</h2>
        {isQkdTab && <p className="pbrowse__lede">Practice the classical post-processing and security checks behind QKD.</p>}
        <div className="pbrowse__stats">
          <span>{filtered.length} visible problems</span>
          <span>{solvedCount} solved</span>
          <span>{isQkdTab ? 'Browser + desktop Python value contracts' : 'Qiskit-first function contracts'}</span>
          <span>
            Run Visible Tests <ArrowRight size={12} aria-hidden="true" /> Submit <ArrowRight size={12} aria-hidden="true" /> {isQkdTab ? 'Inspect Return Value' : 'Inspect Quantum Output'}
          </span>
        </div>
      </div>

      <div className="pbrowse__list">
        {filtered.length === 0 ? (
          <div className="pbrowse__empty">No problems match the current filters.</div>
        ) : (
          <div className="pbrowse__table">
            <div className="pbrowse__cols prow-grid">
              <span>Status</span>
              <span>Title</span>
              <span>Difficulty</span>
              <span>Category</span>
              <span>Attempts / Best</span>
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
