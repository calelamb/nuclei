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
    isReady: () => false,
    currentProgress: () => null,
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

describe('ExerciseBlock Run while Python boots', () => {
  it('queues the press, and a second press cancels so nothing is sent', async () => {
    render(<ExerciseBlock {...props} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    const queued = screen.getByRole('button', { name: /Queued|Loading Python/ });
    expect(queued.getAttribute('aria-pressed')).toBe('true');
    expect(queued.getAttribute('title') ?? '').toMatch(/cancel/i);
    fireEvent.click(queued);
    expect(screen.getByRole('button', { name: /^Run$/ })).toBeTruthy();
    await act(async () => { boot.resolveInit(); await Promise.resolve(); await Promise.resolve(); });
    expect(boot.sent.filter((m) => m.type === 'run_python' || m.type === 'execute')).toHaveLength(0);
  });
});

describe('ExerciseBlock grading honesty', () => {
  it('cannot grade the old run once the code is edited: Check solution waits for a re-run', async () => {
    await runWith('print(41)', ['41']);
    expect(screen.getByRole('button', { name: /Check solution/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'print(42)' } });
    fireEvent.click(screen.getByRole('button', { name: /Check solution/ }));
    expect(passed()).toEqual([]);
    expect(screen.queryByText(/checks out|Nice\./)).toBeNull();
  });

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

describe('ExerciseBlock draft persistence', () => {
  const draft = () => useLearnStore.getState().lessonProgress['L1']?.drafts?.['ex-1'];

  it('saves a typed draft after the debounce and restores it on remount', async () => {
    vi.useFakeTimers();
    try {
      const first = render(<ExerciseBlock {...props} />);
      fireEvent.change(screen.getByLabelText('code'), { target: { value: 'print(7)' } });
      expect(draft()).toBeUndefined();
      act(() => { vi.advanceTimersByTime(350); });
      expect(draft()).toBe('print(7)');
      first.unmount();
      render(<ExerciseBlock {...props} />);
      expect((screen.getByLabelText('code') as HTMLTextAreaElement).value).toBe('print(7)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes a pending draft when the lesson unmounts inside the debounce window', () => {
    const view = render(<ExerciseBlock {...props} />);
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'print(8)' } });
    view.unmount();
    expect(draft()).toBe('print(8)');
  });

  it('keeps Reset in place but disabled until edited, and asks before discarding', () => {
    render(<ExerciseBlock {...props} />);
    const reset = () => screen.getByRole('button', { name: /^(Reset|Discard\?)/ }) as HTMLButtonElement;
    expect(reset().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'print(9)' } });
    expect(reset().disabled).toBe(false);
    fireEvent.click(reset());
    expect((screen.getByLabelText('code') as HTMLTextAreaElement).value).toBe('print(9)');
    expect(reset().textContent).toMatch(/Discard\?/);
    fireEvent.click(reset());
    expect((screen.getByLabelText('code') as HTMLTextAreaElement).value).toBe(STARTER);
    expect(draft()).toBeUndefined();
    expect(reset().disabled).toBe(true);
  });

  it('typing disarms a pending Reset confirmation', () => {
    render(<ExerciseBlock {...props} />);
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'print(9)' } });
    fireEvent.click(screen.getByRole('button', { name: /^Reset/ }));
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'print(10)' } });
    expect(screen.getByRole('button', { name: /^Reset/ })).toBeTruthy();
  });
});

describe('ExerciseBlock armed Reset (r7-learn-02)', () => {
  it('turns destructive, announces itself, and Escape disarms with focus kept', () => {
    render(<ExerciseBlock {...props} />);
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'print(9)' } });
    const reset = () => screen.getByRole('button', { name: /^(Reset|Discard\?)/ });
    reset().focus();
    fireEvent.click(reset());
    expect(reset().className).toMatch(/nuclei-btn--danger/);
    expect(screen.getByText('Press again to discard your edits')).toBeTruthy();
    fireEvent.keyDown(reset(), { key: 'Escape' });
    expect(reset().textContent).toBe('Reset');
    expect(reset().className).not.toMatch(/nuclei-btn--danger/);
    expect(document.activeElement).toBe(reset());
    expect((screen.getByLabelText('code') as HTMLTextAreaElement).value).toBe('print(9)');
  });
});

describe('ExerciseBlock run feedback', () => {
  it('says so when a run produced nothing', async () => {
    await runWith(STARTER, []);
    expect(screen.getByText(/Ran · no output yet/)).toBeTruthy();
  });

  it('clears a failed Check message as soon as the code is edited', async () => {
    await runWith('print(41)', ['41']);
    expect(screen.getByRole('status').textContent).toMatch(/output does not match/i);
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'print(4' } });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('ExerciseBlock live region (r8-01)', () => {
  it('uses the shared, origin-anchored sr-only utility so it cannot stretch the document', () => {
    const { container } = render(<ExerciseBlock {...props} />);
    const live = container.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live.classList.contains('nuclei-sr-only')).toBe(true);
    expect(container.querySelector('.demo__sr')).toBeNull();
  });
});

describe('ExerciseBlock stale results and Reset focus (r7-learn-01, interaction-r-06)', () => {
  it('marks output from older code stale and keeps Check solution, waiting, instead of removing it', async () => {
    await runWith('print(41)', ['41']);
    expect(screen.queryByTestId('stale-result-notice')).toBeNull();
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'print(42)' } });
    expect(screen.getByRole('button', { name: /From last run · Run again/ })).toBeTruthy();
    const check = screen.getByRole('button', { name: 'Check solution' });
    expect(check.getAttribute('aria-disabled')).toBe('true');
    expect(document.querySelector('.exercise__output')?.getAttribute('data-stale')).toBe('true');
  });

  it('shows no waiting Check solution after a run that errored', async () => {
    render(<ExerciseBlock {...props} />);
    await act(async () => { boot.resolveInit(); await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'print(' } });
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { boot.onMessage({ type: 'python_result', success: false, error: 'SyntaxError: boom' }); });
    expect(screen.queryByRole('button', { name: 'Check solution' })).toBeNull();
  });

  it('lands focus on the editor after a confirmed Reset instead of <body>', () => {
    render(<ExerciseBlock {...props} />);
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'print(9)' } });
    const reset = screen.getByRole('button', { name: /^Reset/ });
    reset.focus();
    fireEvent.click(reset);
    fireEvent.click(screen.getByRole('button', { name: /^Discard/ }));
    expect(document.activeElement).toBe(screen.getByLabelText('code'));
  });
});
