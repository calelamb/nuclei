import { create } from 'zustand';

export interface LessonProgress {
  startedAt: string;
  completedAt?: string;
  exercisesPassed: string[];
  quizScores: Record<string, number>;
  hintsUsed: number;
}

export type AssessedLevel = 'absolute-beginner' | 'beginner' | 'intermediate' | 'advanced';

interface LearnState {
  // Mode
  isLearnMode: boolean;

  // Current position
  currentTrackId: string | null;
  currentLessonId: string | null;
  currentBlockIndex: number;

  // Progress
  completedLessons: string[];
  lessonProgress: Record<string, LessonProgress>;

  // Adaptive
  assessedLevel: AssessedLevel | null;
  needsPythonTrack: boolean | null;

  // Actions
  enterLearnMode: () => void;
  exitLearnMode: () => void;
  setCurrentLesson: (trackId: string, lessonId: string) => void;
  clearCurrentLesson: () => void;
  setCurrentBlockIndex: (index: number) => void;
  completeLesson: (lessonId: string) => void;
  passExercise: (lessonId: string, exerciseId: string) => void;
  setQuizScore: (lessonId: string, quizId: string, score: number) => void;
  addHintUsed: (lessonId: string) => void;
  setAssessedLevel: (level: AssessedLevel) => void;
  setNeedsPythonTrack: (needs: boolean) => void;
}

const STORAGE_KEY = 'nuclei-learn';

function loadPersisted(): Partial<LearnState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return {
      completedLessons: data.completedLessons ?? [],
      lessonProgress: data.lessonProgress ?? {},
      assessedLevel: data.assessedLevel ?? null,
      needsPythonTrack: data.needsPythonTrack ?? null,
      currentTrackId: data.currentTrackId ?? null,
      currentLessonId: data.currentLessonId ?? null,
    };
  } catch {
    return {};
  }
}

function persist(state: LearnState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      completedLessons: state.completedLessons,
      lessonProgress: state.lessonProgress,
      assessedLevel: state.assessedLevel,
      needsPythonTrack: state.needsPythonTrack,
      currentTrackId: state.currentTrackId,
      currentLessonId: state.currentLessonId,
    }));
  } catch { /* noop */ }
}

const persisted = loadPersisted();

export const useLearnStore = create<LearnState>((set, get) => ({
  isLearnMode: false,
  currentTrackId: persisted.currentTrackId ?? null,
  currentLessonId: persisted.currentLessonId ?? null,
  currentBlockIndex: 0,
  completedLessons: persisted.completedLessons ?? [],
  lessonProgress: persisted.lessonProgress ?? {},
  assessedLevel: persisted.assessedLevel ?? null,
  needsPythonTrack: persisted.needsPythonTrack ?? null,

  enterLearnMode: () => set({ isLearnMode: true }),
  exitLearnMode: () => set({ isLearnMode: false }),

  setCurrentLesson: (trackId, lessonId) => {
    const progress = get().lessonProgress[lessonId];
    const updated: Partial<LearnState> = {
      currentTrackId: trackId,
      currentLessonId: lessonId,
      currentBlockIndex: 0,
    };
    if (!progress) {
      updated.lessonProgress = {
        ...get().lessonProgress,
        [lessonId]: { startedAt: new Date().toISOString(), exercisesPassed: [], quizScores: {}, hintsUsed: 0 },
      };
    }
    set(updated);
    persist({ ...get(), ...updated } as LearnState);
  },

  clearCurrentLesson: () => {
    set({ currentTrackId: null, currentLessonId: null, currentBlockIndex: 0 });
    persist(get());
  },

  setCurrentBlockIndex: (index) => set({ currentBlockIndex: index }),

  completeLesson: (lessonId) => {
    const completed = [...new Set([...get().completedLessons, lessonId])];
    const progress = get().lessonProgress[lessonId];
    const updatedProgress = {
      ...get().lessonProgress,
      [lessonId]: { ...(progress ?? { startedAt: new Date().toISOString(), exercisesPassed: [], quizScores: {}, hintsUsed: 0 }), completedAt: new Date().toISOString() },
    };
    set({ completedLessons: completed, lessonProgress: updatedProgress });
    persist(get());
  },

  passExercise: (lessonId, exerciseId) => {
    const progress = get().lessonProgress[lessonId];
    if (!progress) return;
    const exercises = [...new Set([...progress.exercisesPassed, exerciseId])];
    const updatedProgress = { ...get().lessonProgress, [lessonId]: { ...progress, exercisesPassed: exercises } };
    set({ lessonProgress: updatedProgress });
    persist(get());
  },

  setQuizScore: (lessonId, quizId, score) => {
    const progress = get().lessonProgress[lessonId];
    if (!progress) return;
    const updatedProgress = { ...get().lessonProgress, [lessonId]: { ...progress, quizScores: { ...progress.quizScores, [quizId]: score } } };
    set({ lessonProgress: updatedProgress });
    persist(get());
  },

  addHintUsed: (lessonId) => {
    const progress = get().lessonProgress[lessonId];
    if (!progress) return;
    const updatedProgress = { ...get().lessonProgress, [lessonId]: { ...progress, hintsUsed: progress.hintsUsed + 1 } };
    set({ lessonProgress: updatedProgress });
    persist(get());
  },

  setAssessedLevel: (level) => {
    set({ assessedLevel: level });
    persist(get());
  },

  setNeedsPythonTrack: (needs) => {
    set({ needsPythonTrack: needs });
    persist(get());
  },
}));
