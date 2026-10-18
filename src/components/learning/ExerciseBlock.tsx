import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { LessonCodeEditor } from './LessonCodeEditor';
import { useLearnStore } from '../../stores/learnStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import type { Framework, SimulationResult, KernelResponse } from '../../types/quantum';
import { Lightbulb, CheckCircle, XCircle, HelpCircle, Terminal, RotateCcw } from 'lucide-react';
import { hasAnyExpectation, hasExpectedDistribution, isQuantumCode, shouldAutoGrade, validateExerciseRun } from './exerciseValidation';
import { UnsupportedNotice } from './UnsupportedNotice';
import { OutcomeResults } from './OutcomeResults';
import { useLessonKernel } from './useLessonKernel';
import { LessonRunButton } from './LessonRunButton';
import { Button } from '../ui';
import '../dirac/dirac.css';
import './demo.css';

interface ExerciseBlockProps {
  id: string;
  title: string;
  description: string;
  starterCode: string;
  framework: Framework;
  expectedProbabilities?: Record<string, number>;
  expectedMeasurements?: Record<string, number>;
  expectedOutput?: string[];
  requiredCode?: string[];
  tolerancePercent: number;
  hints: string[];
  successMessage: string;
}

const DRAFT_DEBOUNCE_MS = 300;

function initialCode(lessonId: string | null, exerciseId: string, starterCode: string): string {
  if (!lessonId) return starterCode;
  return useLearnStore.getState().lessonProgress[lessonId]?.drafts?.[exerciseId] ?? starterCode;
}

export function ExerciseBlock({
  id, title, description, starterCode,
  expectedProbabilities, expectedMeasurements, expectedOutput, requiredCode, tolerancePercent, hints, successMessage,
}: ExerciseBlockProps) {
  const lessonId = useLearnStore((s) => s.currentLessonId);
  const passExercise = useLearnStore((s) => s.passExercise);
  const addHintUsed = useLearnStore((s) => s.addHintUsed);
  const setExerciseDraft = useLearnStore((s) => s.setExerciseDraft);
  const clearExerciseDraft = useLearnStore((s) => s.clearExerciseDraft);
  const lessonProgress = useLearnStore((s) => s.lessonProgress);
  const openDirac = useDiracPanelStore((s) => s.open);

  const isPassed = lessonId ? lessonProgress[lessonId]?.exercisesPassed?.includes(id) ?? false : false;

  const [localCode, setLocalCode] = useState(() => initialCode(lessonId, id, starterCode));
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [hintsRevealed, setHintsRevealed] = useState(0);
  const [showDiracPrompt, setShowDiracPrompt] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeRef = useRef(localCode);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTargetRef = useRef({ lessonId, id });
  draftTargetRef.current = { lessonId, id };
  const runTokenRef = useRef(0);
  const outputRef = useRef<string[]>([]);
  const resultRef = useRef<SimulationResult | null>(null);
  const expectations = useMemo(
    () => ({ expectedProbabilities, expectedMeasurements, expectedOutput, requiredCode }),
    [expectedProbabilities, expectedMeasurements, expectedOutput, requiredCode],
  );
  const hasExpectations = hasAnyExpectation(expectations);
  const wantsDistribution = hasExpectedDistribution(expectedProbabilities)
    || hasExpectedDistribution(expectedMeasurements);

  const completeExercise = useCallback((message: string) => {
    setFeedback({ success: true, message });
    if (lessonId) {
      passExercise(lessonId, id);
    }
  }, [id, lessonId, passExercise]);

  // Grades the latest finished run: stdout, the simulation result and the code.
  const checkSolution = useCallback(() => {
    const validation = validateExerciseRun(
      {
        result: resultRef.current,
        output: outputRef.current,
        code: codeRef.current,
        starterCode,
        tolerancePercent,
      },
      expectations,
    );
    if (validation.success) {
      completeExercise(successMessage);
    } else {
      setFeedback({ success: false, message: validation.message });
    }
  }, [completeExercise, expectations, starterCode, successMessage, tolerancePercent]);

  // A plain Run only grades once the learner has changed the starter; Check solution always grades.
  const finishRun = useCallback((gradable: boolean) => {
    setHasRun(true);
    if (gradable && hasExpectations && shouldAutoGrade(codeRef.current, starterCode)) checkSolution();
  }, [checkSolution, hasExpectations, starterCode]);

  const handleMessage = useCallback((msg: KernelResponse) => {
    if (msg.type === 'result') {
      setResult(msg.data);
      setIsRunning(false);
      setError(null);
      resultRef.current = msg.data ?? null;
      if (msg.data) finishRun(true);
    } else if (msg.type === 'python_result') {
      setResult(null);
      setIsRunning(false);
      resultRef.current = null;
      if (msg.success) {
        setError(null);
        // A distribution exercise needs a circuit result; a bare script cannot satisfy it.
        finishRun(!wantsDistribution);
      }
    } else if (msg.type === 'output') {
      // Output from the live preview re-running half-typed code is not a run.
      if (msg.phase === 'parse') return;
      outputRef.current = [...outputRef.current, msg.text];
      setOutput(outputRef.current);
    } else if (msg.type === 'error') {
      if (msg.code === 'unsupported_framework') {
        setUnsupported(msg.message);
        setError(null);
        setIsRunning(false);
        return;
      }
      if (msg.phase === 'parse') return;
      setError(msg.message);
      setIsRunning(false);
    }
  }, [finishRun, wantsDistribution]);

  const kernel = useLessonKernel({
    onMessage: handleMessage,
    onInitError: (message) => { setError(message); setIsRunning(false); },
  });
  const { send: kernelSend } = kernel;

  // Inactivity timer for "Need help?" prompt
  const armInactivityTimer = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    if (!isPassed) {
      inactivityRef.current = setTimeout(() => setShowDiracPrompt(true), 120_000);
    }
  }, [isPassed]);
  const resetInactivity = useCallback(() => {
    setShowDiracPrompt(false);
    armInactivityTimer();
  }, [armInactivityTimer]);

  useEffect(() => {
    armInactivityTimer();
    return () => { if (inactivityRef.current) clearTimeout(inactivityRef.current); };
  }, [armInactivityTimer]);

  // Persists the draft so it survives the lesson unmounting (Glossary, Next/Prev, Explorer).
  const flushDraft = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = null;
    const target = draftTargetRef.current;
    if (!target.lessonId) return;
    if (codeRef.current === starterCode) clearExerciseDraft(target.lessonId, target.id);
    else setExerciseDraft(target.lessonId, target.id, codeRef.current);
  }, [clearExerciseDraft, setExerciseDraft, starterCode]);

  useEffect(() => {
    const pending = draftTimerRef;
    return () => { if (pending.current) flushDraft(); };
  }, [flushDraft]);

  const handleCodeChange = (value: string | undefined) => {
    codeRef.current = value ?? '';
    setLocalCode(value ?? '');
    setFeedback(null);
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(flushDraft, DRAFT_DEBOUNCE_MS);
    setUnsupported(null);
    // The last run no longer reflects this code, so it cannot be graded until the learner runs again.
    setHasRun(false);
    resetInactivity();
  };

  const handleReset = () => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = null;
    codeRef.current = starterCode;
    setLocalCode(starterCode);
    if (lessonId) clearExerciseDraft(lessonId, id);
    outputRef.current = [];
    resultRef.current = null;
    setOutput([]);
    setResult(null);
    setError(null);
    setUnsupported(null);
    setFeedback(null);
    setHasRun(false);
    resetInactivity();
  };

  const handleCancelQueued = () => {
    runTokenRef.current += 1;
    setIsRunning(false);
  };

  const handleRun = () => {
    const token = ++runTokenRef.current;
    setIsRunning(true);
    setError(null);
    setUnsupported(null);
    setFeedback(null);
    outputRef.current = [];
    resultRef.current = null;
    setOutput([]);
    setResult(null);
    setHasRun(false);

    // Learning content is Python-only today, so the language is fixed.
    const message = isQuantumCode(localCode)
      ? { type: 'execute' as const, code: localCode, shots: 1024, language: 'python' as const }
      : { type: 'run_python' as const, code: localCode };

    kernelSend(message, { isCancelled: () => token !== runTokenRef.current }).then(
      (sent) => {
        if (!sent && token === runTokenRef.current) {
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

  const revealHint = () => {
    if (hintsRevealed < hints.length) {
      setHintsRevealed((h) => h + 1);
      if (lessonId) addHintUsed(lessonId);
    }
  };

  const hasProbabilities = Boolean(result && Object.values(result.probabilities).some((p) => p > 0.001));
  const ranEmpty = hasRun && !isRunning && hasExpectations && !feedback && !error && !unsupported
    && output.length === 0 && !hasProbabilities;
  const state = isPassed ? 'passed' : feedback?.success === false ? 'failed' : 'open';

  return (
    <div className="exercise" data-state={state}>
      <div className="demo__head">
        <span className="exercise__dot" aria-hidden="true" />
        <span className="demo__kicker">Exercise</span>
        {isPassed && <CheckCircle className="exercise__passed" size={14} aria-label="Passed" />}
      </div>

      <div className="exercise__brief">
        <div className="exercise__title">{title}</div>
        <div className="exercise__text">{description}</div>
      </div>

      <div className="demo__editor">
        <LessonCodeEditor value={localCode} onChange={handleCodeChange} />
      </div>

      <div className="demo__actions demo__actions--divided">
        <LessonRunButton isRunning={isRunning} pythonLoading={kernel.loading} progress={kernel.progress} onRun={handleRun} onCancelQueued={handleCancelQueued} />
        {hasRun && hasExpectations && !isRunning && (
          <Button onClick={checkSolution} icon={<CheckCircle size={12} aria-hidden="true" />}>Check solution</Button>
        )}
        {hasRun && !hasExpectations && (
          <span className="exercise__ok"><CheckCircle size={12} aria-hidden="true" /> Ran. Compare {output.length > 0 ? 'the output above' : 'your output'} with the task.</span>
        )}
        <span className="demo__spacer" />
        {localCode !== starterCode && (
          <Button variant="ghost" onClick={handleReset} icon={<RotateCcw size={12} aria-hidden="true" />} title="Restore the starter code">
            Reset
          </Button>
        )}
        {hintsRevealed < hints.length && (
          <Button onClick={revealHint} icon={<Lightbulb size={12} aria-hidden="true" />}>
            Show hint ({hintsRevealed}/{hints.length})
          </Button>
        )}
      </div>

      {ranEmpty && (
        <div className="exercise__idle" role="status">Ran · no output yet. Replace the TODO lines, then Run.</div>
      )}

      {unsupported && <div className="demo__notice"><UnsupportedNotice message={unsupported} /></div>}

      {error && <div className="demo__error" role="alert">{error}</div>}

      {hintsRevealed > 0 && (
        <div className="exercise__hints">
          {hints.slice(0, hintsRevealed).map((hint, i) => (
            <div key={i} className="exercise__hint">
              <Lightbulb size={14} aria-hidden="true" />
              <span>{hint}</span>
            </div>
          ))}
        </div>
      )}

      {output.length > 0 && (
        <div className="exercise__output">
          <div className="exercise__output-label"><Terminal size={12} aria-hidden="true" /> Output</div>
          <div className="exercise__output-lines">{output.map((line, i) => <div key={i}>{line}</div>)}</div>
        </div>
      )}

      {result && hasProbabilities && (
        <div className="exercise__results"><OutcomeResults result={result} /></div>
      )}

      {feedback && (
        <div className={feedback.success ? 'exercise__feedback exercise__feedback--ok' : 'exercise__feedback exercise__feedback--fail'} role="status">
          {feedback.success ? <CheckCircle size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {showDiracPrompt && !isPassed && (
        <div className="exercise__help">
          <HelpCircle size={14} aria-hidden="true" />
          <span>Need help?</span>
          <Button size="sm" className="dirac-btn-dirac" onClick={openDirac}>Ask Dirac</Button>
        </div>
      )}
    </div>
  );
}
