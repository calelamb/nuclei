import { create } from 'zustand';
import { useQecStudyStore } from '../services/qecStudyStore';

export interface QecStudyUiState {
  activeStudyId: string | null;
  setActiveStudy(id: string): void;
  clearActiveStudy(): void;
}

function isKnownStudy(id: string): boolean {
  return useQecStudyStore.getState().studies.some((entry) => entry.study.id === id);
}

export const useQecStudyUiStore = create<QecStudyUiState>((set) => ({
  activeStudyId: null,
  setActiveStudy: (id) => set({ activeStudyId: isKnownStudy(id) ? id : null }),
  clearActiveStudy: () => set({ activeStudyId: null }),
}));

// Discovery is the source of truth. If a hand-edited or deleted manifest
// removes the selected id, normalize immediately instead of retaining a stale
// selection that no longer has a backing Study.
useQecStudyStore.subscribe((state) => {
  const activeStudyId = useQecStudyUiStore.getState().activeStudyId;
  if (activeStudyId && !state.studies.some((entry) => entry.study.id === activeStudyId)) {
    useQecStudyUiStore.setState({ activeStudyId: null });
  }
});
