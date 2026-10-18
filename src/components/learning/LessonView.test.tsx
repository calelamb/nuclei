// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, render, cleanup, screen, fireEvent } from '@testing-library/react';
import { LessonView } from './LessonView';
import { useLearnStore } from '../../stores/learnStore';
import { useLearnSectionStore } from './learnSectionStore';
import { TRACKS } from '../../data/lessons/tracks';

vi.mock('./InteractiveDemo', () => ({ InteractiveDemo: () => <div /> }));
vi.mock('./ExerciseBlock', () => ({ ExerciseBlock: () => <div /> }));
vi.mock('./VideoPlayer', () => ({ VideoPlayer: () => <div /> }));
vi.mock('./InteractiveBlochSphere', () => ({ InteractiveBlochSphere: () => <div /> }));

class NoopObserver { observe() {} disconnect() {} unobserve() {} }
const track = TRACKS.find((t) => t.lessons.length > 1)!;
const lesson = track.lessons[0];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('IntersectionObserver', NoopObserver);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  useLearnSectionStore.setState({ returnTo: null, restore: null });
  useLearnStore.setState({ completedLessons: [], lessonProgress: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LessonView', () => {
  it('moves focus to the lesson heading when a lesson opens', () => {
    render(<LessonView lesson={lesson} trackId={track.id} />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('parks the lesson so the chooser can send the learner back', () => {
    useLearnStore.setState({ currentTrackId: track.id, currentLessonId: lesson.id });
    render(<LessonView lesson={lesson} trackId={track.id} />);
    act(() => useLearnStore.setState({ currentBlockIndex: 2 }));
    fireEvent.click(screen.getByRole('button', { name: /Tracks/ }));
    expect(useLearnSectionStore.getState().returnTo).toEqual({ trackId: track.id, lessonId: lesson.id, blockIndex: 2 });
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
});
