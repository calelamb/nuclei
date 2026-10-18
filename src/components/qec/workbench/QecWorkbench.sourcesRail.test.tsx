// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QecWorkbench } from './QecWorkbench';
import { resetQecWorkbenchTestState } from './qecWorkbenchTestUtils';

type Listener = (event: MediaQueryListEvent) => void;
const listeners = new Set<Listener>();

function stubMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  })));
}

beforeEach(() => { resetQecWorkbenchTestState(); listeners.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Sources rail on narrow windows (rq-r3-06)', () => {
  it('starts folded to a rail below 1000px so the canvas keeps the width', () => {
    stubMedia(true);
    const { container } = render(<QecWorkbench />);
    expect(container.querySelector('.qec-workbench--sources-collapsed')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Show sources' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('heading', { name: 'Sources / Data' })).toBeNull();
  });

  it('shows the full panel on wide windows and folds on request', () => {
    stubMedia(false);
    const { container } = render(<QecWorkbench />);
    expect(container.querySelector('.qec-workbench--sources-collapsed')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Sources / Data' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide sources' }));
    expect(container.querySelector('.qec-workbench--sources-collapsed')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show sources' }));
    expect(screen.getByRole('heading', { name: 'Sources / Data' })).toBeTruthy();
  });

  it('folds when the window shrinks into the narrow band', () => {
    stubMedia(false);
    const { container } = render(<QecWorkbench />);
    act(() => { listeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent)); });
    expect(container.querySelector('.qec-workbench--sources-collapsed')).not.toBeNull();
  });

  it('shortens the footer to a file count', async () => {
    stubMedia(false);
    render(<QecWorkbench />);
    expect(await screen.findByText('2 files')).toBeTruthy();
    expect(screen.queryByText(/referenced files/)).toBeNull();
  });
});
