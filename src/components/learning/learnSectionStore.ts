import { create } from 'zustand';

export type LearnSection = 'tracks' | 'concepts' | 'capstones' | 'glossary' | 'videos';

interface LearnSectionState {
  section: LearnSection;
  setSection: (section: LearnSection) => void;
}

/** Which section of the full-view Learn chooser is showing. */
export const useLearnSectionStore = create<LearnSectionState>((set) => ({
  section: 'tracks',
  setSection: (section) => set({ section }),
}));

export const LEARN_SECTION_LABELS: Readonly<Record<LearnSection, string>> = {
  tracks: 'Tracks',
  concepts: 'Concepts',
  capstones: 'Capstones',
  glossary: 'Glossary',
  videos: 'Videos',
};
