// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OpenFilesSection } from './OpenFilesSection';
import { useProjectStore } from '../../stores/projectStore';

const tab = (path: string) => ({ path, isDirty: false }) as never;

beforeEach(() => {
  window.localStorage.clear();
  useProjectStore.setState({ tabs: [], activeTabPath: null });
});
afterEach(cleanup);

describe('OpenFilesSection (research-r-01)', () => {
  it('renders the same header whether or not a file is open, so the tree never shifts', () => {
    const { container, rerender } = render(<OpenFilesSection />);
    const before = container.querySelector('.open-files__header')?.outerHTML.replace(/\(\d+\)/, '');
    useProjectStore.setState({ tabs: [tab('/p/bell.py')], activeTabPath: '/p/bell.py' });
    rerender(<OpenFilesSection />);
    expect(container.querySelector('.open-files__header')?.outerHTML.replace(/\(\d+\)/, '')).toBe(before);
    expect(container.querySelector('.open-files__list')).toBeNull();
  });

  it('is collapsed by default and remembers when the person expands it', () => {
    useProjectStore.setState({ tabs: [tab('/p/bell.py')], activeTabPath: '/p/bell.py' });
    const { unmount } = render(<OpenFilesSection />);
    expect(screen.getByRole('button', { name: /Open files/ }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /Open files/ }));
    expect(screen.getByTitle('/p/bell.py')).toBeTruthy();
    unmount();
    render(<OpenFilesSection />);
    expect(screen.getByRole('button', { name: /Open files/ }).getAttribute('aria-expanded')).toBe('true');
  });
});
