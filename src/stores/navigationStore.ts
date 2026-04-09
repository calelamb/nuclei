import { create } from 'zustand';

/**
 * Lightweight store for cross-component sidebar navigation signals.
 * Increment `settingsSignal` to request the sidebar open to Settings.
 */
interface NavigationState {
  /** Increment to request sidebar switch to Settings view. */
  settingsSignal: number;
  openSettings: () => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  settingsSignal: 0,
  openSettings: () => set((s) => ({ settingsSignal: s.settingsSignal + 1 })),
}));
