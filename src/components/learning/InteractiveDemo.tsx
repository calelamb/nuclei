import { useState, useRef, useCallback, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts';
import { useThemeStore } from '../../stores/themeStore';
import { useLearnStore } from '../../stores/learnStore';
import { useEditorStore } from '../../stores/editorStore';
import { usePlatform } from '../../platform/PlatformProvider';
import type { Framework, CircuitSnapshot, SimulationResult, KernelResponse } from '../../types/quantum';
import { Play, RotateCcw, ExternalLink } from 'lucide-react';

interface InteractiveDemoProps {
  code: string;
  framework: Framework;
  description: string;
  explorationPrompt?: string;
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
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
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
      case 'error':
        setError(msg.message);
        setIsRunning(false);
        break;
    }
  }, []);

  // Connect to kernel
  useEffect(() => {
    if (isWeb) {
      import('../../platform/pyodideKernel').then(({ PyodideKernel }) => {
        const k = new PyodideKernel((msg) => handleMessage(msg as KernelResponse));
        k.init().then(() => { pyodideRef.current = k; });
      });
      return;
    }
    const ws = new WebSocket('ws://localhost:9742');
    ws.onopen = () => { wsRef.current = ws; };
    ws.onmessage = (ev) => {
      try { handleMessage(JSON.parse(ev.data)); } catch { /* noop */ }
    };
    ws.onclose = () => { wsRef.current = null; };
    ws.onerror = () => ws.close();
    return () => { ws.close(); };
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
    if (isWeb && pyodideRef.current) {
      pyodideRef.current.send({ type: 'execute', code: localCode, shots: 1024 });
    } else if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'execute', code: localCode, shots: 1024 }));
    } else {
      setError('Kernel not connected');
      setIsRunning(false);
    }
  };

  const handleReset = () => {
    setLocalCode(initialCode);
    setResult(null);
    setSnapshot(null);
    setError(null);
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

  // Parse initial code on mount
  useEffect(() => {
    const timer = setTimeout(() => sendParse(localCode), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const histData = result
    ? Object.entries(result.probabilities)
        .map(([state, prob]) => ({ state: `|${state}⟩`, probability: prob }))
        .sort((a, b) => a.state.localeCompare(b.state))
    : null;

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
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: colors.accent,
        }} />
        <span style={{
          color: colors.textMuted,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "'Geist Sans', sans-serif",
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          Interactive Demo
        </span>
        <span style={{
          color: colors.textDim,
          fontSize: 12,
          fontFamily: "'Geist Sans', sans-serif",
          marginLeft: 4,
        }}>
          {description}
        </span>
      </div>

      {/* Mini Editor */}
      <div style={{ height: 200, borderBottom: `1px solid ${colors.border}` }}>
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

      {/* Buttons */}
      <div style={{
        padding: '8px 16px',
        display: 'flex',
        gap: 8,
        borderBottom: `1px solid ${colors.border}`,
      }}>
        <button onClick={handleRun} disabled={isRunning} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 14px',
          background: isRunning ? colors.bgPanel : colors.accent,
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "'Geist Sans', sans-serif",
          cursor: isRunning ? 'default' : 'pointer',
          boxShadow: isRunning ? 'none' : shadow.sm,
        }}>
          <Play size={12} fill="currentColor" />
          {isRunning ? 'Running...' : 'Run'}
        </button>
        <button onClick={handleReset} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 14px',
          background: 'transparent',
          color: colors.textMuted,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          fontSize: 12,
          fontFamily: "'Geist Sans', sans-serif",
          cursor: 'pointer',
        }}>
          <RotateCcw size={12} /> Reset
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={handleOpenInEditor} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 14px',
          background: 'transparent',
          color: colors.textMuted,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          fontSize: 12,
          fontFamily: "'Geist Sans', sans-serif",
          cursor: 'pointer',
        }}>
          <ExternalLink size={12} /> Open in Editor
        </button>
      </div>

      {/* Mini Circuit */}
      {snapshot && snapshot.gates.length > 0 && (
        <div style={{
          padding: '8px 16px',
          borderBottom: `1px solid ${colors.border}`,
          fontSize: 11,
          fontFamily: "'Geist Mono', monospace",
          color: colors.textMuted,
        }}>
          <span style={{ color: colors.textDim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Circuit: {snapshot.qubit_count}q, depth {snapshot.depth}
          </span>
          <span style={{ marginLeft: 12 }}>
            {snapshot.gates.map((g, i) => (
              <span key={i} style={{ color: colors.accent, marginRight: 6 }}>
                {g.type}{g.targets.length > 0 ? `(${g.targets.join(',')})` : ''}
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
        }}>
          {error}
        </div>
      )}

      {/* Mini Histogram */}
      {histData && (
        <div style={{ height: 120, padding: '8px 16px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={histData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <XAxis
                dataKey="state"
                tick={{ fill: colors.textMuted, fontSize: 10, fontFamily: "'Geist Mono', monospace" }}
                axisLine={{ stroke: colors.border }}
                tickLine={false}
              />
              <YAxis
                domain={[0, 1]}
                tick={{ fill: colors.textDim, fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                width={28}
                tickFormatter={(v: number) => v.toFixed(1)}
              />
              <Bar dataKey="probability" radius={[3, 3, 0, 0]}>
                {histData.map((_, i) => (
                  <Cell key={i} fill={colors.accent} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Exploration prompt */}
      {explorationPrompt && (
        <div style={{
          padding: '10px 16px 14px',
          borderTop: `1px solid ${colors.border}`,
        }}>
          <p style={{
            color: colors.textMuted,
            fontSize: 13,
            fontStyle: 'italic',
            fontFamily: "'Geist Sans', sans-serif",
            lineHeight: 1.5,
            margin: 0,
          }}>
            {explorationPrompt}
          </p>
        </div>
      )}
    </div>
  );
}
