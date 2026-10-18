// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VideoLibrary } from './VideoLibrary';
import { CURATED_VIDEOS } from '../../data/videos/curatedLibrary';

afterEach(cleanup);

describe('VideoLibrary rail', () => {
  it('uses the shared Tabs for creators and names the abbreviated tab in full', () => {
    render(<VideoLibrary />);
    const tablist = screen.getByRole('tablist', { name: 'Creator' });
    expect(tablist.className).toContain('nuclei-tabs');
    expect(screen.getByRole('tab', { name: '3Blue1Brown' })).toBeTruthy();
  });

  it('shares the creator and level filters with the chooser shelf', () => {
    render(<VideoLibrary />);
    fireEvent.click(screen.getByRole('tab', { name: 'NVIDIA' }));
    const nvidia = CURATED_VIDEOS.filter((v) => v.creator === 'nvidia');
    expect(screen.getByText(`${nvidia.length} video${nvidia.length === 1 ? '' : 's'}`)).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Difficulty' }), { target: { value: 'advanced' } });
    const narrowed = nvidia.filter((v) => v.difficulty === 'advanced');
    expect(screen.getByLabelText('Difficulty')).toBeTruthy();
    expect(document.querySelectorAll('.vrow').length).toBe(narrowed.length);
  });
});
