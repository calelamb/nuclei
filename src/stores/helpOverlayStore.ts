import { create } from 'zustand';

interface HelpOverlayState {
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  toggleShortcuts: () => void;
  composeOpen: boolean;
  setComposeOpen: (open: boolean) => void;
  toggleCompose: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
}

/** Open state of the shortcuts sheet and command palette, so Settings and the status bar can open what App.tsx renders. */
export const useHelpOverlayStore = create<HelpOverlayState>((set) => ({
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  toggleShortcuts: () => set((s) => ({ shortcutsOpen: !s.shortcutsOpen })),
  composeOpen: false,
  setComposeOpen: (composeOpen) => set({ composeOpen }),
  toggleCompose: () => set((s) => ({ composeOpen: !s.composeOpen })),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
}));
