// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
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

describe('keyboard entry to a chooser section', () => {
  it('lands focus on the chooser heading instead of the body', () => {
    vi.useFakeTimers();
    try {
      render(<LessonNavSidebar collapsed={false} onToggleCollapsed={() => {}} />);
      const heading = document.createElement('h1');
      heading.className = 'tracks__title';
      document.body.appendChild(heading);

      const link = screen.getByRole('button', { name: 'Glossary' });
      link.focus();
      fireEvent.click(link);
      act(() => { vi.advanceTimersByTime(400); });

      expect(document.activeElement).toBe(heading);
      heading.remove();
    } finally {
      vi.useRealTimers();
    }
  });
});

function Harness() {
  const [collapsed, setCollapsed] = useState(false);
  return <LessonNavSidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />;
}

describe('hide / show hand-off', () => {
  it('hands focus between the Hide and Show buttons instead of dropping it to <body>', async () => {
    render(<Harness />);
    const hide = screen.getByRole('button', { name: 'Hide lesson navigation' });
    act(() => { hide.focus(); });
    fireEvent.click(hide);
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    const show = screen.getByRole('button', { name: 'Show lesson navigation' });
    expect(document.activeElement).toBe(show);
    fireEvent.click(show);
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hide lesson navigation' }));
  });

  it('leaves focus alone when the toggle was not focused (a mouse click elsewhere)', async () => {
    render(<Harness />);
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Hide lesson navigation' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
