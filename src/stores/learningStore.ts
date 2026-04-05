import { create } from 'zustand';

export interface LearningModule {
  id: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  diracPromptAddendum: string; // injected into Dirac system prompt when active
  demoCode: string;
  exerciseIds: string[]; // references to exercise IDs
  quizQuestions: QuizQuestion[];
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface LearningPath {
  id: string;
  title: string;
  description: string;
  modules: LearningModule[];
}

export interface ModuleProgress {
  moduleId: string;
  demoViewed: boolean;
  exercisesCompleted: string[];
  quizScore: number | null; // fraction 0-1
  completed: boolean;
}

export interface PathProgress {
  pathId: string;
  currentModuleIndex: number;
  modules: Record<string, ModuleProgress>;
  startedAt: string;
  lastActiveAt: string;
}

interface LearningState {
  activePath: LearningPath | null;
  activeModuleIndex: number;
  pathProgress: Record<string, PathProgress>;
  sidebarOpen: boolean;
  // Actions
  startPath: (path: LearningPath) => void;
  setActiveModule: (index: number) => void;
  markDemoViewed: (pathId: string, moduleId: string) => void;
  markExerciseComplete: (pathId: string, moduleId: string, exerciseId: string) => void;
  setQuizScore: (pathId: string, moduleId: string, score: number) => void;
  markModuleComplete: (pathId: string, moduleId: string) => void;
  setProgress: (progress: Record<string, PathProgress>) => void;
  toggleSidebar: () => void;
  exitPath: () => void;
}

export const useLearningStore = create<LearningState>((set, get) => ({
  activePath: null,
  activeModuleIndex: 0,
  pathProgress: {},
  sidebarOpen: false,

  startPath: (path) => {
    const existing = get().pathProgress[path.id];
    const startIndex = existing?.currentModuleIndex ?? 0;
    if (!existing) {
      set((s) => ({
        activePath: path,
        activeModuleIndex: startIndex,
        sidebarOpen: true,
        pathProgress: {
          ...s.pathProgress,
          [path.id]: {
            pathId: path.id,
            currentModuleIndex: 0,
            modules: {},
            startedAt: new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
          },
        },
      }));
    } else {
      set({ activePath: path, activeModuleIndex: startIndex, sidebarOpen: true });
    }
  },

  setActiveModule: (index) => {
    const path = get().activePath;
    if (!path) return;
    set((s) => ({
      activeModuleIndex: index,
      pathProgress: {
        ...s.pathProgress,
        [path.id]: {
          ...s.pathProgress[path.id],
          currentModuleIndex: index,
          lastActiveAt: new Date().toISOString(),
        },
      },
    }));
  },

  markDemoViewed: (pathId, moduleId) => set((s) => {
    const pp = s.pathProgress[pathId] ?? { pathId, currentModuleIndex: 0, modules: {}, startedAt: new Date().toISOString(), lastActiveAt: new Date().toISOString() };
    const mp = pp.modules[moduleId] ?? { moduleId, demoViewed: false, exercisesCompleted: [], quizScore: null, completed: false };
    return { pathProgress: { ...s.pathProgress, [pathId]: { ...pp, modules: { ...pp.modules, [moduleId]: { ...mp, demoViewed: true } } } } };
  }),

  markExerciseComplete: (pathId, moduleId, exerciseId) => set((s) => {
    const pp = s.pathProgress[pathId];
    if (!pp) return s;
    const mp = pp.modules[moduleId] ?? { moduleId, demoViewed: false, exercisesCompleted: [], quizScore: null, completed: false };
    const exercises = [...new Set([...mp.exercisesCompleted, exerciseId])];
    return { pathProgress: { ...s.pathProgress, [pathId]: { ...pp, modules: { ...pp.modules, [moduleId]: { ...mp, exercisesCompleted: exercises } } } } };
  }),

  setQuizScore: (pathId, moduleId, score) => set((s) => {
    const pp = s.pathProgress[pathId];
    if (!pp) return s;
    const mp = pp.modules[moduleId] ?? { moduleId, demoViewed: false, exercisesCompleted: [], quizScore: null, completed: false };
    return { pathProgress: { ...s.pathProgress, [pathId]: { ...pp, modules: { ...pp.modules, [moduleId]: { ...mp, quizScore: score } } } } };
  }),

  markModuleComplete: (pathId, moduleId) => set((s) => {
    const pp = s.pathProgress[pathId];
    if (!pp) return s;
    const mp = pp.modules[moduleId] ?? { moduleId, demoViewed: false, exercisesCompleted: [], quizScore: null, completed: false };
    return { pathProgress: { ...s.pathProgress, [pathId]: { ...pp, modules: { ...pp.modules, [moduleId]: { ...mp, completed: true } } } } };
  }),

  setProgress: (pathProgress) => set({ pathProgress }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  exitPath: () => set({ activePath: null, sidebarOpen: false }),
}));
