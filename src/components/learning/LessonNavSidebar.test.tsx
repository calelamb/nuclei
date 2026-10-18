// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { LessonNavSidebar } from './LessonNavSidebar';
import { useLearnStore } from '../../stores/learnStore';
import { useLearnSectionStore } from './learnSectionStore';
import { TRACKS } from '../../data/lessons/tracks';

const track = TRACKS.find((t) => t.lessons.length > 0)!;

beforeEach(() => {
  localStorage.clear();
  useLearnSectionStore.setState({ section: 'tracks' });
  useLearnStore.setState({ currentTrackId: track.id, currentLessonId: track.lessons[0].id, completedLessons: [] });
});
afterEach(cleanup);

describe('LessonNavSidebar section links (LR-05)', () => {
  it('offers Concepts, Capstones, Glossary and Videos from inside a lesson', () => {
    render(<LessonNavSidebar collapsed={false} onToggleCollapsed={() => {}} />);
    const group = screen.getByRole('group', { name: 'More ways to learn' });
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Concepts', 'Capstones', 'Glossary', 'Videos']);
  });

  it('leaves the lesson for the chosen section', () => {
    render(<LessonNavSidebar collapsed={false} onToggleCollapsed={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Glossary' }));
    expect(useLearnSectionStore.getState().section).toBe('glossary');
    expect(useLearnStore.getState().currentLessonId).toBeNull();
  });

  it('remembers the lesson and reading position it was parked at', () => {
    useLearnStore.setState({ currentBlockIndex: 3 });
    render(<LessonNavSidebar collapsed={false} onToggleCollapsed={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Glossary' }));
    expect(useLearnSectionStore.getState().returnTo).toEqual({ trackId: track.id, lessonId: track.lessons[0].id, blockIndex: 3 });
  });
});
