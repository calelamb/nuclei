// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VideoLibrary } from './VideoLibrary';
import { CURATED_VIDEOS } from '../../data/videos/curatedLibrary';

afterEach(cleanup);

describe('VideoLibrary rail', () => {
  it('filters creators with a Select (chips were clipped at "Qiskit") and keeps every creator reachable', () => {
    render(<VideoLibrary />);
    const select = screen.getByRole('combobox', { name: 'Creator' });
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['All creators', '3Blue1Brown', 'IBM', 'NVIDIA', 'Qiskit']);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('shows each video as a compact row: thumbnail, a two-line title and the creator, no description', () => {
    render(<VideoLibrary />);
    const row = document.querySelector('.vrow') as HTMLElement;
    expect(row.querySelector('.vrow__thumb')).toBeTruthy();
    expect(row.querySelector('.vrow__title')?.textContent).toBeTruthy();
    expect(row.querySelector('.vrow__creator')?.textContent).toBeTruthy();
    expect(row.querySelector('.vrow__desc')).toBeNull();
  });

  it('shares the creator and level filters with the chooser shelf', () => {
    render(<VideoLibrary />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Creator' }), { target: { value: 'nvidia' } });
    const nvidia = CURATED_VIDEOS.filter((v) => v.creator === 'nvidia');
    expect(screen.getByText(`${nvidia.length} video${nvidia.length === 1 ? '' : 's'}`)).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Difficulty' }), { target: { value: 'advanced' } });
    const narrowed = nvidia.filter((v) => v.difficulty === 'advanced');
    expect(screen.getByLabelText('Difficulty')).toBeTruthy();
    expect(document.querySelectorAll('.vrow').length).toBe(narrowed.length);
  });
});
