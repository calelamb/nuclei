import { create } from 'zustand';

interface DiracPanelState {
  /** Whether the Dirac side panel is visible */
  isOpen: boolean;
  /** Panel width in pixels */
  width: number;
  /** Signal to focus the input — increment to trigger */
  focusSignal: number;
  /** True while the panel is closed only because the window is narrow; it comes back when the window grows. */
  autoCollapsed: boolean;
  /** Last viewport band seen by `applyNarrow` (null before the first call). */
  lastNarrow: boolean | null;
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
  /** Collapse to the rail tab when narrow, restore on grow. Acts only when the band changes. */
  applyNarrow: (narrow: boolean) => void;
  /** Restore persisted state (user intent; never the transient auto-collapse). */
  hydrate: (saved: { isOpen?: boolean; width?: number }) => void;
}

const MIN_WIDTH = 280;
const MAX_WIDTH_RATIO = 0.5; // 50% of window
const DEFAULT_WIDTH = 320;

function clampWidth(w: number): number {
  const maxW = typeof window !== 'undefined' ? window.innerWidth * MAX_WIDTH_RATIO : 800;
  return Math.max(MIN_WIDTH, Math.min(maxW, w));
}

export const useDiracPanelStore = create<DiracPanelState>((set) => ({
  isOpen: true,
  width: DEFAULT_WIDTH,
  focusSignal: 0,
  autoCollapsed: false,
  lastNarrow: null,
  // Every explicit user action takes over from the automatic collapse.
  toggle: () => set((s) => ({ isOpen: !s.isOpen, autoCollapsed: false })),
  open: () => set({ isOpen: true, autoCollapsed: false }),
  close: () => set({ isOpen: false, autoCollapsed: false }),
  setWidth: (w) => set({ width: clampWidth(w) }),
  focusInput: () => set((s) => ({ isOpen: true, autoCollapsed: false, focusSignal: s.focusSignal + 1 })),
  applyNarrow: (narrow) =>
    set((s) => {
      if (s.lastNarrow === narrow) return s;
      if (narrow) {
        return s.isOpen
          ? { lastNarrow: narrow, isOpen: false, autoCollapsed: true }
          : { lastNarrow: narrow };
      }
      return s.autoCollapsed
        ? { lastNarrow: narrow, isOpen: true, autoCollapsed: false }
        : { lastNarrow: narrow };
    }),
  hydrate: (saved) =>
    set((s) => ({
      // An automatic collapse is not the user's choice; keep their intent.
      isOpen: typeof saved.isOpen === 'boolean' ? saved.isOpen : s.isOpen || s.autoCollapsed,
      width: typeof saved.width === 'number' ? clampWidth(saved.width) : s.width,
      autoCollapsed: false,
      lastNarrow: null,
    })),
  pendingPrompt: null,
  keyEntryOpen: false,
  requestKeyUpdate: () => set({ isOpen: true, autoCollapsed: false, keyEntryOpen: true }),
  closeKeyEntry: () => set({ keyEntryOpen: false }),
  ask: (text) => set({ isOpen: true, autoCollapsed: false, pendingPrompt: text }),
  clearPendingPrompt: () => set({ pendingPrompt: null }),
}));
