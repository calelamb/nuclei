import { useCallback, useMemo, useState } from 'react';
import { Check, Play, SearchCode, X } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import {
  inspectChallengeCase,
  runTestCases,
} from '../../services/challengeExecution';
import { usePlatform } from '../../platform/PlatformProvider';
import { TestCaseRow } from './TestCaseRow';
import { ChallengeInspector } from './ChallengeInspector';
import type {
  QuantumChallenge,
  Submission,
  SubmissionStatus,
  TestCase,
  TestCaseResult,
} from '../../types/challenge';

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
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
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
    setRunning(true);
    setActiveBottomTab('tests');

    const casesToRun = submit ? challenge.testCases : visibleTests;
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
      () => {
        // Per-test failures are surfaced inline.
      },
    );

    setRunning(false);
    setRunningTestIndex(-1);

    if (!submit) return;

    const status = deriveSubmissionStatus(results);
    const earnedWeight = results.reduce((sum, result) => {
      if (!result.passed) return sum;
      const testCase = challenge.testCases.find((candidate) => candidate.id === result.testCaseId);
      return sum + (testCase?.weight ?? 0);
    }, 0);
    const submissionScore = totalWeight > 0
      ? Math.round((earnedWeight / totalWeight) * 100)
      : 0;

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
    };

    addSubmission(challenge.id, submission);
    if (status === 'accepted') {
      markSolved(challenge.id);
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

  const verdictColor = overallVerdict === 'accepted'
    ? colors.success
    : overallVerdict === 'wrong_answer'
      ? colors.error
      : overallVerdict === 'compile_error'
        ? colors.warning
        : overallVerdict === 'time_limit_exceeded'
          ? colors.warning
          : colors.error;

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: colors.bg,
    }}>
      <div style={{
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgPanel,
        flexWrap: 'wrap',
      }}>
        <button
          onClick={() => handleRun(false)}
          disabled={isRunning}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 16px',
            borderRadius: 6,
            border: `1px solid ${colors.accent}`,
            background: `${colors.accent}18`,
            color: colors.accent,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "'Geist Sans', sans-serif",
            cursor: isRunning ? 'not-allowed' : 'pointer',
            opacity: isRunning ? 0.5 : 1,
          }}
        >
          <Play size={12} />
          Run Visible Tests
        </button>

        <button
          onClick={() => handleRun(true)}
          disabled={isRunning}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 16px',
            borderRadius: 6,
            border: 'none',
            background: colors.accent,
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "'Geist Sans', sans-serif",
            cursor: isRunning ? 'not-allowed' : 'pointer',
            opacity: isRunning ? 0.5 : 1,
            boxShadow: shadow.sm,
          }}
        >
          <Check size={12} />
          Submit
        </button>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginLeft: 8,
          paddingLeft: 8,
          borderLeft: `1px solid ${colors.border}`,
        }}>
          <select
            value={inspectionCaseId ?? ''}
            onChange={(event) => setInspectionCaseId(event.target.value)}
            style={{
              background: colors.bgElevated,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: '6px 10px',
              color: colors.text,
              fontSize: 11,
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            {visibleTests.map((testCase: TestCase) => (
              <option key={testCase.id} value={testCase.id}>
                {testCase.label}
              </option>
            ))}
          </select>

          <button
            onClick={handleInspect}
            disabled={isRunning || !inspectionCaseId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 6,
              border: `1px solid ${colors.border}`,
              background: 'transparent',
              color: colors.text,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "'Geist Sans', sans-serif",
              cursor: isRunning ? 'not-allowed' : 'pointer',
              opacity: isRunning ? 0.5 : 1,
            }}
          >
            <SearchCode size={12} />
            {isValueContract ? 'Inspect Return Value' : 'Inspect Quantum Output'}
          </button>
        </div>

        {overallVerdict && !isRunning && (
          <div style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 999,
              background: `${verdictColor}18`,
              color: verdictColor,
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "'Geist Sans', sans-serif",
            }}>
              {overallVerdict === 'accepted' ? <Check size={12} /> : <X size={12} />}
              {formatVerdict(overallVerdict)}
            </div>
            {totalScore !== null && (
              <span style={{
                color: colors.textMuted,
                fontSize: 11,
                fontFamily: "'Geist Sans', sans-serif",
              }}>
                Score: {totalScore}%
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 12px',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgPanel,
        flexShrink: 0,
      }}>
        <button
          onClick={() => setActiveBottomTab('tests')}
          style={{
            padding: '6px 8px',
            background: 'transparent',
            border: 'none',
            borderBottom: activeBottomTab === 'tests' ? `2px solid ${colors.accent}` : '2px solid transparent',
            color: activeBottomTab === 'tests' ? colors.text : colors.textMuted,
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "'Geist Sans', sans-serif",
            cursor: 'pointer',
          }}
        >
          Test Results
        </button>
        <button
          onClick={() => setActiveBottomTab('inspection')}
          style={{
            padding: '6px 8px',
            background: 'transparent',
            border: 'none',
            borderBottom: activeBottomTab === 'inspection' ? `2px solid ${colors.accent}` : '2px solid transparent',
            color: activeBottomTab === 'inspection' ? colors.text : colors.textMuted,
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "'Geist Sans', sans-serif",
            cursor: 'pointer',
          }}
        >
          {isValueContract ? 'Return Output' : 'Quantum Output'}
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeBottomTab === 'inspection' ? (
          <ChallengeInspector />
        ) : (
          <div style={{ height: '100%', overflowY: 'auto', padding: '4px 0' }}>
            {visibleTests.map((testCase, index) => {
              const result = currentTestResults.find((entry) => entry.testCaseId === testCase.id);
              const running = isRunning && runningTestIndex === index;
              return (
                <TestCaseRow
                  key={testCase.id}
                  testCase={testCase}
                  result={result}
                  isRunning={running}
                  index={index}
                />
              );
            })}

            {hiddenTests.map((testCase, index) => {
              const result = currentTestResults.find((entry) => entry.testCaseId === testCase.id);
              const absoluteIndex = visibleTests.length + index;
              const running = isRunning && runningTestIndex === absoluteIndex;
              return (
                <TestCaseRow
                  key={testCase.id}
                  testCase={testCase}
                  result={result}
                  isRunning={running}
                  index={absoluteIndex}
                />
              );
            })}

            {!inspection && currentTestResults.length === 0 && (
              <div style={{
                padding: '18px 16px',
                color: colors.textDim,
                fontSize: 12,
                fontFamily: "'Geist Sans', sans-serif",
              }}>
                Run the visible tests to validate your solver, then submit once the visible cases are passing.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
