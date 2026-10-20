// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QecWorkbench } from './QecWorkbench';
import { resetQecWorkbenchTestState } from './qecWorkbenchTestUtils';

type Listener = (event: MediaQueryListEvent) => void;
const listeners = new Set<Listener>();

beforeEach(() => {
  resetQecWorkbenchTestState();
  listeners.clear();
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('inspector drawer on resize (qec-r-23)', () => {
  it('closes the open inspector when the window shrinks into the drawer band, and not when it grows back', () => {
    render(<QecWorkbench />);
    expect(screen.getByRole('complementary', { name: 'Research inspector' })).toBeTruthy();

    act(() => { listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent)); });
    expect(screen.queryByRole('complementary', { name: 'Research inspector' })).toBeNull();

    act(() => { listeners.forEach((l) => l({ matches: false } as MediaQueryListEvent)); });
    expect(screen.queryByRole('complementary', { name: 'Research inspector' })).toBeNull();
  });
});
