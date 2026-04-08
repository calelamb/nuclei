import { create } from 'zustand';
import type { Framework } from '../types/quantum';
import type {
  QuantumChallenge,
  ChallengeDifficulty,
  ChallengeCategory,
  ProblemProgress,
  ProblemStatus,
  TestCaseResult,
  Submission,
} from '../types/challenge';

interface ChallengeModeState {
  // Mode
  isChallengeMode: boolean;

  // Challenge data
  challenges: QuantumChallenge[];
  activeProblem: QuantumChallenge | null;
  activeFramework: Framework;

  // Filters
  difficultyFilter: ChallengeDifficulty | null;
  categoryFilter: ChallengeCategory | null;
  searchQuery: string;
  statusFilter: 'all' | 'not_started' | 'attempted' | 'solved';

  // Progress
  progress: Record<string, ProblemProgress>;

  // Execution
  isRunning: boolean;
  currentTestResults: TestCaseResult[];
  runningTestIndex: number;

  // Actions
  enterChallengeMode: () => void;
  exitChallengeMode: () => void;
  setActiveProblem: (challenge: QuantumChallenge | null) => void;
  setActiveFramework: (framework: Framework) => void;
  setDifficultyFilter: (difficulty: ChallengeDifficulty | null) => void;
  setCategoryFilter: (category: ChallengeCategory | null) => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (status: 'all' | 'not_started' | 'attempted' | 'solved') => void;
  getFilteredChallenges: () => QuantumChallenge[];
  updateDraftCode: (challengeId: string, framework: Framework, code: string) => void;
  setRunning: (running: boolean) => void;
  setRunningTestIndex: (index: number) => void;
  addTestResult: (result: TestCaseResult) => void;
  clearTestResults: () => void;
  setChallenges: (challenges: QuantumChallenge[]) => void;
  addSubmission: (challengeId: string, submission: Submission) => void;
  markSolved: (challengeId: string) => void;
}

const STORAGE_KEY = 'nuclei-challenges';

function loadPersisted(): Partial<ChallengeModeState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return {
      progress: data.progress ?? {},
      activeFramework: data.activeFramework ?? 'qiskit',
      difficultyFilter: data.difficultyFilter ?? null,
      categoryFilter: data.categoryFilter ?? null,
      statusFilter: data.statusFilter ?? 'all',
    };
  } catch {
    return {};
  }
}

function persist(state: ChallengeModeState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      progress: state.progress,
      activeFramework: state.activeFramework,
      difficultyFilter: state.difficultyFilter,
      categoryFilter: state.categoryFilter,
      statusFilter: state.statusFilter,
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
  activeFramework: persisted.activeFramework ?? 'qiskit',
  difficultyFilter: persisted.difficultyFilter ?? null,
  categoryFilter: persisted.categoryFilter ?? null,
  searchQuery: '',
  statusFilter: persisted.statusFilter ?? 'all',
  progress: persisted.progress ?? {},
  isRunning: false,
  currentTestResults: [],
  runningTestIndex: -1,

  enterChallengeMode: () => set({ isChallengeMode: true }),
  exitChallengeMode: () => set({ isChallengeMode: false, activeProblem: null }),

  setActiveProblem: (challenge) => set({ activeProblem: challenge, currentTestResults: [], runningTestIndex: -1 }),

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

  getFilteredChallenges: () => {
    const { challenges, difficultyFilter, categoryFilter, searchQuery, statusFilter, progress } = get();
    return challenges.filter((c) => {
      if (difficultyFilter && c.difficulty !== difficultyFilter) return false;
      if (categoryFilter && c.category !== categoryFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = c.title.toLowerCase().includes(q);
        const matchesTags = c.tags.some((t) => t.toLowerCase().includes(q));
        const matchesDescription = c.description.toLowerCase().includes(q);
        if (!matchesTitle && !matchesTags && !matchesDescription) return false;
      }
      if (statusFilter !== 'all') {
        const status = getStatusForChallenge(progress, c.id);
        if (status !== statusFilter) return false;
      }
      return true;
    });
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

  setChallenges: (challenges) => set({ challenges }),

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
}));
