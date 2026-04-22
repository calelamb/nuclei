import { create } from 'zustand';
import type { CircuitSnapshot, Framework, SimulationResult } from '../types/quantum';
import type {
  QuantumChallenge,
  ChallengeDifficulty,
  ChallengeCategory,
  ProblemProgress,
  ProblemStatus,
  SubmissionStatus,
  TestCaseResult,
  Submission,
} from '../types/challenge';

export type InspectionView = 'circuit' | 'histogram' | 'bloch' | 'output';
export type ChallengePracticeTab = 'all' | 'qkd';

export interface ChallengeInspectionState {
  testCaseId: string;
  label: string;
  snapshot: CircuitSnapshot | null;
  result: SimulationResult | null;
  stdout: string;
  failure?: {
    verdict: Extract<SubmissionStatus, 'runtime_error' | 'compile_error' | 'time_limit_exceeded'>;
    message: string;
  };
}

export function filterChallenges(
  challenges: QuantumChallenge[],
  difficultyFilter: ChallengeDifficulty | null,
  categoryFilter: ChallengeCategory | null,
  searchQuery: string,
  statusFilter: 'all' | 'not_started' | 'attempted' | 'solved',
  progress: Record<string, ProblemProgress>,
  practiceTab: ChallengePracticeTab = 'all',
): QuantumChallenge[] {
  return challenges.filter((challenge) => {
    if (practiceTab === 'qkd' && challenge.practiceTrack !== 'qkd') return false;
    if (difficultyFilter && challenge.difficulty !== difficultyFilter) return false;
    if (categoryFilter && challenge.category !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesTitle = challenge.title.toLowerCase().includes(q);
      const matchesTags = challenge.tags.some((tag) => tag.toLowerCase().includes(q));
      const matchesDescription = challenge.description.toLowerCase().includes(q);
      if (!matchesTitle && !matchesTags && !matchesDescription) return false;
    }
    if (statusFilter !== 'all') {
      const status = getStatusForChallenge(progress, challenge.id);
      if (status !== statusFilter) return false;
    }
    return true;
  });
}

interface ChallengeModeState {
  // Mode
  isChallengeMode: boolean;

  // Challenge data
  challenges: QuantumChallenge[];
  activeProblem: QuantumChallenge | null;
  activeProblemId: string | null;
  activeFramework: Framework;

  // Filters
  difficultyFilter: ChallengeDifficulty | null;
  categoryFilter: ChallengeCategory | null;
  searchQuery: string;
  statusFilter: 'all' | 'not_started' | 'attempted' | 'solved';
  practiceTab: ChallengePracticeTab;

  // Progress
  progress: Record<string, ProblemProgress>;

  // Execution
  isRunning: boolean;
  currentTestResults: TestCaseResult[];
  runningTestIndex: number;
  inspection: ChallengeInspectionState | null;
  inspectionView: InspectionView;

  // Actions
  enterChallengeMode: () => void;
  exitChallengeMode: () => void;
  setActiveProblem: (challenge: QuantumChallenge | null) => void;
  setActiveFramework: (framework: Framework) => void;
  setDifficultyFilter: (difficulty: ChallengeDifficulty | null) => void;
  setCategoryFilter: (category: ChallengeCategory | null) => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (status: 'all' | 'not_started' | 'attempted' | 'solved') => void;
  setPracticeTab: (tab: ChallengePracticeTab) => void;
  getFilteredChallenges: () => QuantumChallenge[];
  updateDraftCode: (challengeId: string, framework: Framework, code: string) => void;
  setRunning: (running: boolean) => void;
  setRunningTestIndex: (index: number) => void;
  addTestResult: (result: TestCaseResult) => void;
  clearTestResults: () => void;
  setChallenges: (challenges: QuantumChallenge[]) => void;
  addSubmission: (challengeId: string, submission: Submission) => void;
  markSolved: (challengeId: string) => void;
  setInspection: (inspection: ChallengeInspectionState | null) => void;
  setInspectionView: (view: InspectionView) => void;
}

const STORAGE_KEY = 'nuclei-challenges';

function normalizePracticeTab(value: unknown): ChallengePracticeTab {
  return value === 'qkd' ? 'qkd' : 'all';
}

function loadPersisted(): Partial<ChallengeModeState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return {
      progress: data.progress ?? {},
      activeProblemId: data.activeProblemId ?? null,
      activeFramework: data.activeFramework ?? 'qiskit',
      difficultyFilter: data.difficultyFilter ?? null,
      categoryFilter: data.categoryFilter ?? null,
      statusFilter: data.statusFilter ?? 'all',
      practiceTab: normalizePracticeTab(data.practiceTab),
    };
  } catch {
    return {};
  }
}

function persist(state: ChallengeModeState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      progress: state.progress,
      activeProblemId: state.activeProblemId,
      activeFramework: state.activeFramework,
      difficultyFilter: state.difficultyFilter,
      categoryFilter: state.categoryFilter,
      statusFilter: state.statusFilter,
      practiceTab: state.practiceTab,
    }));
  } catch { /* noop */ }
}

function getStatusForChallenge(progress: Record<string, ProblemProgress>, challengeId: string): ProblemStatus {
  const p = progress[challengeId];
  if (!p) return 'not_started';
  return p.status;
}

const persisted = loadPersisted();

export const useChallengeModeStore = create<ChallengeModeState>((set, get) => ({
  isChallengeMode: false,
  challenges: [],
  activeProblem: null,
  activeProblemId: persisted.activeProblemId ?? null,
  activeFramework: persisted.activeFramework ?? 'qiskit',
  difficultyFilter: persisted.difficultyFilter ?? null,
  categoryFilter: persisted.categoryFilter ?? null,
  searchQuery: '',
  statusFilter: persisted.statusFilter ?? 'all',
  practiceTab: persisted.practiceTab ?? 'all',
  progress: persisted.progress ?? {},
  isRunning: false,
  currentTestResults: [],
  runningTestIndex: -1,
  inspection: null,
  inspectionView: 'circuit',

  enterChallengeMode: () => set({ isChallengeMode: true }),
  exitChallengeMode: () => set({ isChallengeMode: false, activeProblem: null, inspection: null }),

  setActiveProblem: (challenge) => {
    set({
      activeProblem: challenge,
      activeProblemId: challenge?.id ?? get().activeProblemId,
      activeFramework: challenge?.default_framework ?? get().activeFramework,
      currentTestResults: [],
      runningTestIndex: -1,
      inspection: null,
      inspectionView: 'circuit',
    });
    persist(get());
  },

  setActiveFramework: (framework) => {
    set({ activeFramework: framework });
    persist(get());
  },

  setDifficultyFilter: (difficulty) => {
    set({ difficultyFilter: difficulty });
    persist(get());
  },

  setCategoryFilter: (category) => {
    set({ categoryFilter: category });
    persist(get());
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  setStatusFilter: (status) => {
    set({ statusFilter: status });
    persist(get());
  },

  setPracticeTab: (tab) => {
    set({ practiceTab: tab });
    persist(get());
  },

  getFilteredChallenges: () => {
    const {
      challenges,
      difficultyFilter,
      categoryFilter,
      searchQuery,
      statusFilter,
      progress,
      practiceTab,
    } = get();
    return filterChallenges(
      challenges,
      difficultyFilter,
      categoryFilter,
      searchQuery,
      statusFilter,
      progress,
      practiceTab,
    );
  },

  updateDraftCode: (challengeId, framework, code) => {
    const prev = get().progress[challengeId];
    const existing = prev ?? {
      challengeId,
      status: 'not_started' as ProblemStatus,
      bestScore: 0,
      attempts: 0,
      submissions: [],
      currentCode: { qiskit: '', cirq: '', 'cuda-q': '' },
    };
    const updatedProgress = {
      ...get().progress,
      [challengeId]: {
        ...existing,
        currentCode: { ...existing.currentCode, [framework]: code },
      },
    };
    set({ progress: updatedProgress });
    persist(get());
  },

  setRunning: (running) => set({ isRunning: running }),
  setRunningTestIndex: (index) => set({ runningTestIndex: index }),

  addTestResult: (result) => {
    set({ currentTestResults: [...get().currentTestResults, result] });
  },

  clearTestResults: () => set({ currentTestResults: [], runningTestIndex: -1 }),

  setChallenges: (challenges) => {
    const activeProblemId = get().activeProblemId;
    const activeProblem = activeProblemId
      ? challenges.find((challenge) => challenge.id === activeProblemId) ?? null
      : null;

    set({ challenges, activeProblem });
  },

  addSubmission: (challengeId, submission) => {
    const prev = get().progress[challengeId];
    const existing = prev ?? {
      challengeId,
      status: 'not_started' as ProblemStatus,
      bestScore: 0,
      attempts: 0,
      submissions: [],
      currentCode: { qiskit: '', cirq: '', 'cuda-q': '' },
    };

    const newAttempts = existing.attempts + 1;
    const newBestScore = Math.max(existing.bestScore, submission.totalScore);
    const newStatus: ProblemStatus = submission.status === 'accepted'
      ? 'solved'
      : existing.status === 'solved' ? 'solved' : 'attempted';

    const updatedProgress = {
      ...get().progress,
      [challengeId]: {
        ...existing,
        status: newStatus,
        bestScore: newBestScore,
        attempts: newAttempts,
        submissions: [...existing.submissions, submission],
        lastAttemptedAt: submission.timestamp,
        solvedAt: newStatus === 'solved' && !existing.solvedAt ? submission.timestamp : existing.solvedAt,
        currentCode: {
          ...existing.currentCode,
          [submission.framework]: submission.code,
        },
      },
    };
    set({ progress: updatedProgress });
    persist(get());
  },

  markSolved: (challengeId) => {
    const prev = get().progress[challengeId];
    if (!prev) return;
    const updatedProgress = {
      ...get().progress,
      [challengeId]: {
        ...prev,
        status: 'solved' as ProblemStatus,
        solvedAt: prev.solvedAt ?? new Date().toISOString(),
      },
    };
    set({ progress: updatedProgress });
    persist(get());
  },

  setInspection: (inspection) => set({ inspection }),
  setInspectionView: (view) => set({ inspectionView: view }),
}));
