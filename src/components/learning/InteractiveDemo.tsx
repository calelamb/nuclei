import { useState, useRef, useCallback, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { useThemeStore, type ThemeColors } from '../../stores/themeStore';
import { useLearnStore } from '../../stores/learnStore';
import { useEditorStore } from '../../stores/editorStore';
import { usePlatform } from '../../platform/PlatformProvider';
import { KERNEL_WS_URL } from '../../config/kernel';
import type { Framework, CircuitSnapshot, SimulationResult, KernelResponse } from '../../types/quantum';
import { Play, RotateCcw, ExternalLink, Terminal, BarChart3 } from 'lucide-react';

interface InteractiveDemoProps {
  code: string;
  framework: Framework;
  description: string;
  explorationPrompt?: string;
}

/* ── Compact probability display ── */
function ProbabilityBars({ probabilities, accent, colors }: {
  probabilities: Record<string, number>;
  accent: string;
  colors: ThemeColors;
}) {
  const entries = Object.entries(probabilities)
    .filter(([, p]) => p > 0.001)
    .sort(([, a], [, b]) => b - a);

  if (entries.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {entries.map(([state, prob]) => (
        <div key={state} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 48, textAlign: 'right',
            fontFamily: "'Geist Mono', monospace", fontSize: 12,
            color: colors.text, fontWeight: 500,
          }}>
            |{state}\u27E9
          </span>
          <div style={{
            flex: 1, height: 18, borderRadius: 4,
            background: colors.bgPanel, overflow: 'hidden',
            position: 'relative',
          }}>
            <div style={{
              width: `${prob * 100}%`, height: '100%',
              background: `linear-gradient(90deg, ${accent}cc, ${accent}88)`,
              borderRadius: 4,
              transition: 'width 400ms ease-out',
              minWidth: prob > 0 ? 2 : 0,
            }} />
          </div>
          <span style={{
            width: 42, textAlign: 'right',
            fontFamily: "'Geist Mono', monospace", fontSize: 11,
            color: colors.textMuted,
          }}>
            {(prob * 100).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

export function InteractiveDemo({ code: initialCode, framework, description, explorationPrompt }: InteractiveDemoProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const exitLearnMode = useLearnStore((s) => s.exitLearnMode);
  const setEditorCode = useEditorStore((s) => s.setCode);
  const setEditorFramework = useEditorStore((s) => s.setFramework);
  const platform = usePlatform();
  const isWeb = platform.getPlatform() === 'web';

  const [localCode, setLocalCode] = useState(initialCode);
  const [snapshot, setSnapshot] = useState<CircuitSnapshot | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOutput, setShowOutput] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pyodideRef = useRef<any>(null);

  const handleMessage = useCallback((msg: KernelResponse) => {
    switch (msg.type) {
      case 'snapshot':
        setSnapshot(msg.data);
        break;
      case 'result':
        setResult(msg.data);
        setIsRunning(false);
        setError(null);
        break;
      case 'output':
        setOutput((prev) => [...prev, msg.text]);
        setShowOutput(true);
        break;
      case 'error':
        // Suppress framework detection noise — pure Python is fine
        if (msg.message?.includes('No supported quantum framework')) break;
        setError(msg.message);
        setIsRunning(false);
        break;
    }
  }, []);

  // Connect to kernel with retry
  useEffect(() => {
    if (isWeb) {
      import('../../platform/pyodideKernel').then(({ PyodideKernel }) => {
        const k = new PyodideKernel((msg) => handleMessage(msg as KernelResponse));
        k.init().then(() => { pyodideRef.current = k; });
      });
      return;
    }

    let ws: WebSocket | null = null;
    let retries = 0;
    const maxRetries = 3;

    function connect() {
      ws = new WebSocket(KERNEL_WS_URL);
      ws.onopen = () => { wsRef.current = ws; retries = 0; };
      ws.onmessage = (ev) => {
        try { handleMessage(JSON.parse(ev.data)); } catch { /* noop */ }
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (retries < maxRetries) {
          retries++;
          setTimeout(connect, 1000 * retries);
        }
      };
      ws.onerror = () => ws?.close();
    }

    connect();
    return () => { ws?.close(); };
  }, [handleMessage, isWeb]);

  const sendParse = useCallback((c: string) => {
    if (isWeb && pyodideRef.current) {
      pyodideRef.current.send({ type: 'parse', code: c });
    } else if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'parse', code: c }));
    }
  }, [isWeb]);

  const handleRun = () => {
    setIsRunning(true);
    setError(null);
    setOutput([]);
    setResult(null);
    if (isWeb && pyodideRef.current) {
      pyodideRef.current.send({ type: 'execute', code: localCode, shots: 1024 });
    } else if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'execute', code: localCode, shots: 1024 }));
    } else {
      setError('Kernel not connected. Make sure the Python kernel is running.');
      setIsRunning(false);
    }
  };

  const handleReset = () => {
    setLocalCode(initialCode);
    setResult(null);
    setSnapshot(null);
    setOutput([]);
    setError(null);
    setShowOutput(false);
    sendParse(initialCode);
  };

  const handleOpenInEditor = () => {
    setEditorCode(localCode);
    setEditorFramework(framework);
    exitLearnMode();
  };

  const handleCodeChange = (value: string | undefined) => {
    const v = value ?? '';
    setLocalCode(v);
    sendParse(v);
  };

  useEffect(() => {
    const timer = setTimeout(() => sendParse(localCode), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasResults = result && Object.keys(result.probabilities).length > 0;
  const hasOutput = output.length > 0;

  return (
    <div style={{
      margin: '16px 0',
      borderRadius: 12,
      overflow: 'hidden',
      background: colors.bgElevated,
      border: `1px solid ${colors.border}`,
      boxShadow: shadow.sm,
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: colors.accent }} />
        <span style={{
          color: colors.textMuted, fontSize: 12, fontWeight: 500,
          fontFamily: "'Geist Sans', sans-serif",
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          Interactive Demo
        </span>
        <span style={{ color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif", marginLeft: 4 }}>
          {description}
        </span>
      </div>

      {/* Editor */}
      <div style={{ height: 180, borderBottom: `1px solid ${colors.border}` }}>
        <Editor
          height="100%"
          language="python"
          value={localCode}
          onChange={handleCodeChange}
          theme={useThemeStore.getState().mode === 'dark' ? 'vs-dark' : 'vs-light'}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: 'on',
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 3,
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            scrollbar: { vertical: 'hidden', horizontal: 'auto' },
            padding: { top: 8, bottom: 8 },
            fontFamily: "'JetBrains Mono', 'Geist Mono', monospace",
          }}
        />
      </div>

      {/* Action bar */}
      <div style={{
        padding: '8px 16px',
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: (hasResults || hasOutput || error || (snapshot && snapshot.gates.length > 0)) ? `1px solid ${colors.border}` : 'none',
      }}>
        <button onClick={handleRun} disabled={isRunning} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 14px',
          background: isRunning ? colors.bgPanel : colors.accent,
          color: '#fff', border: 'none', borderRadius: 6,
          fontSize: 12, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif",
          cursor: isRunning ? 'default' : 'pointer',
          boxShadow: isRunning ? 'none' : shadow.sm,
        }}>
          <Play size={12} fill="currentColor" />
          {isRunning ? 'Running...' : 'Run'}
        </button>
        <button onClick={handleReset} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 14px', background: 'transparent',
          color: colors.textMuted, border: `1px solid ${colors.border}`,
          borderRadius: 6, fontSize: 12, fontFamily: "'Geist Sans', sans-serif", cursor: 'pointer',
        }}>
          <RotateCcw size={12} /> Reset
        </button>

        {/* Result toggle tabs */}
        {(hasResults || hasOutput) && (
          <>
            <div style={{ width: 1, height: 16, background: colors.border, marginLeft: 4 }} />
            {hasOutput && (
              <button onClick={() => setShowOutput(true)} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 4, border: 'none',
                background: showOutput ? `${colors.accent}18` : 'transparent',
                color: showOutput ? colors.accent : colors.textDim,
                fontSize: 11, fontFamily: "'Geist Sans', sans-serif", cursor: 'pointer',
              }}>
                <Terminal size={11} /> Output
              </button>
            )}
            {hasResults && (
              <button onClick={() => setShowOutput(false)} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 4, border: 'none',
                background: !showOutput ? `${colors.accent}18` : 'transparent',
                color: !showOutput ? colors.accent : colors.textDim,
                fontSize: 11, fontFamily: "'Geist Sans', sans-serif", cursor: 'pointer',
              }}>
                <BarChart3 size={11} /> Probabilities
              </button>
            )}
          </>
        )}

        <div style={{ flex: 1 }} />
        <button onClick={handleOpenInEditor} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 14px', background: 'transparent',
          color: colors.textMuted, border: `1px solid ${colors.border}`,
          borderRadius: 6, fontSize: 12, fontFamily: "'Geist Sans', sans-serif", cursor: 'pointer',
        }}>
          <ExternalLink size={12} /> Open in Editor
        </button>
      </div>

      {/* Circuit summary */}
      {snapshot && snapshot.gates.length > 0 && (
        <div style={{
          padding: '6px 16px',
          borderBottom: (hasResults || hasOutput || error) ? `1px solid ${colors.border}` : 'none',
          fontSize: 11, fontFamily: "'Geist Mono', monospace", color: colors.textMuted,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ color: colors.textDim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {snapshot.qubit_count}q depth-{snapshot.depth}
          </span>
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {snapshot.gates.map((g, i) => (
              <span key={i} style={{
                padding: '1px 5px', borderRadius: 3,
                background: `${colors.accent}12`, color: colors.accent,
                fontSize: 10, fontWeight: 500,
              }}>
                {g.type}
              </span>
            ))}
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding: '8px 16px',
          background: `${colors.error}10`,
          color: colors.error,
          fontSize: 12,
          fontFamily: "'Geist Mono', monospace",
          borderBottom: `1px solid ${colors.border}`,
          whiteSpace: 'pre-wrap',
          lineHeight: 1.5,
        }}>
          {error}
        </div>
      )}

      {/* Terminal output */}
      {hasOutput && showOutput && (
        <div style={{
          padding: '10px 16px',
          background: colors.bg,
          maxHeight: 160,
          overflowY: 'auto',
        }}>
          <div style={{
            fontFamily: "'Geist Mono', monospace",
            fontSize: 12, color: colors.text,
            lineHeight: 1.6, whiteSpace: 'pre-wrap',
          }}>
            {output.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      )}

      {/* Probability bars */}
      {hasResults && !showOutput && (
        <div style={{ padding: '10px 16px' }}>
          <ProbabilityBars probabilities={result.probabilities} accent={colors.accent} colors={colors} />
        </div>
      )}

      {/* Exploration prompt */}
      {explorationPrompt && (
        <div style={{
          padding: '10px 16px 14px',
          borderTop: `1px solid ${colors.border}`,
        }}>
          <p style={{
            color: colors.textMuted, fontSize: 13, fontStyle: 'italic',
            fontFamily: "'Geist Sans', sans-serif", lineHeight: 1.5, margin: 0,
          }}>
            {explorationPrompt}
          </p>
        </div>
      )}
    </div>
  );
}
