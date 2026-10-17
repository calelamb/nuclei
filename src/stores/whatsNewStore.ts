import { create } from 'zustand';

interface WhatsNewState {
  /** True when the user asked to (re)open the release notes from the palette or Settings. */
  requested: boolean;
  openWhatsNew: () => void;
  clearRequest: () => void;
}

export const useWhatsNewStore = create<WhatsNewState>((set) => ({
  requested: false,
  openWhatsNew: () => set({ requested: true }),
  clearRequest: () => set({ requested: false }),
}));
