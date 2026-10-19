import { useCallback, useMemo, useState } from 'react';
import { Check, Loader, Play, SearchCode, X } from 'lucide-react';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import {
  inspectChallengeCase,
  runTestCases,
} from '../../services/challengeExecution';
import { usePlatform } from '../../platform/PlatformProvider';
import {
  aggregateMetrics,
  computeCircuitMetrics,
  computeEfficiency,
} from '../../services/challengeEfficiency';
import { TestCaseRow } from './TestCaseRow';
import { ChallengeInspector } from './ChallengeInspector';
import { PerformancePanel } from './PerformancePanel';
import { UnsupportedNotice } from '../learning/UnsupportedNotice';
import { LessonEngineFailed } from '../learning/LessonEngineFailed';
import { useEditorStore } from '../../stores/editorStore';
import { bootStepLabel } from '../layout/kernelStatusModel';
import { retryKernel } from '../../lib/kernelControl';
import { sharedCodeFailure } from './codeFailure';
import type {
  CircuitMetrics,
  EfficiencyReport,
  QuantumChallenge,
  Submission,
  SubmissionStatus,
  TestCase,
  TestCaseResult,
} from '../../types/challenge';
import type { CircuitSnapshot } from '../../types/quantum';
import { Button, Select, Tabs } from '../ui';
import './challenges.css';

interface TestRunnerProps {
  challenge: QuantumChallenge;
}

function formatVerdict(verdict: SubmissionStatus) {
  switch (verdict) {
    case 'accepted':
      return 'Accepted';
    case 'wrong_answer':
      return 'Wrong answer';
    case 'runtime_error':
      return 'Runtime error';
    case 'compile_error':
      return 'Compile error';
    case 'time_limit_exceeded':
      return 'Time limit exceeded';
    case 'running':
      return 'Running';
    default:
      return 'Pending';
  }
}

function deriveSubmissionStatus(results: TestCaseResult[]): SubmissionStatus {
  if (results.some((result) => result.verdict === 'compile_error')) return 'compile_error';
  if (results.some((result) => result.verdict === 'time_limit_exceeded')) return 'time_limit_exceeded';
  if (results.some((result) => result.verdict === 'runtime_error')) return 'runtime_error';
  if (results.length > 0 && results.every((result) => result.passed)) return 'accepted';
  return 'wrong_answer';
}

export function TestRunner({ challenge }: TestRunnerProps) {
  const platform = usePlatform();
  const activeFramework = useChallengeModeStore((s) => s.activeFramework);
  const progress = useChallengeModeStore((s) => s.progress);
  const isRunning = useChallengeModeStore((s) => s.isRunning);
  const currentTestResults = useChallengeModeStore((s) => s.currentTestResults);
  const runningTestIndex = useChallengeModeStore((s) => s.runningTestIndex);
  const inspection = useChallengeModeStore((s) => s.inspection);
  const setRunning = useChallengeModeStore((s) => s.setRunning);
  const setRunningTestIndex = useChallengeModeStore((s) => s.setRunningTestIndex);
  const addTestResult = useChallengeModeStore((s) => s.addTestResult);
  const clearTestResults = useChallengeModeStore((s) => s.clearTestResults);
  const addSubmission = useChallengeModeStore((s) => s.addSubmission);
  const markSolved = useChallengeModeStore((s) => s.markSolved);
  const setInspection = useChallengeModeStore((s) => s.setInspection);
  const setInspectionView = useChallengeModeStore((s) => s.setInspectionView);
  const [activeBottomTab, setActiveBottomTab] = useState<'tests' | 'inspection'>('tests');
  // The verdict pill is reserved for Submit; a visible-test run only reports pass counts.
  const [lastRunWasSubmit, setLastRunWasSubmit] = useState(false);
  // Efficiency report from the most recent accepted submission — surfaced as a
  // LeetCode-style performance panel above the test rows.
  const [perfReport, setPerfReport] = useState<EfficiencyReport | null>(null);
  // Set when the browser build can't run the student's program (outside the
  // Qiskit browser subset): shown calmly, and the attempt is not recorded.
  const [unsupportedMessage, setUnsupportedMessage] = useState<string | null>(null);
  // Python never started (or the connection failed) when the last run began: nothing ran.
  const [engineError, setEngineError] = useState<string | null>(null);
  const kernelStatus = useEditorStore((st) => st.kernelStatus);
  const kernelError = useEditorStore((st) => st.kernelError);
  const kernelProgress = useEditorStore((st) => st.kernelProgress);
  const isWeb = platform.getPlatform() === 'web';
  const [inspectionCaseId, setInspectionCaseId] = useState<string | null>(
    challenge.visible_tests?.[0]?.id ?? challenge.testCases.find((testCase) => !testCase.hidden)?.id ?? null,
  );

  const savedCode = progress[challenge.id]?.currentCode[activeFramework];
  const code = savedCode || challenge.starter_template || challenge.starterCode[activeFramework] || '';
  const visibleTests = challenge.visible_tests ?? challenge.testCases.filter((testCase) => !testCase.hidden);
  const hiddenTests = challenge.hidden_tests ?? challenge.testCases.filter((testCase) => testCase.hidden);
  const isValueContract = challenge.contract_kind === 'returns_value';

  const overallVerdict = useMemo(() => (
    currentTestResults.length > 0 ? deriveSubmissionStatus(currentTestResults) : null
  ), [currentTestResults]);

  const totalWeight = useMemo(() => (
    challenge.testCases.reduce((sum, testCase) => sum + testCase.weight, 0)
  ), [challenge.testCases]);

  const visibleWeight = useMemo(() => (
    visibleTests.reduce((sum, testCase) => sum + testCase.weight, 0)
  ), [visibleTests]);

  const totalScore = useMemo(() => {
    if (currentTestResults.length === 0) return null;

    const resultIds = new Set(currentTestResults.map((result) => result.testCaseId));
    const denominator = hiddenTests.some((testCase) => resultIds.has(testCase.id)) ? totalWeight : visibleWeight;
    const earned = currentTestResults.reduce((sum, result, index) => {
      if (!result.passed) return sum;
      const testCase = challenge.testCases.find((candidate) => candidate.id === result.testCaseId) ?? challenge.testCases[index];
      return sum + (testCase?.weight ?? 0);
    }, 0);

    if (denominator <= 0) return 0;
    return Math.round((earned / denominator) * 100);
  }, [challenge.testCases, currentTestResults, hiddenTests, totalWeight, visibleWeight]);

  const handleRun = useCallback(async (submit: boolean) => {
    if (isRunning) return;
    // A start that failed stays failed until Retry; pressing Run is that Retry, not a doomed attempt.
    if (useEditorStore.getState().kernelStatus === 'failed') {
      retryKernel();
      return;
    }
    setEngineError(null);

    clearTestResults();
    setInspection(null);
    setPerfReport(null);
    setUnsupportedMessage(null);
    setRunning(true);
    setActiveBottomTab('tests');
    setLastRunWasSubmit(submit);

    const casesToRun = submit ? challenge.testCases : visibleTests;
    const capturedMetrics: CircuitMetrics[] = [];
    const results = await runTestCases(
      code,
      challenge,
      casesToRun,
      activeFramework,
      platform.getPlatform(),
      1024,
      (index: number) => {
        setRunningTestIndex(index);
      },
      (result: TestCaseResult, index: number) => {
        addTestResult(result);
        setRunningTestIndex(index);
      },
      (message: string) => {
        // Per-test failures are surfaced inline; a platform limit gets its own notice.
        if (message.startsWith('Not supported in the browser')) setUnsupportedMessage(message);
      },
      (snapshot: CircuitSnapshot | null, result) => {
        if (snapshot) {
          const oracleQueries = result?.metrics?.oracle_queries;
          capturedMetrics.push(computeCircuitMetrics(snapshot, undefined, oracleQueries));
        }
      },
      platform.getKernelAuthToken?.bind(platform),
    );

    setRunning(false);
    setRunningTestIndex(-1);

    // Python never started: nothing ran, so there is nothing to show, score or record.
    const unavailable = results.find((result) => result.engineUnavailable);
    if (unavailable) {
      clearTestResults();
      setEngineError(unavailable.message);
      return;
    }

    if (!submit) return;

    // A platform limit is not the student's mistake: don't record a failed attempt.
    if (results.some((result) => result.unsupported)) return;

    const status = deriveSubmissionStatus(results);
    const earnedWeight = results.reduce((sum, result) => {
      if (!result.passed) return sum;
      const testCase = challenge.testCases.find((candidate) => candidate.id === result.testCaseId);
      return sum + (testCase?.weight ?? 0);
    }, 0);
    const submissionScore = totalWeight > 0
      ? Math.round((earnedWeight / totalWeight) * 100)
      : 0;

    // Worst-case circuit efficiency across the graded cases (circuit
    // challenges only; value/QKD contracts capture no snapshot).
    const aggregated = aggregateMetrics(capturedMetrics);
    const metricsWithTime = aggregated
      ? { ...aggregated, executionTimeMs: Math.max(0, ...results.map((r) => r.executionTimeMs)) }
      : undefined;
    const efficiency = metricsWithTime
      ? computeEfficiency(metricsWithTime, challenge.efficiency)
      : undefined;

    const submission: Submission = {
      id: `sub-${Date.now()}`,
      challengeId: challenge.id,
      code,
      framework: activeFramework,
      timestamp: new Date().toISOString(),
      status,
      testCaseResults: results,
      totalScore: submissionScore,
      executionTimeMs: results.reduce((sum, result) => sum + result.executionTimeMs, 0),
      metrics: metricsWithTime,
      efficiency,
    };

    addSubmission(challenge.id, submission);
    if (status === 'accepted') {
      markSolved(challenge.id);
      if (efficiency) setPerfReport(efficiency);
    }
  }, [
    activeFramework,
    addSubmission,
    addTestResult,
    challenge,
    clearTestResults,
    code,
    isRunning,
    markSolved,
    platform,
    setInspection,
    setRunning,
    setRunningTestIndex,
    totalWeight,
    visibleTests,
  ]);

  const handleInspect = useCallback(async () => {
    if (isRunning || !inspectionCaseId) return;

    const selectedTestCase = visibleTests.find((testCase) => testCase.id === inspectionCaseId);
    if (!selectedTestCase) return;

    setRunning(true);
    setRunningTestIndex(-1);

    const inspectionResult = await inspectChallengeCase(
      code,
      challenge,
      selectedTestCase,
      activeFramework,
      platform.getPlatform(),
      1024,
      platform.getKernelAuthToken?.bind(platform),
    );

    setInspection({
      testCaseId: selectedTestCase.id,
      label: selectedTestCase.label || selectedTestCase.description,
      snapshot: inspectionResult.snapshot,
      result: inspectionResult.result,
      stdout: inspectionResult.stdout,
      failure: inspectionResult.failure,
    });
    setInspectionView(inspectionResult.failure || isValueContract ? 'output' : 'circuit');
    setActiveBottomTab('inspection');
    setRunning(false);
  }, [
    activeFramework,
    challenge,
    code,
    inspectionCaseId,
    isRunning,
    platform,
    isValueContract,
    setInspection,
    setInspectionView,
    setRunning,
    setRunningTestIndex,
    visibleTests,
  ]);

  // A platform limit is not a verdict: no red badge, score or failed rows for it.
  const desktopOnly = unsupportedMessage !== null;
  const engineDown = kernelStatus === 'failed' || engineError !== null;
  const codeFailure = desktopOnly || engineDown ? null : sharedCodeFailure(currentTestResults);

  const verdictColor = overallVerdict === 'accepted'
    ? 'var(--color-success)'
    : overallVerdict === 'compile_error' || overallVerdict === 'time_limit_exceeded'
      ? 'var(--color-warning)'
      : 'var(--color-danger)';

  const renderRow = (testCase: TestCase, index: number) => {
    const hideResults = desktopOnly || engineDown || codeFailure !== null;
    const result = hideResults ? undefined : currentTestResults.find((entry) => entry.testCaseId === testCase.id);
    return (
      <TestCaseRow
        key={testCase.id}
        testCase={testCase}
        result={result}
        notRun={codeFailure !== null && currentTestResults.some((entry) => entry.testCaseId === testCase.id)}
        isRunning={isRunning && runningTestIndex === index}
        index={index}
      />
    );
  };

  const tabs: ReadonlyArray<{ value: 'tests' | 'inspection'; label: string }> = [
    { value: 'tests', label: 'Test cases' },
    { value: 'inspection', label: isValueContract ? 'Return output' : 'Quantum output' },
  ];
  const bootNote = kernelStatus === 'connecting' && !engineDown
    ? `${bootStepLabel(kernelProgress, { isWeb }).long}${isWeb ? " · tests run when it's ready" : ''}`
    : null;
  const passedCount = currentTestResults.filter((result) => result.passed).length;

  return (
    <div className="trun">
      <div className="trun__bar">
        <Button size="lg" loading={isRunning && !lastRunWasSubmit} disabled={isRunning} icon={<Play size={12} aria-hidden="true" />} onClick={() => handleRun(false)}>
          {isRunning && !lastRunWasSubmit ? 'Running…' : 'Run visible tests'}
        </Button>
        <Button size="lg" variant="primary" loading={isRunning && lastRunWasSubmit} disabled={isRunning} icon={<Check size={12} aria-hidden="true" />} onClick={() => handleRun(true)}>
          {isRunning && lastRunWasSubmit ? 'Submitting…' : 'Submit'}
        </Button>
        {bootNote && (
          <span className="trun__bootnote" role="status">
            <Loader className="nuclei-spin" size={12} aria-hidden="true" />
            {bootNote}
          </span>
        )}

        <div className="trun__inspect">
          <Select
            size="lg"
            aria-label="Test case to inspect"
            value={inspectionCaseId ?? ''}
            onChange={(event) => setInspectionCaseId(event.target.value)}
          >
            {visibleTests.map((testCase: TestCase) => (
              <option key={testCase.id} value={testCase.id}>{testCase.label}</option>
            ))}
          </Select>
          <Button size="lg" icon={<SearchCode size={12} aria-hidden="true" />} disabled={isRunning || !inspectionCaseId} onClick={handleInspect}>
            {isValueContract ? 'Inspect return value' : 'Inspect quantum output'}
          </Button>
        </div>

        {overallVerdict && !isRunning && !desktopOnly && !engineDown && (
          <div className="trun__verdict" role="status">
            {lastRunWasSubmit ? (
              <>
                <span className="trun__badge" style={{ ['--verdict-color' as string]: verdictColor }}>
                  {overallVerdict === 'accepted' ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
                  {formatVerdict(overallVerdict)}
                </span>
                {codeFailure
                  ? <span className="trun__score">0 of {currentTestResults.length} cases ran</span>
                  : totalScore !== null && <span className="trun__score">Score: {totalScore}%</span>}
              </>
            ) : (
              <span className="trun__score">
                {codeFailure
                  ? `0 of ${currentTestResults.length} cases ran`
                  : `${passedCount} of ${currentTestResults.length} visible cases passed`}
              </span>
            )}
          </div>
        )}
      </div>

      <Tabs
        className="trun__tabs"
        aria-label="Result view"
        idBase="trun-tab"
        panelId="trun-panel"
        value={activeBottomTab}
        options={tabs}
        onChange={setActiveBottomTab}
      />

      <div className="trun__body" id="trun-panel" role="tabpanel" aria-labelledby={`trun-tab-${activeBottomTab}`}>
        {activeBottomTab === 'inspection' ? (
          <ChallengeInspector />
        ) : (
          <div className="trun__results">
            {engineDown && !isRunning && (
              <LessonEngineFailed
                detail={kernelStatus === 'failed' ? kernelError : engineError}
                onRetry={() => { setEngineError(null); retryKernel(); }}
              />
            )}

            {codeFailure && !isRunning && (
              <div className="trun__failure" role="alert">
                <div className="trun__failure-text">
                  <span className="trun__failure-title">{codeFailure.title}</span>
                  <span className="trun__failure-detail">{codeFailure.detail}</span>
                </div>
              </div>
            )}

            {unsupportedMessage && !isRunning && (
              <div className="trun__notice">
                <UnsupportedNotice message={unsupportedMessage.replace(/^Not supported in the browser: /, '')} />
              </div>
            )}

            {perfReport && overallVerdict === 'accepted' && !isRunning && <PerformancePanel report={perfReport} />}

            {visibleTests.map((testCase, index) => renderRow(testCase, index))}
            {hiddenTests.map((testCase, index) => renderRow(testCase, visibleTests.length + index))}

            {isRunning && currentTestResults.length === 0 && !bootNote && (
              <div className="trun__note">
                <Loader className="nuclei-spin" size={14} aria-hidden="true" />
                {isWeb && kernelStatus !== 'ready'
                  ? 'Python is loading. The first run downloads it and can take a few seconds.'
                  : 'Running tests…'}
              </div>
            )}

            {!isRunning && !inspection && currentTestResults.length === 0 && (
              <div className="trun__note">
                Run the visible tests to validate your solver, then submit once the visible cases are passing.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
