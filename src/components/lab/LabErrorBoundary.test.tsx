// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LabErrorBoundary } from './LabErrorBoundary';

afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new TypeError('x is not iterable');
  return <p>healthy panel</p>;
}

describe('LabErrorBoundary', () => {
  it('shows the designed error state instead of unmounting the app', () => {
    shouldThrow = true;
    render(
      <div>
        <p>rest of the app</p>
        <LabErrorBoundary label="Scaling">
          <Bomb />
        </LabErrorBoundary>
      </div>,
    );
    expect(screen.getByText('rest of the app')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('This panel hit an error')).toBeTruthy();
    expect(screen.getByText(/TypeError: x is not iterable/)).toBeTruthy();
  });

  it('Reload panel re-renders the children', () => {
    shouldThrow = true;
    render(
      <LabErrorBoundary>
        <Bomb />
      </LabErrorBoundary>,
    );
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /Reload panel/ }));
    expect(screen.getByText('healthy panel')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears automatically when a reset key changes', () => {
    shouldThrow = true;
    const { rerender } = render(
      <LabErrorBoundary resetKeys={['a']}>
        <Bomb />
      </LabErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    shouldThrow = false;
    rerender(
      <LabErrorBoundary resetKeys={['b']}>
        <Bomb />
      </LabErrorBoundary>,
    );
    expect(screen.getByText('healthy panel')).toBeTruthy();
  });
});
