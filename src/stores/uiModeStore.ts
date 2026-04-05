import { create } from 'zustand';

export type UIMode = 'beginner' | 'intermediate' | 'advanced';

interface UIModeState {
  mode: UIMode;
  setMode: (mode: UIMode) => void;
  cycleMode: () => void;
}

const MODE_ORDER: UIMode[] = ['beginner', 'intermediate', 'advanced'];

export const useUIModeStore = create<UIModeState>((set, get) => ({
  mode: 'intermediate',
  setMode: (mode) => set({ mode }),
  cycleMode: () => {
    const current = get().mode;
    const idx = MODE_ORDER.indexOf(current);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    set({ mode: next });
  },
}));
