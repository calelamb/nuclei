import { useState, useRef, useCallback, useEffect } from 'react';
import { LessonCodeEditor } from './LessonCodeEditor';
import { useLearnStore } from '../../stores/learnStore';
import { useEditorStore } from '../../stores/editorStore';
import { usePlatform } from '../../platform/PlatformProvider';
import { KERNEL_WS_URL } from '../../config/kernel';
import { openAuthenticatedKernelSocket } from '../../services/kernelSocket';
import type { Framework, CircuitSnapshot, SimulationResult, KernelResponse } from '../../types/quantum';
import { Play, RotateCcw, ExternalLink, Terminal, BarChart3 } from 'lucide-react';
import { Button, SegmentedControl, type SegmentedOption } from '../ui';
import { isQuantumCode } from './exerciseValidation';
import { UnsupportedNotice } from './UnsupportedNotice';
import { OutcomeResults } from './OutcomeResults';
import { formatCircuitMeta } from './outcomeDistribution';
import './demo.css';

type ResultView = 'output' | 'probabilities';
interface InteractiveDemoProps {
  code: string;
  framework: Framework;
  description: string;
  explorationPrompt?: string;
}

export function InteractiveDemo({ code: initialCode, framework, description, explorationPrompt }: InteractiveDemoProps) {
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
  const [unsupported, setUnsupported] = useState<string | null>(null);
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
      case 'python_result':
        setResult(null);
        setIsRunning(false);
        setError(null);
        break;
      case 'output':
        // Output from the live preview re-running half-typed code is not a run.
        if (msg.phase === 'parse') break;
        setOutput((prev) => [...prev, msg.text]);
        setShowOutput(true);
        break;
      case 'error':
        if (msg.code === 'unsupported_framework') {
          // Outside the browser Qiskit subset: a calm notice, not a red error.
          setUnsupported(msg.message);
          setError(null);
          setIsRunning(false);
          break;
        }
        // While typing, errors from the live preview wait until the student runs.
        if (msg.phase === 'parse') break;
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
        k.init().then(
          () => { pyodideRef.current = k; },
          (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
        );
      });
      return;
    }

    let ws: WebSocket | null = null;
    let cancelled = false;
    let retries = 0;
    const maxRetries = 3;

    function connect() {
      void openAuthenticatedKernelSocket(
        KERNEL_WS_URL,
        platform.getKernelAuthToken?.bind(platform),
      ).then((socket) => {
        if (cancelled) { socket.close(); return; }
        ws = socket;
        attach(socket);
      });
    }
    function attach(ws: WebSocket) {
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
    return () => { cancelled = true; ws?.close(); };
  }, [handleMessage, isWeb, platform]);

  const sendParse = useCallback((c: string) => {
    if (!isQuantumCode(c)) {
      setSnapshot(null);
      return;
    }
    // Learning content is Python-only today, so the language is fixed.
    if (isWeb && pyodideRef.current) {
      pyodideRef.current.send({ type: 'parse', code: c, language: 'python' });
    } else if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'parse', code: c, language: 'python' }));
    }
  }, [isWeb]);

  const handleRun = () => {
    setIsRunning(true);
    setError(null);
    setUnsupported(null);
    setOutput([]);
    setResult(null);

    // Learning content is Python-only today, so the language is fixed.
    const message = isQuantumCode(localCode)
      ? { type: 'execute' as const, code: localCode, shots: 1024, language: 'python' as const }
      : { type: 'run_python' as const, code: localCode };

    if (!isQuantumCode(localCode)) {
      setSnapshot(null);
    }

    if (isWeb && pyodideRef.current) {
      pyodideRef.current.send(message);
    } else if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
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
    if (isQuantumCode(localCode)) {
      setEditorFramework(framework);
    }
    exitLearnMode();
  };

  const handleCodeChange = (value: string | undefined) => {
    const v = value ?? '';
    setLocalCode(v);
    setUnsupported(null);
    sendParse(v);
  };

  useEffect(() => {
    const timer = setTimeout(() => sendParse(localCode), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasResults = Boolean(result && Object.keys(result.probabilities).length > 0);
  const hasOutput = output.length > 0;
  const hasCircuit = Boolean(snapshot && snapshot.gates.length > 0);
  const hasBelow = hasResults || hasOutput || Boolean(error) || hasCircuit;
  const viewOptions: ReadonlyArray<SegmentedOption<ResultView>> = [
    ...(hasOutput ? [{ value: 'output' as const, label: 'Output', icon: <Terminal size={12} aria-hidden="true" /> }] : []),
    ...(hasResults ? [{ value: 'probabilities' as const, label: 'Probabilities', icon: <BarChart3 size={12} aria-hidden="true" /> }] : []),
  ];

  return (
    <div className="demo">
      <div className="demo__head">
        <span className="demo__dot" aria-hidden="true" />
        <span className="demo__kicker">Interactive Demo</span>
        <span className="demo__desc">{description}</span>
      </div>

      <div className="demo__editor">
        <LessonCodeEditor value={localCode} onChange={handleCodeChange} />
      </div>

      <div className={hasBelow ? 'demo__actions demo__actions--divided' : 'demo__actions'}>
        <Button variant="primary" onClick={handleRun} loading={isRunning} icon={<Play size={12} fill="currentColor" aria-hidden="true" />}>
          {isRunning ? 'Running...' : 'Run'}
        </Button>
        <Button onClick={handleReset} icon={<RotateCcw size={12} aria-hidden="true" />}>Reset</Button>

        {viewOptions.length > 1 && (
          <>
            <span className="demo__sep" aria-hidden="true" />
            <SegmentedControl
              aria-label="Result view"
              value={showOutput ? 'output' : 'probabilities'}
              options={viewOptions}
              onChange={(next) => setShowOutput(next === 'output')}
            />
          </>
        )}

        <span className="demo__spacer" />
        <Button onClick={handleOpenInEditor} icon={<ExternalLink size={12} aria-hidden="true" />}>Open in Editor</Button>
      </div>

      {snapshot && hasCircuit && (
        <div className={hasResults || hasOutput || error ? 'demo__summary demo__summary--divided' : 'demo__summary'}>
          <span className="demo__summary-label">{formatCircuitMeta(snapshot.qubit_count, snapshot.depth)}</span>
          <span className="demo__gates">
            {snapshot.gates.map((g, i) => <span key={i} className="demo__gate">{g.type}</span>)}
          </span>
        </div>
      )}

      {unsupported && (
        <div className="demo__notice"><UnsupportedNotice message={unsupported} /></div>
      )}

      {error && <div className="demo__error" role="alert">{error}</div>}

      {hasOutput && (showOutput || !hasResults) && (
        <div className="demo__output" aria-label="Output">
          {output.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}

      {result && hasResults && !(showOutput && hasOutput) && (
        <div className="demo__results">
          <OutcomeResults result={result} />
        </div>
      )}

      {explorationPrompt && <p className="demo__prompt">{explorationPrompt}</p>}
    </div>
  );
}
