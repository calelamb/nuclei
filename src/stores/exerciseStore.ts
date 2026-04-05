import { create } from 'zustand';
import type { Framework } from '../types/quantum';

export interface Exercise {
  id: string;
  title: string;
  topic: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  framework: Framework;
  description: string;
  starterCode: string;
  expectedOutput: Record<string, number>; // target probabilities
  hints: string[];
  isBuiltIn: boolean;
}

export interface ExerciseProgress {
  exerciseId: string;
  completed: boolean;
  attempts: number;
  completedAt?: string;
}

interface ExerciseState {
  activeExercise: Exercise | null;
  currentHintIndex: number;
  progress: ExerciseProgress[];
  // Actions
  startExercise: (exercise: Exercise) => void;
  endExercise: () => void;
  revealNextHint: () => void;
  markCompleted: (exerciseId: string) => void;
  incrementAttempts: (exerciseId: string) => void;
  setProgress: (progress: ExerciseProgress[]) => void;
}

export const useExerciseStore = create<ExerciseState>((set, get) => ({
  activeExercise: null,
  currentHintIndex: -1,
  progress: [],

  startExercise: (exercise) => set({ activeExercise: exercise, currentHintIndex: -1 }),
  endExercise: () => set({ activeExercise: null, currentHintIndex: -1 }),
  revealNextHint: () => set((s) => {
    if (!s.activeExercise) return s;
    const maxIdx = s.activeExercise.hints.length - 1;
    return { currentHintIndex: Math.min(s.currentHintIndex + 1, maxIdx) };
  }),
  markCompleted: (exerciseId) => set((s) => {
    const existing = s.progress.find((p) => p.exerciseId === exerciseId);
    if (existing) {
      return {
        progress: s.progress.map((p) =>
          p.exerciseId === exerciseId ? { ...p, completed: true, completedAt: new Date().toISOString() } : p
        ),
      };
    }
    return {
      progress: [...s.progress, { exerciseId, completed: true, attempts: 1, completedAt: new Date().toISOString() }],
    };
  }),
  incrementAttempts: (exerciseId) => set((s) => {
    const existing = s.progress.find((p) => p.exerciseId === exerciseId);
    if (existing) {
      return {
        progress: s.progress.map((p) =>
          p.exerciseId === exerciseId ? { ...p, attempts: p.attempts + 1 } : p
        ),
      };
    }
    return {
      progress: [...s.progress, { exerciseId, completed: false, attempts: 1 }],
    };
  }),
  setProgress: (progress) => set({ progress }),
}));
