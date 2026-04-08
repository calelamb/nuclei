import type { Framework } from '../../types/quantum';

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export type ContentBlock =
  | { type: 'text'; markdown: string }
  | { type: 'video'; youtubeId: string; title: string; creator: string; startTime?: number; endTime?: number }
  | { type: 'demo'; code: string; framework: Framework; description: string; explorationPrompt?: string }
  | { type: 'exercise'; id: string; title: string; description: string; starterCode: string; framework: Framework; expectedProbabilities?: Record<string, number>; expectedMeasurements?: Record<string, number>; tolerancePercent: number; hints: string[]; successMessage: string }
  | { type: 'quiz'; questions: QuizQuestion[] }
  | { type: 'concept-card'; title: string; visual: 'bloch' | 'circuit' | 'histogram' | 'custom-svg'; explanation: string; interactiveProps?: Record<string, unknown> }
  | { type: 'interactive-bloch'; initialTheta?: number; initialPhi?: number; availableGates?: string[]; challenge?: { targetTheta: number; targetPhi: number; description: string } };

export interface Lesson {
  id: string;
  title: string;
  description: string;
  difficulty: 'absolute-beginner' | 'beginner' | 'intermediate' | 'advanced';
  estimatedMinutes: number;
  prerequisites: string[];
  tags: string[];
  contentBlocks: ContentBlock[];
  diracContext: string;
}

export interface Track {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  lessons: Lesson[];
}
