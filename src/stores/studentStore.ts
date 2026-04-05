import { create } from 'zustand';
import type { Framework } from '../types/quantum';

export interface StudentModel {
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  conceptsMastered: string[];
  conceptsStruggling: string[];
  commonErrors: Array<{ errorType: string; frequency: number; lastOccurred: string }>;
  preferredFramework: Framework;
  codingStyle: {
    usesComments: boolean;
    averageCircuitSize: number;
    prefersVerboseNames: boolean;
  };
  learningStyle: 'visual' | 'conceptual' | 'hands-on';
  prefersCodeFirst: boolean;
  detailLevel: 'brief' | 'moderate' | 'detailed';
  exercisesCompleted: string[];
  learningPathProgress: Record<string, number>;
  totalSessionCount: number;
  totalCodeExecutions: number;
  firstSession: string;
  lastSession: string;
}

function defaultModel(): StudentModel {
  return {
    skillLevel: 'beginner',
    conceptsMastered: [],
    conceptsStruggling: [],
    commonErrors: [],
    preferredFramework: 'qiskit',
    codingStyle: { usesComments: false, averageCircuitSize: 0, prefersVerboseNames: false },
    learningStyle: 'hands-on',
    prefersCodeFirst: true,
    detailLevel: 'moderate',
    exercisesCompleted: [],
    learningPathProgress: {},
    totalSessionCount: 0,
    totalCodeExecutions: 0,
    firstSession: new Date().toISOString(),
    lastSession: new Date().toISOString(),
  };
}

interface StudentState {
  model: StudentModel;
  updateModel: (partial: Partial<StudentModel>) => void;
  recordExecution: (gateCount: number) => void;
  recordError: (errorType: string) => void;
  recordConceptMastered: (concept: string) => void;
  recordConceptStruggling: (concept: string) => void;
  inferSkillLevel: () => void;
  reset: () => void;
  setModel: (model: StudentModel) => void;
}

export const useStudentStore = create<StudentState>((set, get) => ({
  model: defaultModel(),

  updateModel: (partial) => set((s) => ({ model: { ...s.model, ...partial } })),

  recordExecution: (gateCount) => set((s) => {
    const m = s.model;
    const avg = m.totalCodeExecutions > 0
      ? (m.codingStyle.averageCircuitSize * m.totalCodeExecutions + gateCount) / (m.totalCodeExecutions + 1)
      : gateCount;
    return {
      model: {
        ...m,
        totalCodeExecutions: m.totalCodeExecutions + 1,
        lastSession: new Date().toISOString(),
        codingStyle: { ...m.codingStyle, averageCircuitSize: Math.round(avg) },
      },
    };
  }),

  recordError: (errorType) => set((s) => {
    const m = s.model;
    const existing = m.commonErrors.find((e) => e.errorType === errorType);
    const errors = existing
      ? m.commonErrors.map((e) => e.errorType === errorType ? { ...e, frequency: e.frequency + 1, lastOccurred: new Date().toISOString() } : e)
      : [...m.commonErrors, { errorType, frequency: 1, lastOccurred: new Date().toISOString() }];
    return { model: { ...m, commonErrors: errors } };
  }),

  recordConceptMastered: (concept) => set((s) => {
    const m = s.model;
    if (m.conceptsMastered.includes(concept)) return s;
    return {
      model: {
        ...m,
        conceptsMastered: [...m.conceptsMastered, concept],
        conceptsStruggling: m.conceptsStruggling.filter((c) => c !== concept),
      },
    };
  }),

  recordConceptStruggling: (concept) => set((s) => {
    const m = s.model;
    if (m.conceptsStruggling.includes(concept) || m.conceptsMastered.includes(concept)) return s;
    return { model: { ...m, conceptsStruggling: [...m.conceptsStruggling, concept] } };
  }),

  inferSkillLevel: () => set((s) => {
    const m = s.model;
    let level: StudentModel['skillLevel'] = 'beginner';
    if (m.totalCodeExecutions > 50 && m.conceptsMastered.length > 5 && m.codingStyle.averageCircuitSize > 8) {
      level = 'advanced';
    } else if (m.totalCodeExecutions > 15 && m.conceptsMastered.length > 2) {
      level = 'intermediate';
    }
    return { model: { ...m, skillLevel: level } };
  }),

  reset: () => set({ model: defaultModel() }),
  setModel: (model) => set({ model }),
}));

/** Generate the system prompt addendum from the student model */
export function studentModelToPrompt(model: StudentModel): string {
  const parts: string[] = ['## Student Profile'];

  parts.push(`- Skill level: ${model.skillLevel}`);
  parts.push(`- Total sessions: ${model.totalSessionCount}, executions: ${model.totalCodeExecutions}`);
  parts.push(`- Preferred framework: ${model.preferredFramework}`);
  parts.push(`- Learning style: ${model.learningStyle}, prefers ${model.prefersCodeFirst ? 'code first' : 'explanation first'}`);
  parts.push(`- Detail level: ${model.detailLevel}`);

  if (model.conceptsMastered.length > 0) {
    parts.push(`\nMastered concepts (skip basic explanations): ${model.conceptsMastered.join(', ')}`);
  }
  if (model.conceptsStruggling.length > 0) {
    parts.push(`Struggling with: ${model.conceptsStruggling.join(', ')} — offer extra help here`);
  }
  if (model.commonErrors.length > 0) {
    const top3 = model.commonErrors.sort((a, b) => b.frequency - a.frequency).slice(0, 3);
    parts.push(`Common errors: ${top3.map((e) => `${e.errorType} (${e.frequency}x)`).join(', ')} — teach proactively around these`);
  }

  const levelInstructions: Record<string, string> = {
    beginner: '\nTeaching style: Use analogies, avoid heavy math, celebrate progress, be very encouraging.',
    intermediate: '\nTeaching style: Include matrix notation when relevant, suggest optimizations, explain trade-offs.',
    advanced: '\nTeaching style: Discuss error correction, hardware constraints, assume strong linear algebra. Be concise.',
  };
  parts.push(levelInstructions[model.skillLevel]);

  return parts.join('\n');
}
