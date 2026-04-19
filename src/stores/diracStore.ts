import { create } from 'zustand';
import { DIRAC_API_KEY } from '../config/dirac';

const API_KEY_STORAGE_KEY = 'nuclei-dirac-api-key';

/** Load persisted API key from localStorage, falling back to env config. */
function loadApiKey(): string | null {
  try {
    const stored = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (stored) return stored;
  } catch { /* restricted environment */ }
  return DIRAC_API_KEY || null;
}

/** Persist API key to localStorage. Removes the entry when key is null/empty. */
function persistApiKey(key: string | null): void {
  try {
    if (key) {
      localStorage.setItem(API_KEY_STORAGE_KEY, key);
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch { /* restricted environment */ }
}

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

export interface AmbientMessage {
  id: string;
  kind: 'parse' | 'result';
  text: string;
  timestamp: number;
}

export interface StoredRewrittenError {
  explanation: string;
  fix: string | null;
  originalTraceback: string;
  timestamp: number;
}

export interface ComposePreview {
  id: string;
  intent: string;
  code: string;
  explanation: string;
  timestamp: number;
}

interface DiracState {
  messages: DiracMessage[];
  isLoading: boolean;
  apiKey: string | null;
  ambientFeed: AmbientMessage[];
  rewrittenError: StoredRewrittenError | null;
  composePreview: ComposePreview | null;
  addMessage: (msg: DiracMessage) => void;
  updateLastAssistant: (content: string) => void;
  updateLastThinking: (thinking: string) => void;
  updateLastToolCalls: (toolCalls: ToolCall[]) => void;
  updateToolCallStatus: (toolId: string, status: ToolCall['status'], result?: string) => void;
  setLoading: (loading: boolean) => void;
  setApiKey: (key: string | null) => void;
  clearHistory: () => void;
  pushAmbient: (msg: Omit<AmbientMessage, 'id' | 'timestamp'>) => void;
  clearAmbient: () => void;
  setRewrittenError: (err: Omit<StoredRewrittenError, 'timestamp'>) => void;
  clearRewrittenError: () => void;
  setComposePreview: (p: Omit<ComposePreview, 'id' | 'timestamp'>) => void;
  clearComposePreview: () => void;
}

export const useDiracStore = create<DiracState>((set) => ({
  messages: [],
  isLoading: false,
  apiKey: loadApiKey(),
  ambientFeed: [],
  rewrittenError: null,
  composePreview: null,
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
  setApiKey: (apiKey) => {
    persistApiKey(apiKey);
    set({ apiKey });
  },
  clearHistory: () => set({ messages: [] }),
  pushAmbient: (msg) => set((s) => ({
    ambientFeed: [
      ...s.ambientFeed.slice(-4), // cap at last 5 including the new entry
      { ...msg, id: crypto.randomUUID(), timestamp: Date.now() },
    ],
  })),
  clearAmbient: () => set({ ambientFeed: [] }),
  setRewrittenError: (err) => set({ rewrittenError: { ...err, timestamp: Date.now() } }),
  clearRewrittenError: () => set({ rewrittenError: null }),
  setComposePreview: (p) => set({
    composePreview: { ...p, id: crypto.randomUUID(), timestamp: Date.now() },
  }),
  clearComposePreview: () => set({ composePreview: null }),
}));
