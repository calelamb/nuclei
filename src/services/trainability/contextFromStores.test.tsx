// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../stores/editorStore';
import { useTrainabilityStore } from '../../stores/trainabilityStore';
import { buildTrainabilityContextFromStores } from './contextFromStores';
import { FIXTURE_CODE, inspectionFixture, jobFixture } from './fixtures';
import { codeKey } from './hash';
import { useTrainabilityReveal } from './useTrainabilityReveal';

beforeEach(() => {
  useTrainabilityStore.getState().reset();
  useEditorStore.setState({ code: FIXTURE_CODE, framework: 'qiskit', filePath: '/p/hea.py' });
});
afterEach(cleanup);

describe('buildTrainabilityContextFromStores', () => {
  it('is empty before the Lab has seen a parameterized circuit', () => {
    expect(buildTrainabilityContextFromStores()).toBe('');
  });

  it('describes the displayed job and marks it stale after an edit', () => {
    const job = jobFixture({ codeKey: codeKey(`qiskit\n${FIXTURE_CODE}`) });
    useTrainabilityStore.setState({
      inspect: { status: 'ready', data: inspectionFixture, error: null, codeKey: 'k' },
      jobs: { [job.id]: job },
      jobOrder: [job.id],
    });
    expect(buildTrainabilityContextFromStores()).toContain('Barren-plateau risk: high');
    expect(buildTrainabilityContextFromStores()).not.toContain('may be stale');
    useEditorStore.setState({ code: `${FIXTURE_CODE}# edited` });
    expect(buildTrainabilityContextFromStores()).toContain('may be stale');
  });
});

describe('useTrainabilityReveal', () => {
  const editor = () => ({ revealLineInCenter: vi.fn(), setPosition: vi.fn(), focus: vi.fn() });

  it('reveals each request once', () => {
    const e = editor();
    renderHook(() => useTrainabilityReveal(e));
    expect(e.revealLineInCenter).not.toHaveBeenCalled();
    act(() => useTrainabilityStore.getState().requestReveal(14));
    expect(e.revealLineInCenter).toHaveBeenCalledWith(14);
    expect(e.setPosition).toHaveBeenCalledWith({ lineNumber: 14, column: 1 });
    expect(e.focus).toHaveBeenCalledTimes(1);
    act(() => useTrainabilityStore.getState().requestReveal(14));
    expect(e.revealLineInCenter).toHaveBeenCalledTimes(2);
  });

  it('does nothing without an editor', () => {
    act(() => useTrainabilityStore.getState().requestReveal(3));
    expect(() => renderHook(() => useTrainabilityReveal(null))).not.toThrow();
  });
});
