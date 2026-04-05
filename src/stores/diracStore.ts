import { create } from 'zustand';

export interface DiracMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface DiracState {
  messages: DiracMessage[];
  isLoading: boolean;
  apiKey: string | null;
  addMessage: (msg: DiracMessage) => void;
  updateLastAssistant: (content: string) => void;
  setLoading: (loading: boolean) => void;
  setApiKey: (key: string | null) => void;
  clearHistory: () => void;
}

export const useDiracStore = create<DiracState>((set) => ({
  messages: [],
  isLoading: false,
  apiKey: null,
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  updateLastAssistant: (content) => set((s) => {
    const msgs = [...s.messages];
    const lastIdx = msgs.length - 1;
    if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
      msgs[lastIdx] = { ...msgs[lastIdx], content };
    }
    return { messages: msgs };
  }),
  setLoading: (isLoading) => set({ isLoading }),
  setApiKey: (apiKey) => set({ apiKey }),
  clearHistory: () => set({ messages: [] }),
}));
