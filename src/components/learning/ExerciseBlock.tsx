import { useState, useRef, useCallback, useEffect } from 'react';
import { LessonCodeEditor } from './LessonCodeEditor';
import { useLearnStore } from '../../stores/learnStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import type { Framework, SimulationResult, KernelResponse } from '../../types/quantum';
import { Lightbulb, CheckCircle, XCircle, HelpCircle, Terminal } from 'lucide-react';
import { hasExpectedDistribution, isQuantumCode, shouldAutoGrade, validateExerciseResult } from './exerciseValidation';
import { UnsupportedNotice } from './UnsupportedNotice';
import { OutcomeResults } from './OutcomeResults';
import { DESKTOP_KERNEL_UNAVAILABLE, useLessonKernel } from './useLessonKernel';
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
  tolerancePercent: number;
  hints: string[];
  successMessage: string;
}

export function ExerciseBlock({
  id, title, description, starterCode,
  expectedProbabilities, expectedMeasurements, tolerancePercent, hints, successMessage,
}: ExerciseBlockProps) {
  const lessonId = useLearnStore((s) => s.currentLessonId);
  const passExercise = useLearnStore((s) => s.passExercise);
  const addHintUsed = useLearnStore((s) => s.addHintUsed);
  const lessonProgress = useLearnStore((s) => s.lessonProgress);
  const openDirac = useDiracPanelStore((s) => s.open);

  const isPassed = lessonId ? lessonProgress[lessonId]?.exercisesPassed?.includes(id) ?? false : false;

  const [localCode, setLocalCode] = useState(starterCode);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [hintsRevealed, setHintsRevealed] = useState(0);
  const [showDiracPrompt, setShowDiracPrompt] = useState(false);

  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeRef = useRef(starterCode);
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
          // An untouched starter is shown, not graded; Check Solution grades it.
          if (shouldAutoGrade(codeRef.current, starterCode)) checkSolution(msg.data);
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
      // Output from the live preview re-running half-typed code is not a run.
      if (msg.phase === 'parse') return;
      setOutput((prev) => [...prev, msg.text]);
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
  }, [checkSolution, completeExercise, hasExpectations, starterCode, successMessage]);

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

  const handleCodeChange = (value: string | undefined) => {
    codeRef.current = value ?? '';
    setLocalCode(value ?? '');
    setUnsupported(null);
    resetInactivity();
  };

  const handleRun = () => {
    setIsRunning(true);
    setError(null);
    setUnsupported(null);
    setFeedback(null);
    setOutput([]);
    setResult(null);

    // Learning content is Python-only today, so the language is fixed.
    const message = isQuantumCode(localCode)
      ? { type: 'execute' as const, code: localCode, shots: 1024, language: 'python' as const }
      : { type: 'run_python' as const, code: localCode };

    kernelSend(message).then(
      (sent) => {
        if (!sent) {
          setError(DESKTOP_KERNEL_UNAVAILABLE);
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
        <LessonRunButton isRunning={isRunning} pythonLoading={kernel.loading} stage={kernel.stage} onRun={handleRun} />
        {result && hasExpectations && (
          <Button onClick={() => checkSolution(result)} icon={<CheckCircle size={12} aria-hidden="true" />}>Check Solution</Button>
        )}
        {feedback?.success && !hasExpectations && (
          <span className="exercise__ok"><CheckCircle size={12} aria-hidden="true" /> Code ran successfully. Explore the output above.</span>
        )}
        <span className="demo__spacer" />
        {hintsRevealed < hints.length && (
          <Button onClick={revealHint} icon={<Lightbulb size={12} aria-hidden="true" />}>
            Show Hint ({hintsRevealed}/{hints.length})
          </Button>
        )}
      </div>

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
