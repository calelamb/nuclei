import { useState, useRef, useEffect, useCallback } from 'react';
import { useThemeStore } from '../../../stores/themeStore';
import { useEditorStore } from '../../../stores/editorStore';
import { useCircuitStore } from '../../../stores/circuitStore';
import { useDiracStore } from '../../../stores/diracStore';
import { usePlatform } from '../../../platform/PlatformProvider';

const API_URL = 'https://api.anthropic.com/v1/messages';
const SONNET_MODEL = 'claude-sonnet-4-5-20241022';
const HISTORY_KEY = 'cmdk_history';
const MAX_HISTORY = 20;

const CMDK_SYSTEM_PROMPT = `You are Dirac, a quantum computing expert. Rewrite the selected code according to the user's instruction. Return ONLY the replacement code, no explanation, no markdown backticks, no commentary. Preserve the user's coding style and variable names.`;

interface InlineEditProps {
  editor: any;
  monaco: any;
  onClose: () => void;
}

export function InlineEditWidget({ editor, monaco, onClose }: InlineEditProps) {
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const colors = useThemeStore((s) => s.colors);
  const platform = usePlatform();

  // Load history
  useEffect(() => {
    platform.getStoredValue<string[]>(HISTORY_KEY).then((h) => {
      if (h) setHistory(h);
    });
  }, [platform]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Get position below selection
  const selection = editor.getSelection();
  const model = editor.getModel();
  const selectedText = selection && !selection.isEmpty()
    ? model.getValueInRange(selection)
    : model.getLineContent(selection?.positionLineNumber ?? 1);

  const widgetTop = editor.getTopForLineNumber((selection?.endLineNumber ?? 1) + 1) - editor.getScrollTop() + 30;

  const handleSubmit = useCallback(async () => {
    if (!instruction.trim() || loading) return;
    setLoading(true);

    const apiKey = useDiracStore.getState().apiKey;
    if (!apiKey) { setLoading(false); return; }

    const fullCode = useEditorStore.getState().code;
    const framework = useEditorStore.getState().framework;
    const snapshot = useCircuitStore.getState().snapshot;

    const contextParts = [
      `Framework: ${framework}`,
      snapshot ? `Circuit: ${snapshot.qubit_count} qubits, depth ${snapshot.depth}` : '',
      `Full file:\n\`\`\`python\n${fullCode}\n\`\`\``,
      `Selected code to rewrite:\n\`\`\`python\n${selectedText}\n\`\`\``,
      `Instruction: ${instruction}`,
    ].filter(Boolean).join('\n\n');

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
          model: SONNET_MODEL,
          max_tokens: 2048,
          system: CMDK_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: contextParts }],
        }),
      });

      if (!response.ok) { setLoading(false); return; }
      const data = await response.json();
      const result = data.content?.[0]?.text?.trim() ?? '';
      if (result) {
        setDiffResult(result);
        // Save to history
        const updated = [instruction, ...history.filter((h) => h !== instruction)].slice(0, MAX_HISTORY);
        setHistory(updated);
        platform.setStoredValue(HISTORY_KEY, updated).catch(() => {});
      }
    } catch {}
    setLoading(false);
  }, [instruction, loading, selectedText, history, platform]);

  const handleAccept = useCallback(() => {
    if (!diffResult || !selection) return;
    editor.executeEdits('cmdk', [{
      range: selection.isEmpty()
        ? new monaco.Range(selection.positionLineNumber, 1, selection.positionLineNumber, model.getLineMaxColumn(selection.positionLineNumber))
        : selection,
      text: diffResult,
    }]);
    onClose();
  }, [diffResult, selection, editor, monaco, model, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && !diffResult) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && diffResult) {
      e.preventDefault();
      handleAccept();
    } else if (e.key === 'ArrowUp' && !diffResult && history.length > 0) {
      e.preventDefault();
      const newIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(newIdx);
      setInstruction(history[newIdx]);
    } else if (e.key === 'ArrowDown' && !diffResult && historyIdx > 0) {
      e.preventDefault();
      const newIdx = historyIdx - 1;
      setHistoryIdx(newIdx);
      setInstruction(history[newIdx]);
    }
  };

  return (
    <div style={{
      position: 'absolute',
      top: widgetTop,
      left: 60,
      right: 20,
      zIndex: 100,
      background: colors.bgPanel,
      border: `1px solid ${colors.accent}`,
      borderRadius: 6,
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      overflow: 'hidden',
    }}>
      {/* Input */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', gap: 8 }}>
        <span style={{ color: colors.accent, fontSize: 12, fontWeight: 600, fontFamily: "'Fira Code', monospace" }}>⌘K</span>
        <input
          ref={inputRef}
          value={instruction}
          onChange={(e) => { setInstruction(e.target.value); setHistoryIdx(-1); }}
          onKeyDown={handleKeyDown}
          placeholder="Describe the change..."
          disabled={loading}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: colors.text,
            fontSize: 13,
            fontFamily: 'Inter, sans-serif',
          }}
        />
        {loading && <span style={{ color: colors.accent, fontSize: 11 }}>Thinking...</span>}
      </div>

      {/* Diff preview */}
      {diffResult && (
        <div>
          <div style={{ padding: '0 10px', borderTop: `1px solid ${colors.border}` }}>
            <pre style={{
              margin: '8px 0',
              padding: 8,
              background: '#1A3D1A',
              borderRadius: 4,
              color: '#98C379',
              fontSize: 12,
              fontFamily: "'Fira Code', monospace",
              overflow: 'auto',
              maxHeight: 200,
            }}>
              {diffResult}
            </pre>
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderTop: `1px solid ${colors.border}` }}>
            <button
              onClick={handleAccept}
              style={{ padding: '4px 12px', background: '#98C379', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 12, fontFamily: 'Inter, sans-serif' }}
            >
              Apply (⌘+Enter)
            </button>
            <button
              onClick={onClose}
              style={{ padding: '4px 12px', background: colors.border, color: colors.text, border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 12, fontFamily: 'Inter, sans-serif' }}
            >
              Dismiss (Esc)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
