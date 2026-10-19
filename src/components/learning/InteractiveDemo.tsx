import { useState, useRef, useCallback, useEffect } from 'react';
import { LessonCodeEditor } from './LessonCodeEditor';
import { useLearnStore } from '../../stores/learnStore';
import type { Framework, CircuitSnapshot, SimulationResult, KernelResponse } from '../../types/quantum';
import { RotateCcw, ExternalLink, Terminal, BarChart3 } from 'lucide-react';
import { Button, SegmentedControl, useConfirm, type SegmentedOption } from '../ui';
import { loadIntoEditor } from '../editor/loadIntoEditor';
import { isQuantumCode } from './exerciseValidation';
import { UnsupportedNotice } from './UnsupportedNotice';
import { OutcomeResults } from './OutcomeResults';
import { useLessonKernel } from './useLessonKernel';
import { LessonEngineFailed } from './LessonEngineFailed';
import { describeCodeError } from '../../lib/errorLine';
import { LessonRunButton } from './LessonRunButton';
import { StaleResultNotice } from '../layout/StaleResultNotice';
import { formatCircuitMeta } from './outcomeDistribution';
import { focusBlockEditor, focusBlockRun } from './focusBlockEditor';
import './demo.css';

const PYTHON_FAILED_MESSAGE = 'The program did not finish. Check the code and run it again.';

type ResultView = 'output' | 'probabilities';
interface InteractiveDemoProps {
  code: string;
  framework: Framework;
  description: string;
  explorationPrompt?: string;
}

export function InteractiveDemo({ code: initialCode, framework, description, explorationPrompt }: InteractiveDemoProps) {
  const exitLearnMode = useLearnStore((s) => s.exitLearnMode);
  const { confirm, confirmDialog } = useConfirm();

  const [localCode, setLocalCode] = useState(initialCode);
  const [snapshot, setSnapshot] = useState<CircuitSnapshot | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [showOutput, setShowOutput] = useState(false);
  // The code the shown result came from; an edit after a run makes that result stale.
  const [ranCode, setRanCode] = useState<string | null>(null);
  const localCodeRef = useRef(initialCode);
  const blockRef = useRef<HTMLDivElement>(null);
  // Bumped on every Run and on cancel, so a Run queued behind the Python boot can be withdrawn.
  const runTokenRef = useRef(0);
  // A Run the learner asked for that has not been handed to Python yet; the Retry notice re-issues it.
  const wantedRunRef = useRef(false);

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
        // A failed run keeps the error that arrived just before this message, exactly as
        // ExerciseBlock does; only a success clears it.
        setError((prev) => (msg.success ? null : prev ?? PYTHON_FAILED_MESSAGE));
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
        { const described = describeCodeError(msg.message, msg.traceback); setError(described.text); setErrorLine(described.line); }
        setIsRunning(false);
        break;
    }
  }, []);

  const kernel = useLessonKernel({
    onMessage: handleMessage,
    // The failed-start notice (with Retry) owns the explanation; no second error line.
    onInitError: () => { setIsRunning(false); },
    onReady: () => sendParse(localCodeRef.current),
  });
  const { send: kernelSend } = kernel;

  function sendParse(c: string) {
    if (!isQuantumCode(c)) {
      setSnapshot(null);
      return;
    }
    // Learning content is Python-only today, so the language is fixed.
    void kernelSend({ type: 'parse', code: c, language: 'python' });
  }

  const handleCancelQueued = () => {
    wantedRunRef.current = false;
    runTokenRef.current += 1;
    setIsRunning(false);
  };

  const handleRetry = () => {
    // The notice unmounts as the engine restarts: put focus on Run first so it never drops to <body>.
    focusBlockRun(blockRef.current);
    if (wantedRunRef.current) handleRun();
    else kernel.retry();
  };

  const handleRun = () => {
    // A failed start stays failed until the explicit Retry; Run is that Retry.
    if (kernel.failed) kernel.retry();
    wantedRunRef.current = true;
    const token = ++runTokenRef.current;
    setIsRunning(true);
    setError(null);
    setUnsupported(null);
    setOutput([]);
    setResult(null);
    setRanCode(localCode);

    // Learning content is Python-only today, so the language is fixed.
    const message = isQuantumCode(localCode)
      ? { type: 'execute' as const, code: localCode, shots: 1024, language: 'python' as const }
      : { type: 'run_python' as const, code: localCode };

    if (!isQuantumCode(localCode)) {
      setSnapshot(null);
    }

    kernelSend(message, { isCancelled: () => runTokenRef.current !== token }).then(
      (sent) => {
        if (sent) wantedRunRef.current = false;
        if (!sent) {
          setError(kernel.unavailableMessage());
          setIsRunning(false);
        }
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setIsRunning(false);
      },
    );
  };

  const handleReset = () => {
    // Restores the code only: the last result stays, marked stale, until the next run.
    // Focus moves into the editor first: Reset disables itself once the code matches the original.
    focusBlockEditor(blockRef.current);
    localCodeRef.current = initialCode;
    setLocalCode(initialCode);
    setError(null);
    sendParse(initialCode);
  };

  const handleOpenInEditor = async () => {
    const outcome = await loadIntoEditor(localCode, {
      label: 'demo code',
      confirm,
      framework: isQuantumCode(localCode) ? framework : undefined,
    });
    if (outcome !== 'cancelled') exitLearnMode();
  };

  const handleCodeChange = (value: string | undefined) => {
    setErrorLine(null);
    const v = value ?? '';
    localCodeRef.current = v;
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
  const isStale = ranCode !== null && ranCode !== localCode && (hasResults || hasOutput);
  const hasBelow = hasResults || hasOutput || Boolean(error) || hasCircuit || kernel.failed;
  const viewOptions: ReadonlyArray<SegmentedOption<ResultView>> = [
    ...(hasOutput ? [{ value: 'output' as const, label: 'Output', icon: <Terminal size={12} aria-hidden="true" /> }] : []),
    ...(hasResults ? [{ value: 'probabilities' as const, label: 'Probabilities', icon: <BarChart3 size={12} aria-hidden="true" /> }] : []),
  ];

  return (
    <div ref={blockRef} className="demo">
      <div className="demo__head">
        <span className="demo__dot" aria-hidden="true" />
        <span className="demo__kicker">Interactive demo</span>
        <span className="demo__desc">{description}</span>
      </div>

      <div className="demo__editor">
        <LessonCodeEditor value={localCode} onChange={handleCodeChange} errorLine={error ? errorLine : null} errorMessage={error ?? undefined} />
      </div>

      <div className={hasBelow ? 'demo__actions demo__actions--divided' : 'demo__actions'}>
        <LessonRunButton
          isRunning={isRunning}
          pythonLoading={kernel.loading}
          progress={kernel.progress}
          onRun={handleRun}
          onCancelQueued={handleCancelQueued}
        />
        <Button onClick={handleReset} disabled={localCode === initialCode} icon={<RotateCcw size={12} aria-hidden="true" />}>Reset</Button>

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
        <Button onClick={() => { void handleOpenInEditor(); }} icon={<ExternalLink size={12} aria-hidden="true" />}>Open in editor</Button>
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

      {kernel.failed && <LessonEngineFailed detail={kernel.failureDetail} onRetry={handleRetry} />}

      {error && !kernel.failed && <div className="demo__error" role="alert">{error}</div>}

      {isStale && (
        <div className="demo__stale"><StaleResultNotice inline label="From last run · Run again" onActivate={handleRun} /></div>
      )}

      {hasOutput && (showOutput || !hasResults) && (
        <div className="demo__output" aria-label="Output">
          {output.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}

      {result && hasResults && !(showOutput && hasOutput) && (
        <div className="demo__results" data-stale={isStale || undefined}>
          <OutcomeResults result={result} />
        </div>
      )}

      {explorationPrompt && <p className="demo__prompt">{explorationPrompt}</p>}
      {confirmDialog}
    </div>
  );
}
