import { create } from 'zustand';

interface DiracPanelState {
  /** Whether the Dirac side panel is visible */
  isOpen: boolean;
  /** Panel width in pixels */
  width: number;
  /** Signal to focus the input — increment to trigger */
  focusSignal: number;
  toggle: () => void;
  open: () => void;
  close: () => void;
  setWidth: (w: number) => void;
  focusInput: () => void;
}

const MIN_WIDTH = 280;
const MAX_WIDTH_RATIO = 0.5; // 50% of window
const DEFAULT_WIDTH = 320;

export const useDiracPanelStore = create<DiracPanelState>((set) => ({
  isOpen: true,
  width: DEFAULT_WIDTH,
  focusSignal: 0,
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setWidth: (w) => {
    const maxW = typeof window !== 'undefined' ? window.innerWidth * MAX_WIDTH_RATIO : 800;
    set({ width: Math.max(MIN_WIDTH, Math.min(maxW, w)) });
  },
  focusInput: () => set((s) => {
    if (!s.isOpen) return { isOpen: true, focusSignal: s.focusSignal + 1 };
    return { focusSignal: s.focusSignal + 1 };
  }),
}));
