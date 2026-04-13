import { useState, useRef, useCallback, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { useThemeStore } from '../../stores/themeStore';
import { useLearnStore } from '../../stores/learnStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { usePlatform } from '../../platform/PlatformProvider';
import { KERNEL_WS_URL } from '../../config/kernel';
import type { Framework, SimulationResult, KernelResponse } from '../../types/quantum';
import { Play, Lightbulb, CheckCircle, XCircle, HelpCircle, Terminal } from 'lucide-react';
import { hasExpectedDistribution, isQuantumCode, validateExerciseResult } from './exerciseValidation';

interface ExerciseBlockProps {
  id: string;
  title: string;
  description: string;
  starterCode: string;
  framework: Framework;
  expectedProbabilities?: Record<string, number>;
  expectedMeasurements?: Record<string, number>;
  tolerancePercent: number;
  hints: string[];
  successMessage: string;
}

export function ExerciseBlock({
  id, title, description, starterCode,
  expectedProbabilities, expectedMeasurements, tolerancePercent, hints, successMessage,
}: ExerciseBlockProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const lessonId = useLearnStore((s) => s.currentLessonId);
  const passExercise = useLearnStore((s) => s.passExercise);
  const addHintUsed = useLearnStore((s) => s.addHintUsed);
  const lessonProgress = useLearnStore((s) => s.lessonProgress);
  const openDirac = useDiracPanelStore((s) => s.open);
  const platform = usePlatform();
  const isWeb = platform.getPlatform() === 'web';

  const isPassed = lessonId ? lessonProgress[lessonId]?.exercisesPassed?.includes(id) ?? false : false;

  const [localCode, setLocalCode] = useState(starterCode);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [hintsRevealed, setHintsRevealed] = useState(0);
  const [showDiracPrompt, setShowDiracPrompt] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pyodideRef = useRef<any>(null);
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasExpectations = hasExpectedDistribution(expectedProbabilities)
    || hasExpectedDistribution(expectedMeasurements);

  const completeExercise = useCallback((message: string) => {
    setFeedback({ success: true, message });
    if (lessonId) {
      passExercise(lessonId, id);
    }
  }, [id, lessonId, passExercise]);

  const checkSolution = useCallback((nextResult: SimulationResult) => {
    const validation = validateExerciseResult(nextResult, {
      expectedProbabilities,
      expectedMeasurements,
      tolerancePercent,
    });

    if (!validation) {
      completeExercise(successMessage);
      return;
    }

    if (validation.success) {
      completeExercise(successMessage);
    } else {
      setFeedback({ success: false, message: validation.message });
    }
  }, [
    completeExercise,
    expectedMeasurements,
    expectedProbabilities,
    successMessage,
    tolerancePercent,
  ]);

  const handleMessage = useCallback((msg: KernelResponse) => {
    if (msg.type === 'result') {
      setResult(msg.data);
      setIsRunning(false);
      setError(null);
      if (msg.data) {
        if (hasExpectations) {
          checkSolution(msg.data);
        } else {
          completeExercise(successMessage);
        }
      }
    } else if (msg.type === 'python_result') {
      setResult(null);
      setIsRunning(false);
      if (msg.success) {
        setError(null);
        if (!hasExpectations) {
          completeExercise(successMessage);
        }
      }
    } else if (msg.type === 'output') {
      setOutput((prev) => [...prev, msg.text]);
    } else if (msg.type === 'error') {
      setError(msg.message);
      setIsRunning(false);
    }
  }, [checkSolution, completeExercise, hasExpectations, successMessage]);

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
    function connect() {
      ws = new WebSocket(KERNEL_WS_URL);
      ws.onopen = () => { wsRef.current = ws; retries = 0; };
      ws.onmessage = (ev) => {
        try { handleMessage(JSON.parse(ev.data)); } catch { /* noop */ }
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (retries < 3) { retries++; setTimeout(connect, 1000 * retries); }
      };
      ws.onerror = () => ws?.close();
    }
    connect();
    return () => { ws?.close(); };
  }, [handleMessage, isWeb]);

  // Inactivity timer for "Need help?" prompt
  const resetInactivity = useCallback(() => {
    setShowDiracPrompt(false);
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    if (!isPassed) {
      inactivityRef.current = setTimeout(() => setShowDiracPrompt(true), 120_000);
    }
  }, [isPassed]);

  useEffect(() => {
    resetInactivity();
    return () => { if (inactivityRef.current) clearTimeout(inactivityRef.current); };
  }, [resetInactivity]);

  const handleCodeChange = (value: string | undefined) => {
    setLocalCode(value ?? '');
    resetInactivity();
  };

  const handleRun = () => {
    setIsRunning(true);
    setError(null);
    setFeedback(null);
    setOutput([]);
    setResult(null);

    const message = isQuantumCode(localCode)
      ? { type: 'execute' as const, code: localCode, shots: 1024 }
      : { type: 'run_python' as const, code: localCode };

    if (isWeb && pyodideRef.current) {
      pyodideRef.current.send(message);
    } else if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      setError('Kernel not connected');
      setIsRunning(false);
    }
  };

  const revealHint = () => {
    if (hintsRevealed < hints.length) {
      setHintsRevealed((h) => h + 1);
      if (lessonId) addHintUsed(lessonId);
    }
  };

  const probEntries = result
    ? Object.entries(result.probabilities)
        .filter(([, p]) => p > 0.001)
        .sort(([, a], [, b]) => b - a)
    : [];

  return (
    <div style={{
      margin: '16px 0',
      borderRadius: 12,
      overflow: 'hidden',
      background: colors.bgElevated,
      border: `1px solid ${isPassed ? colors.success : feedback?.success === false ? colors.error : colors.border}`,
      boxShadow: shadow.sm,
      transition: 'border-color 300ms ease',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: isPassed ? colors.success : colors.warning,
        }} />
        <span style={{
          color: colors.textMuted,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "'Geist Sans', sans-serif",
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          Exercise
        </span>
        {isPassed && <CheckCircle size={14} color={colors.success} />}
      </div>

      {/* Title + description */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.border}` }}>
        <div style={{
          color: colors.text,
          fontSize: 16,
          fontWeight: 600,
          fontFamily: "'Geist Sans', sans-serif",
          marginBottom: 6,
        }}>
          {title}
        </div>
        <div style={{
          color: colors.textMuted,
          fontSize: 14,
          fontFamily: "'Geist Sans', sans-serif",
          lineHeight: 1.5,
        }}>
          {description}
        </div>
      </div>

      {/* Mini Editor */}
      <div style={{ height: 220, borderBottom: `1px solid ${colors.border}` }}>
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
        alignItems: 'center',
        borderBottom: `1px solid ${colors.border}`,
      }}>
        <button onClick={handleRun} disabled={isRunning} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 14px',
          background: isRunning ? colors.bgPanel : colors.accent,
          color: '#fff', border: 'none', borderRadius: 6,
          fontSize: 12, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif",
          cursor: isRunning ? 'default' : 'pointer',
        }}>
          <Play size={12} fill="currentColor" />
          {isRunning ? 'Running...' : 'Run'}
        </button>
        {result && hasExpectations && (
          <button onClick={() => checkSolution(result)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px',
            background: colors.success,
            color: '#fff', border: 'none', borderRadius: 6,
            fontSize: 12, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif",
            cursor: 'pointer',
          }}>
            <CheckCircle size={12} />
            Check Solution
          </button>
        )}
        {feedback?.success && !hasExpectations && (
          <span style={{
            color: colors.success, fontSize: 11, fontFamily: "'Geist Sans', sans-serif",
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <CheckCircle size={11} />
            Code ran successfully — explore the output above
          </span>
        )}
        <div style={{ flex: 1 }} />
        {hintsRevealed < hints.length && (
          <button onClick={revealHint} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px',
            background: 'transparent', color: colors.warning,
            border: `1px solid ${colors.warning}40`, borderRadius: 6,
            fontSize: 12, fontFamily: "'Geist Sans', sans-serif",
            cursor: 'pointer',
          }}>
            <Lightbulb size={12} />
            Show Hint ({hintsRevealed}/{hints.length})
          </button>
        )}
      </div>

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

      {/* Hints */}
      {hintsRevealed > 0 && (
        <div style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          {hints.slice(0, hintsRevealed).map((hint, i) => (
            <div key={i} style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              color: colors.warning, fontSize: 13,
              fontFamily: "'Geist Sans', sans-serif",
            }}>
              <Lightbulb size={14} style={{ marginTop: 2, flexShrink: 0 }} />
              <span style={{ color: colors.textMuted }}>{hint}</span>
            </div>
          ))}
        </div>
      )}

      {/* Terminal output */}
      {output.length > 0 && (
        <div style={{
          padding: '8px 16px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bg,
          maxHeight: 120, overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <Terminal size={10} color={colors.textDim} />
            <span style={{ color: colors.textDim, fontSize: 10, fontFamily: "'Geist Sans', sans-serif", textTransform: 'uppercase', letterSpacing: 0.5 }}>Output</span>
          </div>
          <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 12, color: colors.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {output.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </div>
      )}

      {/* Compact probability bars */}
      {probEntries.length > 0 && (
        <div style={{ padding: '8px 16px', borderBottom: `1px solid ${colors.border}` }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {probEntries.map(([state, prob]) => (
              <div key={state} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 48, textAlign: 'right', fontFamily: "'Geist Mono', monospace", fontSize: 12, color: colors.text, fontWeight: 500 }}>
                  |{state}{'\u27E9'}
                </span>
                <div style={{ flex: 1, height: 16, borderRadius: 3, background: colors.bgPanel, overflow: 'hidden' }}>
                  <div style={{
                    width: `${prob * 100}%`, height: '100%',
                    background: `linear-gradient(90deg, ${colors.accent}cc, ${colors.accent}88)`,
                    borderRadius: 3, transition: 'width 400ms ease-out',
                    minWidth: prob > 0 ? 2 : 0,
                  }} />
                </div>
                <span style={{ width: 42, textAlign: 'right', fontFamily: "'Geist Mono', monospace", fontSize: 11, color: colors.textMuted }}>
                  {(prob * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div style={{
          padding: '12px 16px',
          background: feedback.success ? `${colors.success}10` : `${colors.error}10`,
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}>
          {feedback.success
            ? <CheckCircle size={18} color={colors.success} style={{ flexShrink: 0, marginTop: 1 }} />
            : <XCircle size={18} color={colors.error} style={{ flexShrink: 0, marginTop: 1 }} />
          }
          <span style={{
            color: feedback.success ? colors.success : colors.error,
            fontSize: 14,
            fontFamily: "'Geist Sans', sans-serif",
            lineHeight: 1.5,
          }}>
            {feedback.message}
          </span>
        </div>
      )}

      {/* Dirac help prompt */}
      {showDiracPrompt && !isPassed && (
        <div style={{
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <HelpCircle size={14} color={colors.dirac} />
          <span style={{
            color: colors.textMuted, fontSize: 13,
            fontFamily: "'Geist Sans', sans-serif",
          }}>
            Need help?
          </span>
          <button onClick={openDirac} style={{
            background: `${colors.dirac}18`,
            border: `1px solid ${colors.dirac}40`,
            borderRadius: 4,
            color: colors.dirac,
            fontSize: 12,
            padding: '3px 10px',
            cursor: 'pointer',
            fontFamily: "'Geist Sans', sans-serif",
          }}>
            Ask Dirac
          </button>
        </div>
      )}
    </div>
  );
}
