import { create } from 'zustand';

interface HelpOverlayState {
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  toggleShortcuts: () => void;
}

/** Lets Settings and the palette open the shortcuts sheet that App.tsx renders. */
export const useHelpOverlayStore = create<HelpOverlayState>((set) => ({
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  toggleShortcuts: () => set((s) => ({ shortcutsOpen: !s.shortcutsOpen })),
}));
