import { create } from 'zustand';
import { useLayoutStore } from './layoutStore';

export type BottomPanelTab = 'terminal' | 'histogram';

interface BottomPanelState {
  collapsed: boolean;
  activeTab: BottomPanelTab;
  autoScroll: boolean;
  showTimestamps: boolean;
  filter: string;
  /** Terminal lines that arrived while the Terminal was collapsed or another tab was showing. */
  unreadLines: number;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  setActiveTab: (tab: BottomPanelTab) => void;
  setAutoScroll: (enabled: boolean) => void;
  toggleAutoScroll: () => void;
  setShowTimestamps: (show: boolean) => void;
  toggleShowTimestamps: () => void;
  setFilter: (filter: string) => void;
  focusTerminal: () => void;
  /** Ordinary output: never re-opens a Terminal the user collapsed; counts it as unread instead. */
  noteOutput: (lines?: number) => void;
  /** An error the user must see: forces the Terminal open. */
  noteError: () => void;
}

export const useBottomPanelStore = create<BottomPanelState>((set, get) => ({
  collapsed: false,
  activeTab: 'terminal',
  autoScroll: true,
  showTimestamps: false,
  filter: '',
  unreadLines: 0,
  setCollapsed: (collapsed) => set((s) => ({ collapsed, unreadLines: collapsed ? s.unreadLines : 0 })),
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed, unreadLines: s.collapsed ? 0 : s.unreadLines })),
  setActiveTab: (activeTab) => set((s) => ({ activeTab, unreadLines: activeTab === 'terminal' && !s.collapsed ? 0 : s.unreadLines })),
  setAutoScroll: (autoScroll) => set({ autoScroll }),
  toggleAutoScroll: () => set((s) => ({ autoScroll: !s.autoScroll })),
  setShowTimestamps: (showTimestamps) => set({ showTimestamps }),
  toggleShowTimestamps: () => set((s) => ({ showTimestamps: !s.showTimestamps })),
  setFilter: (filter) => set({ filter }),
  // Open the bottom panel and focus the terminal tab. Used by Cmd+`
  // and by the kernel-message handler to surface fresh output.
  // A user-hidden terminal override is dropped so fresh output or a failed run is never invisible.
  focusTerminal: () => {
    const layout = useLayoutStore.getState();
    if (layout.overrides.terminal === false) layout.clearPanelOverride('terminal');
    set({ collapsed: false, activeTab: 'terminal', unreadLines: 0 });
  },
  noteOutput: (lines = 1) =>
    set((s) => (s.collapsed || s.activeTab !== 'terminal' ? { unreadLines: s.unreadLines + Math.max(1, lines) } : s)),
  noteError: () => get().focusTerminal(),
}));
