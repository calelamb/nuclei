// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import { TrackSelector } from './TrackSelector';
import { useLearnStore } from '../../stores/learnStore';
import { useLearnSectionStore } from './learnSectionStore';
import { TRACKS } from '../../data/lessons/tracks';
import { CURATED_VIDEOS } from '../../data/videos/curatedLibrary';

beforeEach(() => {
  localStorage.clear();
  useLearnSectionStore.setState({ section: 'tracks', returnTo: null, restore: null });
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

  it('gives Concepts, Capstones, Glossary and Videos a mouse entry point (LR-05)', () => {
    render(<TrackSelector />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Tracks', 'Concepts', 'Capstones', 'Glossary', 'Videos']);
    fireEvent.click(screen.getByRole('tab', { name: 'Glossary' }));
    expect(screen.getByLabelText('Search glossary terms')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Capstones' }));
    expect(screen.getByRole('tabpanel', { name: 'Capstones' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Videos' }));
    expect(screen.getByRole('region', { name: 'Video Library' })).toBeTruthy();
  });

  it('filters the video shelf by creator with a keyboard-operable radio group', () => {
    useLearnSectionStore.setState({ section: 'videos' });
    render(<TrackSelector />);
    const shelf = screen.getByRole('region', { name: 'Video Library' });
    const all = within(shelf).getAllByRole('button').length;
    fireEvent.click(within(shelf).getByRole('radio', { name: 'NVIDIA' }));
    const nvidia = CURATED_VIDEOS.filter((v) => v.creator === 'nvidia').length;
    expect(within(shelf).getAllByRole('button').length).toBe(nvidia);
    expect(nvidia).toBeLessThan(all);
  });

  it('offers a way back to the lesson the learner left, and reopens it at the same spot', () => {
    const track = TRACKS.find((t) => t.lessons.length > 2)!;
    const lesson = track.lessons[2];
    const setCurrentLesson = vi.fn();
    useLearnStore.setState({ setCurrentLesson });
    useLearnSectionStore.setState({ section: 'glossary', returnTo: { trackId: track.id, lessonId: lesson.id, blockIndex: 4 } });
    render(<TrackSelector />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Back to lesson 3.*${lesson.title}`) }));
    expect(setCurrentLesson).toHaveBeenCalledWith(track.id, lesson.id);
    expect(useLearnSectionStore.getState().returnTo).toBeNull();
    expect(useLearnSectionStore.getState().restore).toEqual({ trackId: track.id, lessonId: lesson.id, blockIndex: 4 });
  });

  it('resumes a track at the lesson the learner was reading rather than the first incomplete one', () => {
    const setCurrentLesson = vi.fn();
    const track = TRACKS.find((t) => t.lessons.length > 2)!;
    useLearnStore.setState({ setCurrentLesson });
    useLearnSectionStore.setState({ returnTo: { trackId: track.id, lessonId: track.lessons[2].id, blockIndex: 0 } });
    render(<TrackSelector />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(track.title) }));
    expect(setCurrentLesson).toHaveBeenCalledWith(track.id, track.lessons[2].id);
  });
});
