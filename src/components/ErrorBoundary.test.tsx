// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(cleanup);

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error('monaco exploded');
  return <p>fine</p>;
}

describe('ErrorBoundary', () => {
  it('renders a themed fallback with no hard-coded colours and a primary Retry button', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = render(<ErrorBoundary label="Editor"><Boom fail /></ErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('Editor failed to load');
    expect(screen.getByText('monaco exploded')).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(screen.getByRole('button', { name: 'Retry' }).className).toContain('nuclei-btn--primary');
  });

  it('retry remounts the subtree', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail = true;
    function Flaky() { return <Boom fail={fail} />; }
    render(<ErrorBoundary><Flaky /></ErrorBoundary>);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('fine')).toBeTruthy();
  });
});
