import { create } from 'zustand';

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'accepted' | 'rejected' | 'executed';
  result?: string;
}

export interface DiracMessage {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string; // extended thinking content
  toolCalls?: ToolCall[];
}

interface DiracState {
  messages: DiracMessage[];
  isLoading: boolean;
  apiKey: string | null;
  addMessage: (msg: DiracMessage) => void;
  updateLastAssistant: (content: string) => void;
  updateLastThinking: (thinking: string) => void;
  updateLastToolCalls: (toolCalls: ToolCall[]) => void;
  updateToolCallStatus: (toolId: string, status: ToolCall['status'], result?: string) => void;
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
  updateLastThinking: (thinking) => set((s) => {
    const msgs = [...s.messages];
    const lastIdx = msgs.length - 1;
    if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
      msgs[lastIdx] = { ...msgs[lastIdx], thinking };
    }
    return { messages: msgs };
  }),
  updateLastToolCalls: (toolCalls) => set((s) => {
    const msgs = [...s.messages];
    const lastIdx = msgs.length - 1;
    if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
      msgs[lastIdx] = { ...msgs[lastIdx], toolCalls };
    }
    return { messages: msgs };
  }),
  updateToolCallStatus: (toolId, status, result) => set((s) => {
    const msgs = s.messages.map((m) => {
      if (!m.toolCalls) return m;
      const updated = m.toolCalls.map((tc) =>
        tc.id === toolId ? { ...tc, status, result: result ?? tc.result } : tc
      );
      return { ...m, toolCalls: updated };
    });
    return { messages: msgs };
  }),
  setLoading: (isLoading) => set({ isLoading }),
  setApiKey: (apiKey) => set({ apiKey }),
  clearHistory: () => set({ messages: [] }),
}));
