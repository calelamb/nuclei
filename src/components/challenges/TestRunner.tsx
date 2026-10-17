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
import { Button, Select } from '../ui';
import './challenges.css';

interface TestRunnerProps {
  challenge: QuantumChallenge;
}

function formatVerdict(verdict: SubmissionStatus) {
  switch (verdict) {
    case 'accepted':
      return 'Accepted';
    case 'wrong_answer':
      return 'Wrong Answer';
    case 'runtime_error':
      return 'Runtime Error';
    case 'compile_error':
      return 'Compile Error';
    case 'time_limit_exceeded':
      return 'Time Limit Exceeded';
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
  // Efficiency report from the most recent accepted submission — surfaced as a
  // LeetCode-style performance panel above the test rows.
  const [perfReport, setPerfReport] = useState<EfficiencyReport | null>(null);
  // Set when the browser build can't run the student's program (outside the
  // Qiskit browser subset): shown calmly, and the attempt is not recorded.
  const [unsupportedMessage, setUnsupportedMessage] = useState<string | null>(null);
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

    clearTestResults();
    setInspection(null);
    setPerfReport(null);
    setUnsupportedMessage(null);
    setRunning(true);
    setActiveBottomTab('tests');

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

  const verdictColor = overallVerdict === 'accepted'
    ? 'var(--color-success)'
    : overallVerdict === 'compile_error' || overallVerdict === 'time_limit_exceeded'
      ? 'var(--color-warning)'
      : 'var(--color-danger)';

  const renderRow = (testCase: TestCase, index: number) => {
    const result = desktopOnly ? undefined : currentTestResults.find((entry) => entry.testCaseId === testCase.id);
    return (
      <TestCaseRow
        key={testCase.id}
        testCase={testCase}
        result={result}
        isRunning={isRunning && runningTestIndex === index}
        index={index}
      />
    );
  };

  const tabs: ReadonlyArray<{ key: 'tests' | 'inspection'; label: string }> = [
    { key: 'tests', label: 'Test Results' },
    { key: 'inspection', label: isValueContract ? 'Return Output' : 'Quantum Output' },
  ];

  return (
    <div className="trun">
      <div className="trun__bar">
        <Button size="lg" icon={<Play size={12} aria-hidden="true" />} disabled={isRunning} onClick={() => handleRun(false)}>
          Run Visible Tests
        </Button>
        <Button size="lg" variant="primary" icon={<Check size={12} aria-hidden="true" />} disabled={isRunning} onClick={() => handleRun(true)}>
          Submit
        </Button>

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
            {isValueContract ? 'Inspect Return Value' : 'Inspect Quantum Output'}
          </Button>
        </div>

        {overallVerdict && !isRunning && !desktopOnly && (
          <div className="trun__verdict" role="status">
            <span className="trun__badge" style={{ ['--verdict-color' as string]: verdictColor }}>
              {overallVerdict === 'accepted' ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
              {formatVerdict(overallVerdict)}
            </span>
            {totalScore !== null && <span className="trun__score">Score: {totalScore}%</span>}
          </div>
        )}
      </div>

      <div className="trun__tabs" role="tablist" aria-label="Result view">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeBottomTab === tab.key}
            className="trun__tab"
            onClick={() => setActiveBottomTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="trun__body">
        {activeBottomTab === 'inspection' ? (
          <ChallengeInspector />
        ) : (
          <div className="trun__results">
            {unsupportedMessage && !isRunning && (
              <div className="trun__notice">
                <UnsupportedNotice message={unsupportedMessage.replace(/^Not supported in the browser: /, '')} />
              </div>
            )}

            {perfReport && overallVerdict === 'accepted' && !isRunning && <PerformancePanel report={perfReport} />}

            {visibleTests.map((testCase, index) => renderRow(testCase, index))}
            {hiddenTests.map((testCase, index) => renderRow(testCase, visibleTests.length + index))}

            {isRunning && currentTestResults.length === 0 && (
              <div className="trun__note">
                <Loader className="nuclei-spin" size={14} aria-hidden="true" />
                Preparing the kernel and running tests. The first run downloads the in-browser Python kernel and can take a few seconds.
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
