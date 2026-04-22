import { create } from 'zustand';

export type BottomPanelTab = 'terminal' | 'histogram';

interface BottomPanelState {
  collapsed: boolean;
  activeTab: BottomPanelTab;
  autoScroll: boolean;
  showTimestamps: boolean;
  filter: string;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  setActiveTab: (tab: BottomPanelTab) => void;
  setAutoScroll: (enabled: boolean) => void;
  toggleAutoScroll: () => void;
  setShowTimestamps: (show: boolean) => void;
  toggleShowTimestamps: () => void;
  setFilter: (filter: string) => void;
  focusTerminal: () => void;
}

export const useBottomPanelStore = create<BottomPanelState>((set) => ({
  collapsed: false,
  activeTab: 'terminal',
  autoScroll: true,
  showTimestamps: false,
  filter: '',
  setCollapsed: (collapsed) => set({ collapsed }),
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
  setActiveTab: (activeTab) => set({ activeTab }),
  setAutoScroll: (autoScroll) => set({ autoScroll }),
  toggleAutoScroll: () => set((s) => ({ autoScroll: !s.autoScroll })),
  setShowTimestamps: (showTimestamps) => set({ showTimestamps }),
  toggleShowTimestamps: () => set((s) => ({ showTimestamps: !s.showTimestamps })),
  setFilter: (filter) => set({ filter }),
  // Open the bottom panel and focus the terminal tab. Used by Cmd+`
  // and by the kernel-message handler to surface fresh output.
  focusTerminal: () => set({ collapsed: false, activeTab: 'terminal' }),
}));
