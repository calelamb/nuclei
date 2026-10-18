// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const boot = vi.hoisted(() => ({
  resolveInit: () => {},
  sent: [] as Array<Record<string, unknown>>,
  onMessage: (() => {}) as (m: unknown) => void,
}));

vi.mock('../../platform/PlatformProvider', () => ({
  usePlatform: () => ({ getPlatform: () => 'web', getKernelAuthToken: undefined }),
}));
vi.mock('./LessonCodeEditor', () => ({
  LessonCodeEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="code" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('../../platform/pyodide/pyodideClient', () => ({
  pyodideRuntime: {
    isReady: () => true,
    onProgress: () => () => {},
    onState: () => () => {},
  },
}));
vi.mock('../../platform/pyodideKernel', () => ({
  PyodideKernel: class {
    constructor(onMessage: (m: unknown) => void) { boot.onMessage = onMessage; }
    init() { return new Promise<void>((resolve) => { boot.resolveInit = resolve; }); }
    async send(msg: Record<string, unknown>) { boot.sent.push(msg); }
  },
}));

import { ExerciseBlock } from './ExerciseBlock';
import { useLearnStore } from '../../stores/learnStore';

const STARTER = '# TODO: Print the number 42\n';
const props = {
  id: 'ex-1', title: 'Print', description: 'Print 42', starterCode: STARTER, framework: 'qiskit' as const,
  expectedOutput: ['\\b42\\b'], tolerancePercent: 0, hints: [], successMessage: 'Nice.',
};

const passed = () => useLearnStore.getState().lessonProgress['L1']?.exercisesPassed ?? [];

async function runWith(code: string, printed: string[]) {
  render(<ExerciseBlock {...props} />);
  await act(async () => { boot.resolveInit(); await Promise.resolve(); });
  if (code !== STARTER) fireEvent.change(screen.getByLabelText('code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
  await act(async () => { await Promise.resolve(); });
  await act(async () => {
    printed.forEach((text) => boot.onMessage({ type: 'output', text }));
    boot.onMessage({ type: 'python_result', success: true });
  });
}

beforeEach(() => {
  boot.sent = [];
  useLearnStore.setState({
    currentLessonId: 'L1',
    lessonProgress: { L1: { startedAt: '2026-01-01', exercisesPassed: [], quizScores: {}, hintsUsed: 0 } },
  });
});
afterEach(cleanup);

describe('ExerciseBlock grading honesty', () => {
  it('does not record a pass when Run is pressed on the untouched starter', async () => {
    await runWith(STARTER, []);
    expect(passed()).toEqual([]);
    expect(screen.queryByText(/checks out|Nice\./)).toBeNull();
  });

  it('does not record a pass for edited code whose output is wrong', async () => {
    await runWith('print(41)', ['41']);
    expect(passed()).toEqual([]);
    expect(screen.getByRole('status').textContent).toMatch(/output does not match/i);
  });

  it('records a pass when the printed output matches', async () => {
    await runWith('print(42)', ['42']);
    expect(passed()).toEqual(['ex-1']);
  });

  it('Check solution on the untouched starter fails instead of passing', async () => {
    await runWith(STARTER, ['42']);
    fireEvent.click(screen.getByRole('button', { name: /Check solution/ }));
    expect(passed()).toEqual([]);
    expect(screen.getByRole('status').textContent).toMatch(/Replace the starter/);
  });
});
