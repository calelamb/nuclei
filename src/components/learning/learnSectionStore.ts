import { create } from 'zustand';

export type LearnSection = 'tracks' | 'concepts' | 'capstones' | 'glossary' | 'videos';

/** A lesson the learner stepped away from, with their reading position. */
export interface LessonReturn {
  trackId: string;
  lessonId: string;
  blockIndex: number;
}

interface LearnSectionState {
  section: LearnSection;
  setSection: (section: LearnSection) => void;
  /** Where the learner was before they opened a chooser section; drives "Back to lesson". */
  returnTo: LessonReturn | null;
  setReturnTo: (value: LessonReturn | null) => void;
  /** One-shot: the position LessonView scrolls to when it opens the lesson again. */
  restore: LessonReturn | null;
  setRestore: (value: LessonReturn | null) => void;
}

/** Which section of the full-view Learn chooser is showing. */
export const useLearnSectionStore = create<LearnSectionState>((set) => ({
  section: 'tracks',
  setSection: (section) => set({ section }),
  returnTo: null,
  setReturnTo: (returnTo) => set({ returnTo }),
  restore: null,
  setRestore: (restore) => set({ restore }),
}));

export const LEARN_SECTION_LABELS: Readonly<Record<LearnSection, string>> = {
  tracks: 'Tracks',
  concepts: 'Concepts',
  capstones: 'Capstones',
  glossary: 'Glossary',
  videos: 'Videos',
};
