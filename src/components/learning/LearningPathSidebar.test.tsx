// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LearningPathSidebar } from './LearningPathSidebar';
import { Sidebar } from '../layout/Sidebar';

afterEach(cleanup);

describe('Learning sidebar tabs', () => {
  it('is one strip: Tracks, Concepts, Capstones, Glossary and Videos', () => {
    render(<LearningPathSidebar />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Tracks', 'Concepts', 'Capstones', 'Glossary', 'Videos']);
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
  });

  it('opens the video library in the same strip', async () => {
    render(<LearningPathSidebar />);
    fireEvent.click(screen.getByRole('tab', { name: 'Videos' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Creator' })).toBeTruthy());
  });

  it('the activity-rail Learning view renders that one strip, not a second Tracks|Videos strip above it', async () => {
    render(<Sidebar view="learning" width={240} onWidthChange={() => undefined} />);
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBe(5));
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
  });
});
