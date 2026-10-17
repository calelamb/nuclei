// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import { TrackSelector } from './TrackSelector';
import { useLearnStore } from '../../stores/learnStore';
import { TRACKS } from '../../data/lessons/tracks';
import { CURATED_VIDEOS } from '../../data/videos/curatedLibrary';

beforeEach(() => {
  localStorage.clear();
  useLearnStore.setState({ completedLessons: [], lessonProgress: {}, currentTrackId: null, currentLessonId: null });
});
afterEach(cleanup);

describe('TrackSelector', () => {
  it('lists every track as a native button and opens the first lesson', () => {
    const setCurrentLesson = vi.fn();
    useLearnStore.setState({ setCurrentLesson });
    render(<TrackSelector />);
    const track = TRACKS.find((t) => t.lessons.length > 0);
    expect(track).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(track!.title) }));
    expect(setCurrentLesson).toHaveBeenCalledWith(track!.id, track!.lessons[0].id);
  });

  it('resumes at the first incomplete lesson', () => {
    const setCurrentLesson = vi.fn();
    const track = TRACKS.find((t) => t.lessons.length > 1)!;
    useLearnStore.setState({ setCurrentLesson, completedLessons: [track.lessons[0].id] });
    render(<TrackSelector />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(track.title) }));
    expect(setCurrentLesson).toHaveBeenCalledWith(track.id, track.lessons[1].id);
  });

  it('filters the video shelf by creator with a keyboard-operable radio group', () => {
    render(<TrackSelector />);
    const shelf = screen.getByRole('region', { name: 'Video Library' });
    const all = within(shelf).getAllByRole('button').length;
    fireEvent.click(within(shelf).getByRole('radio', { name: 'NVIDIA' }));
    const nvidia = CURATED_VIDEOS.filter((v) => v.creator === 'nvidia').length;
    expect(within(shelf).getAllByRole('button').length).toBe(nvidia);
    expect(nvidia).toBeLessThan(all);
  });
});
