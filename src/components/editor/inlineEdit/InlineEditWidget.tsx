import { Button } from '../../ui';
import { shortcutLabel } from '../../../config/keybindings';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useThemeStore } from '../../../stores/themeStore';
import { useEditorStore } from '../../../stores/editorStore';
import { useCircuitStore } from '../../../stores/circuitStore';
import { useDiracStore } from '../../../stores/diracStore';
import { usePlatform } from '../../../platform/PlatformProvider';
import { DIRAC_API_URL, SONNET_MODEL } from '../../../config/dirac';
import { QSHARP_STYLE_GUIDE } from '../../../services/qsharpStyle';
import { kernelLanguageFor } from '../../../types/quantum';
import { DiracKeyNotice } from '../../dirac/DiracKeyNotice';
import { DiracErrorCard } from '../../dirac/DiracErrorCard';
import { describeHttpError, describeThrownError, type DiracErrorInfo } from '../../../lib/diracErrors';
import { DIRAC_KEY_NOTICE_TITLE, useHasDiracKey } from '../../dirac/diracKeyAccess';

import { TYPOGRAPHY } from '../../../styles/tokens';
const HISTORY_KEY = 'cmdk_history';
const MAX_HISTORY = 20;

const CMDK_SYSTEM_PROMPT = `You are Dirac, a quantum computing expert. Rewrite the selected code according to the user's instruction. Return ONLY the replacement code, no explanation, no markdown backticks, no commentary. Preserve the user's coding style and variable names.`;

interface InlineEditProps {
  editor: monaco.editor.IStandaloneCodeEditor;
  monaco: Monaco;
  onClose: () => void;
}

export function InlineEditWidget({ editor, monaco, onClose }: InlineEditProps) {
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorInfo, setErrorInfo] = useState<DiracErrorInfo | null>(null);
  const [diffResult, setDiffResult] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasKey = useHasDiracKey();
  const colors = useThemeStore((s) => s.colors);
  const platform = usePlatform();

  // Load history
  useEffect(() => {
    platform.getStoredValue<string[]>(HISTORY_KEY).then((h) => {
      if (h) setHistory(h);
    });
  }, [platform]);

  useEffect(() => {
    if (hasKey) inputRef.current?.focus();
    else rootRef.current?.querySelector('button')?.focus();
  }, [hasKey]);

  // The field is read-only (never disabled) while Dirac thinks, so focus is never thrown to <body>.
  const wasLoading = useRef(false);
  useEffect(() => {
    if (wasLoading.current && !loading && hasKey) {
      const active = document.activeElement;
      if (!active || active === document.body || active === inputRef.current) inputRef.current?.focus();
    }
    wasLoading.current = loading;
  }, [loading, hasKey]);

  // Closing hands the keyboard back to the editor, so typing continues where it stopped.
  const closeAndRefocus = useCallback(() => {
    onClose();
    requestAnimationFrame(() => editor.focus());
  }, [onClose, editor]);

  const closeAndRefocusRef = useRef<(refocus: boolean) => void>(() => undefined);
  useEffect(() => {
    closeAndRefocusRef.current = (refocus) => (refocus ? closeAndRefocus() : onClose());
  }, [closeAndRefocus, onClose]);

  // Get position below selection
  const selection = editor.getSelection();
  const model = editor.getModel();
  const selectedText = model && selection && !selection.isEmpty()
    ? model.getValueInRange(selection)
    : model?.getLineContent(selection?.positionLineNumber ?? 1) ?? '';

  const widgetTop = editor.getTopForLineNumber((selection?.endLineNumber ?? 1) + 1) - editor.getScrollTop() + 30;

  // The widget is a transient prompt, not a pinned panel: it leaves when the person moves on in the code.
  const anchorLine = useRef(selection?.positionLineNumber ?? 1);
  const anchorEndLine = useRef(selection?.endLineNumber ?? 1);
  useEffect(() => {
    const subs = [
      editor.onDidChangeModelContent(() => closeAndRefocusRef.current(false)),
      editor.onDidChangeCursorPosition((e) => {
        const line = e.position.lineNumber;
        const lo = Math.min(anchorLine.current, anchorEndLine.current);
        const hi = Math.max(anchorLine.current, anchorEndLine.current);
        if (line < lo || line > hi) closeAndRefocusRef.current(false);
      }),
      editor.onKeyDown((e) => {
        if (e.browserEvent.key === 'Escape') closeAndRefocusRef.current(true);
      }),
    ];
    return () => subs.forEach((d) => d.dispose());
  }, [editor]);

  const handleSubmit = useCallback(async () => {
    if (!instruction.trim() || loading) return;
    setLoading(true);
    setError(null);
    setErrorInfo(null);

    const apiKey = useDiracStore.getState().apiKey;
    if (!apiKey || apiKey.trim() === '') {
      setDiffResult(null);
      setLoading(false);
      setError(DIRAC_KEY_NOTICE_TITLE);
      return;
    }

    const fullCode = useEditorStore.getState().code;
    const framework = useEditorStore.getState().framework;
    const snapshot = useCircuitStore.getState().snapshot;
    const fenceLanguage = kernelLanguageFor(framework);
    const systemPrompt =
      framework === 'qsharp'
        ? `${CMDK_SYSTEM_PROMPT}\n\nThe code is Q# (Microsoft QDK), not Python.\n\n${QSHARP_STYLE_GUIDE}`
        : CMDK_SYSTEM_PROMPT;

    const contextParts = [
      `Framework: ${framework}`,
      snapshot ? `Circuit: ${snapshot.qubit_count} qubits, depth ${snapshot.depth}` : '',
      `Full file:\n\`\`\`${fenceLanguage}\n${fullCode}\n\`\`\``,
      `Selected code to rewrite:\n\`\`\`${fenceLanguage}\n${selectedText}\n\`\`\``,
      `Instruction: ${instruction}`,
    ].filter(Boolean).join('\n\n');

    try {
      const response = await fetch(DIRAC_API_URL, {
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
          system: systemPrompt,
          messages: [{ role: 'user', content: contextParts }],
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        setErrorInfo(describeHttpError(response.status, body));
        setLoading(false);
        return;
      }
      const data = await response.json();
      const result = data.content?.[0]?.text?.trim() ?? '';
      if (result) {
        setDiffResult(result);
        // Save to history
        const updated = [instruction, ...history.filter((h) => h !== instruction)].slice(0, MAX_HISTORY);
        setHistory(updated);
        platform.setStoredValue(HISTORY_KEY, updated).catch(() => {});
      } else {
        setError('Dirac returned no change to apply.');
      }
    } catch (e) {
      setErrorInfo(describeThrownError(e));
    }
    setLoading(false);
  }, [instruction, loading, selectedText, history, platform]);

  const handleAccept = useCallback(() => {
    if (!diffResult || !selection || !model) return;
    editor.executeEdits('cmdk', [{
      range: selection.isEmpty()
        ? new monaco.Range(selection.positionLineNumber, 1, selection.positionLineNumber, model.getLineMaxColumn(selection.positionLineNumber))
        : selection,
      text: diffResult,
    }]);
    closeAndRefocus();
  }, [diffResult, selection, editor, monaco, model, closeAndRefocus]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Escape is handled once, on the widget root, so it works from every control inside.
    if (e.key === 'Enter' && !diffResult) {
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

  if (!model) return null;

  return (
    <div
      ref={rootRef}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAndRefocus(); } }}
      onBlur={(e) => {
        const next = e.relatedTarget;
        if (next instanceof Node && !e.currentTarget.contains(next)) onClose();
      }}
      style={{
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
      {!hasKey && (
        <div style={{ padding: '10px 12px' }}>
          <DiracKeyNotice onAddKey={onClose} onDismiss={closeAndRefocus} />
        </div>
      )}
      {hasKey && (<>
      {/* Input */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', gap: 8 }}>
        <span style={{ color: colors.accentText, fontSize: 12, fontWeight: 600, fontFamily: TYPOGRAPHY.fontMono }}>⌘K</span>
        <input
          ref={inputRef}
          value={instruction}
          onChange={(e) => { if (!loading) { setInstruction(e.target.value); setHistoryIdx(-1); } }}
          onKeyDown={handleKeyDown}
          placeholder="Describe the change..."
            className="nuclei-bare-input"
          readOnly={loading}
          aria-busy={loading || undefined}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: colors.text,
            fontSize: 13,
            fontFamily: TYPOGRAPHY.fontSans,
          }}
        />
        {loading && <span style={{ color: colors.accentText, fontSize: 11 }}>Thinking...</span>}
      </div>

      {/* Error */}
      {errorInfo && !loading && (
        <div style={{ padding: '0 10px 8px' }}>
          <DiracErrorCard error={errorInfo} onUpdateKey={onClose} />
        </div>
      )}
      {error && !loading && (
        <div role="alert" style={{ padding: '0 10px 8px', color: colors.error, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans, lineHeight: 1.4 }}>
          {error}
        </div>
      )}

      {/* Diff preview */}
      {diffResult && (
        <div>
          <div style={{ padding: '0 10px', borderTop: `1px solid ${colors.border}` }}>
            <pre style={{
              margin: '8px 0',
              padding: 8,
              background: 'color-mix(in srgb, var(--color-success) 14%, transparent)',
              borderLeft: `3px solid ${colors.success}`,
              borderRadius: 4,
              color: colors.text,
              fontSize: 12,
              fontFamily: TYPOGRAPHY.fontMono,
              overflow: 'auto',
              maxHeight: 200,
            }}>
              {diffResult}
            </pre>
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderTop: `1px solid ${colors.border}` }}>
            <Button size="sm" variant="primary" onClick={handleAccept}>Apply ({shortcutLabel('run')})</Button>
            <Button size="sm" onClick={closeAndRefocus}>Dismiss (Esc)</Button>
          </div>
        </div>
      )}
      </>)}
    </div>
  );
}
