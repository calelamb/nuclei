import { create } from 'zustand';

interface DiracPanelState {
  /** Whether the Dirac side panel is visible */
  isOpen: boolean;
  /** Panel width in pixels */
  width: number;
  /** Signal to focus the input — increment to trigger */
  focusSignal: number;
  /** A question queued from elsewhere in the app (e.g. a concept card). The panel sends it once Dirac is connected. */
  pendingPrompt: string | null;
  /** Open the panel and queue `text` to be sent as a user message. */
  ask: (text: string) => void;
  clearPendingPrompt: () => void;
  /** True while the key form is shown over the chat (rejected key, or the user asked to change it). */
  keyEntryOpen: boolean;
  requestKeyUpdate: () => void;
  closeKeyEntry: () => void;
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
  pendingPrompt: null,
  keyEntryOpen: false,
  requestKeyUpdate: () => set({ isOpen: true, keyEntryOpen: true }),
  closeKeyEntry: () => set({ keyEntryOpen: false }),
  ask: (text) => set({ isOpen: true, pendingPrompt: text }),
  clearPendingPrompt: () => set({ pendingPrompt: null }),
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
