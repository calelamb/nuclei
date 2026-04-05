import { useEffect, useCallback } from 'react';
import { load } from '@tauri-apps/plugin-store';
import { useDiracStore } from '../stores/diracStore';
import { useEditorStore } from '../stores/editorStore';

const STORE_KEY = 'claude_api_key';
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are Dirac, an AI teaching assistant for quantum computing, named after physicist Paul Dirac. You live inside Nuclei, a quantum computing IDE.

Your personality:
- Patient, encouraging, and never condescending
- You explain concepts in plain English first, then math if needed
- You can see the user's current code and reference it in your explanations
- You're enthusiastic about quantum computing and love helping beginners learn
- Keep responses concise but thorough — aim for clarity over brevity

You can help with:
- Explaining quantum computing concepts (superposition, entanglement, measurement, gates)
- Understanding and debugging Qiskit and Cirq code
- Suggesting improvements to quantum circuits
- Explaining what specific gates do (with matrix representations if asked)
- Helping design circuits for specific tasks`;

async function getStore() {
  return await load('settings.json', { autoSave: true });
}

export function useDirac() {
  const { apiKey, setApiKey, addMessage, updateLastAssistant, setLoading } = useDiracStore();

  // Load API key on mount
  useEffect(() => {
    (async () => {
      try {
        const store = await getStore();
        const key = await store.get<string>(STORE_KEY);
        if (key) setApiKey(key);
      } catch {
        // Store not available yet — will prompt user
      }
    })();
  }, [setApiKey]);

  const saveApiKey = useCallback(async (key: string) => {
    setApiKey(key);
    try {
      const store = await getStore();
      await store.set(STORE_KEY, key);
    } catch (e) {
      console.error('Failed to save API key:', e);
    }
  }, [setApiKey]);

  const sendMessage = useCallback(async (userText: string) => {
    if (!apiKey) return;

    const code = useEditorStore.getState().code;
    const framework = useEditorStore.getState().framework;

    // Add user message
    addMessage({ role: 'user', content: userText });
    setLoading(true);

    // Build messages array with context
    const contextPrefix = `[User's current code (${framework}):\n\`\`\`python\n${code}\n\`\`\`]\n\n`;
    const messages = useDiracStore.getState().messages.map((m, i) => ({
      role: m.role as 'user' | 'assistant',
      content: i === useDiracStore.getState().messages.length - 1 && m.role === 'user'
        ? contextPrefix + m.content
        : m.content,
    }));

    // Add empty assistant message for streaming
    addMessage({ role: 'assistant', content: '' });

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        updateLastAssistant(`Error: ${response.status} — ${errorText}`);
        setLoading(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        updateLastAssistant('Error: No response stream');
        setLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                accumulated += parsed.delta.text;
                updateLastAssistant(accumulated);
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      }

      setLoading(false);
    } catch (e) {
      updateLastAssistant(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
      setLoading(false);
    }
  }, [apiKey, addMessage, updateLastAssistant, setLoading]);

  return { sendMessage, saveApiKey };
}
