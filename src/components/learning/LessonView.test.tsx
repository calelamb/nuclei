// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, render, cleanup, screen, fireEvent } from '@testing-library/react';
import { LessonView } from './LessonView';
import { useLearnStore } from '../../stores/learnStore';
import { useLearnSectionStore } from './learnSectionStore';
import { TRACKS } from '../../data/lessons/tracks';

vi.mock('./InteractiveDemo', () => ({ InteractiveDemo: () => <div /> }));
const mounts = vi.hoisted(() => ({ exercise: [] as string[] }));
vi.mock('./ExerciseBlock', async () => {
  const { useEffect } = await import('react');
  return {
    ExerciseBlock: ({ id }: { id: string }) => {
      useEffect(() => { mounts.exercise.push(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- counts true mounts
      return <div />;
    },
  };
});
vi.mock('./VideoPlayer', () => ({ VideoPlayer: () => <div /> }));
vi.mock('./InteractiveBlochSphere', () => ({ InteractiveBlochSphere: () => <div /> }));

const observed: IntersectionObserverInit[] = [];
class NoopObserver {
  constructor(_cb: unknown, options?: IntersectionObserverInit) { if (options) observed.push(options); }
  observe() {}
  disconnect() {}
  unobserve() {}
}
const track = TRACKS.find((t) => t.lessons.length > 1)!;
const lesson = track.lessons[0];

beforeEach(() => {
  observed.length = 0;
  localStorage.clear();
  vi.stubGlobal('IntersectionObserver', NoopObserver);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  useLearnSectionStore.setState({ returnTo: null, restore: null });
  useLearnStore.setState({ completedLessons: [], lessonProgress: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LessonView', () => {
  it('remounts exercise blocks when the lesson changes so no code or output carries over', () => {
    mounts.exercise.length = 0;
    const withExercise = track.lessons.filter((l) => l.contentBlocks.some((b) => b.type === 'exercise'));
    const [a, b] = withExercise;
    const { rerender } = render(<LessonView lesson={a} trackId={track.id} />);
    const first = mounts.exercise.length;
    rerender(<LessonView lesson={b} trackId={track.id} />);
    expect(mounts.exercise.length).toBeGreaterThan(first);
  });

  it('moves focus to the lesson heading when a lesson opens', () => {
    render(<LessonView lesson={lesson} trackId={track.id} />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('parks the lesson so the chooser can send the learner back', () => {
    useLearnStore.setState({ currentTrackId: track.id, currentLessonId: lesson.id });
    useLearnSectionStore.setState({ section: 'concepts' });
    render(<LessonView lesson={lesson} trackId={track.id} />);
    act(() => useLearnStore.setState({ currentBlockIndex: 2 }));
    fireEvent.click(screen.getByRole('button', { name: /Tracks/ }));
    expect(useLearnSectionStore.getState().returnTo).toEqual({ trackId: track.id, lessonId: lesson.id, blockIndex: 2 });
    expect(useLearnSectionStore.getState().section).toBe('tracks');
  });

  it('scrolls to the remembered block when restoring', () => {
    useLearnSectionStore.setState({ restore: { trackId: track.id, lessonId: lesson.id, blockIndex: 1 } });
    render(<LessonView lesson={lesson} trackId={track.id} />);
    return new Promise<void>((resolve) => requestAnimationFrame(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
      expect(useLearnSectionStore.getState().restore).toBeNull();
      resolve();
    }));
  });

  it('still restores the reading position under StrictMode remounts', async () => {
    useLearnSectionStore.setState({ restore: { trackId: track.id, lessonId: lesson.id, blockIndex: 1 } });
    const scrollSpy = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scrollSpy.mockClear?.();
    render(<StrictMode><LessonView lesson={lesson} trackId={track.id} /></StrictMode>);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(scrollSpy).toHaveBeenCalled();
    expect(useLearnSectionStore.getState().restore).toBeNull();
  });

  it('activates a block when its top crosses a line about 30% down the reader, not when a sliver is visible', () => {
    render(<LessonView lesson={lesson} trackId={track.id} />);
    expect(observed[0]?.rootMargin).toBe('-30% 0px -60% 0px');
  });
});

describe('LessonView completion', () => {
  it('turns the up-next card into a completion acknowledgement', () => {
    useLearnStore.setState({ completedLessons: [lesson.id] });
    render(<LessonView lesson={lesson} trackId={track.id} />);
    expect(screen.getByText(/Lesson complete/).textContent).toMatch(/1 of \d+/);
    expect(screen.getByRole('button', { name: 'Next lesson' })).toBeTruthy();
  });

  it('keeps the plain up-next card before the lesson is done', () => {
    render(<LessonView lesson={lesson} trackId={track.id} />);
    expect(screen.queryByText(/Lesson complete/)).toBeNull();
    expect(screen.getByText('Up next')).toBeTruthy();
  });
});
