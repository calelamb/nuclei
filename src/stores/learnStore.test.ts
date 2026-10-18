// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useLearnStore } from './learnStore';

const fresh = () => ({ startedAt: '2026-01-01', exercisesPassed: [], quizScores: {}, hintsUsed: 0 });

beforeEach(() => {
  localStorage.clear();
  useLearnStore.setState({ lessonProgress: { L1: fresh() }, completedLessons: [] });
});

describe('exercise drafts', () => {
  it('stores a draft per exercise without mutating the previous progress', () => {
    const before = useLearnStore.getState().lessonProgress;
    useLearnStore.getState().setExerciseDraft('L1', 'ex-1', 'qc.h(0)');
    const after = useLearnStore.getState().lessonProgress;
    expect(after.L1.drafts).toEqual({ 'ex-1': 'qc.h(0)' });
    expect(after).not.toBe(before);
    expect(before.L1.drafts).toBeUndefined();
  });

  it('keeps other exercises drafts and creates progress when missing', () => {
    useLearnStore.getState().setExerciseDraft('L1', 'ex-1', 'a');
    useLearnStore.getState().setExerciseDraft('L1', 'ex-2', 'b');
    useLearnStore.getState().setExerciseDraft('L9', 'ex-1', 'c');
    const { lessonProgress } = useLearnStore.getState();
    expect(lessonProgress.L1.drafts).toEqual({ 'ex-1': 'a', 'ex-2': 'b' });
    expect(lessonProgress.L9.drafts).toEqual({ 'ex-1': 'c' });
  });

  it('persists drafts to localStorage', () => {
    useLearnStore.getState().setExerciseDraft('L1', 'ex-1', 'qc.h(0)');
    const saved = JSON.parse(localStorage.getItem('nuclei-learn') ?? '{}');
    expect(saved.lessonProgress.L1.drafts['ex-1']).toBe('qc.h(0)');
  });

  it('clears one draft and leaves the rest', () => {
    useLearnStore.getState().setExerciseDraft('L1', 'ex-1', 'a');
    useLearnStore.getState().setExerciseDraft('L1', 'ex-2', 'b');
    useLearnStore.getState().clearExerciseDraft('L1', 'ex-1');
    expect(useLearnStore.getState().lessonProgress.L1.drafts).toEqual({ 'ex-2': 'b' });
  });

  it('clearing a missing draft is a no-op', () => {
    const before = useLearnStore.getState().lessonProgress;
    useLearnStore.getState().clearExerciseDraft('L1', 'nope');
    expect(useLearnStore.getState().lessonProgress).toBe(before);
  });
});
