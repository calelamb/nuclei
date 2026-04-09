import { useCallback } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { runTestCases } from '../../services/challengeExecution';
import { TestCaseRow } from './TestCaseRow';
import { Play, Check, X } from 'lucide-react';
import type { QuantumChallenge, Submission, TestCaseResult } from '../../types/challenge';

interface TestRunnerProps {
  challenge: QuantumChallenge;
}

export function TestRunner({ challenge }: TestRunnerProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const activeFramework = useChallengeModeStore((s) => s.activeFramework);
  const progress = useChallengeModeStore((s) => s.progress);
  const isRunning = useChallengeModeStore((s) => s.isRunning);
  const currentTestResults = useChallengeModeStore((s) => s.currentTestResults);
  const runningTestIndex = useChallengeModeStore((s) => s.runningTestIndex);
  const setRunning = useChallengeModeStore((s) => s.setRunning);
  const setRunningTestIndex = useChallengeModeStore((s) => s.setRunningTestIndex);
  const addTestResult = useChallengeModeStore((s) => s.addTestResult);
  const clearTestResults = useChallengeModeStore((s) => s.clearTestResults);
  const addSubmission = useChallengeModeStore((s) => s.addSubmission);
  const markSolved = useChallengeModeStore((s) => s.markSolved);

  const savedCode = progress[challenge.id]?.currentCode[activeFramework];
  const starterCode = challenge.starterCode[activeFramework] ?? '';
  const code = savedCode || starterCode;

  const visibleTests = challenge.testCases.filter((tc) => !tc.hidden);
  const hiddenTests = challenge.testCases.filter((tc) => tc.hidden);

  const handleRun = useCallback(async (submit: boolean) => {
    if (isRunning) return;

    clearTestResults();
    setRunning(true);

    const casesToRun = submit ? challenge.testCases : visibleTests;

    const results = await runTestCases(
      code,
      casesToRun,
      activeFramework,
      1024,
      (result: TestCaseResult, index: number) => {
        addTestResult(result);
        setRunningTestIndex(index + 1);
      },
      () => {
        // Error already encoded in individual test results
      },
    );

    setRunning(false);
    setRunningTestIndex(-1);

    if (submit) {
      const totalWeight = challenge.testCases.reduce((sum, tc) => sum + tc.weight, 0);
      const earnedWeight = results.reduce((sum, r, i) => {
        return sum + (r.passed ? challenge.testCases[i].weight : 0);
      }, 0);
      const totalScore = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;
      const allPassed = results.every((r) => r.passed);

      const submission: Submission = {
        id: `sub-${Date.now()}`,
        challengeId: challenge.id,
        code,
        framework: activeFramework,
        timestamp: new Date().toISOString(),
        status: allPassed ? 'accepted' : 'wrong_answer',
        testCaseResults: results,
        totalScore,
        executionTimeMs: results.reduce((sum, r) => sum + r.executionTimeMs, 0),
      };

      addSubmission(challenge.id, submission);
      if (allPassed) markSolved(challenge.id);
    }
  }, [
    isRunning, code, activeFramework, challenge, visibleTests,
    clearTestResults, setRunning, setRunningTestIndex, addTestResult,
    addSubmission, markSolved,
  ]);

  // Derive overall status from results
  const hasResults = currentTestResults.length > 0;
  const allPassed = hasResults && currentTestResults.every((r) => r.passed);
  const totalScore = hasResults
    ? Math.round(
        (currentTestResults.filter((r) => r.passed).length / currentTestResults.length) * 100,
      )
    : null;

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: colors.bg,
    }}>
      {/* Action bar */}
      <div style={{
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgPanel,
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
            transition: 'all 150ms ease',
          }}
          onMouseEnter={(e) => {
            if (!isRunning) e.currentTarget.style.background = `${colors.accent}28`;
          }}
          onMouseLeave={(e) => {
            if (!isRunning) e.currentTarget.style.background = `${colors.accent}18`;
          }}
        >
          <Play size={12} />
          Run Tests
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
            transition: 'all 150ms ease',
          }}
        >
          Submit
        </button>

        {/* Status badge */}
        {hasResults && !isRunning && (
          <div style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              borderRadius: 4,
              background: allPassed ? `${colors.success}18` : `${colors.error}18`,
              color: allPassed ? colors.success : colors.error,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "'Geist Sans', sans-serif",
            }}>
              {allPassed ? <Check size={12} /> : <X size={12} />}
              {allPassed ? 'Accepted' : 'Wrong Answer'}
            </div>
            <span style={{
              color: colors.textMuted,
              fontSize: 11,
              fontFamily: "'Geist Sans', sans-serif",
            }}>
              Score: {totalScore}%
            </span>
          </div>
        )}
      </div>

      {/* Test case list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '4px 0',
      }}>
        {/* Visible test cases */}
        {visibleTests.map((tc, i) => {
          const result = currentTestResults.find((r) => r.testCaseId === tc.id);
          const running = isRunning && runningTestIndex === i;
          return (
            <TestCaseRow
              key={tc.id}
              testCase={tc}
              result={result}
              isRunning={running}
              index={i}
            />
          );
        })}

        {/* Hidden test cases */}
        {hiddenTests.map((tc, i) => {
          const result = currentTestResults.find((r) => r.testCaseId === tc.id);
          const absIdx = visibleTests.length + i;
          const running = isRunning && runningTestIndex === absIdx;
          return (
            <TestCaseRow
              key={tc.id}
              testCase={tc}
              result={result}
              isRunning={running}
              index={absIdx}
            />
          );
        })}
      </div>
    </div>
  );
}
