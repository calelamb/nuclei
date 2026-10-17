// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { useFocusTrap } from './useFocusTrap';

function Harness({ restore = true }: { restore?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, { restoreFocus: restore });
  return (
    <div ref={ref}>
      <button>one</button>
      <button>two</button>
      <button>three</button>
    </div>
  );
}

afterEach(cleanup);

describe('useFocusTrap', () => {
  it('focuses the first focusable element on mount', () => {
    render(<Harness />);
    expect(document.activeElement).toBe(screen.getByText('one'));
  });

  it('wraps Tab from the last element to the first', () => {
    render(<Harness />);
    screen.getByText('three').focus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('one'));
  });

  it('wraps Shift+Tab from the first element to the last', () => {
    render(<Harness />);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('three'));
  });

  it('pulls focus back in when it escapes the container', () => {
    render(
      <>
        <button>outside</button>
        <Harness />
      </>,
    );
    screen.getByText('outside').focus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('one'));
  });

  it('restores focus to the previously focused element on unmount', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<Harness />);
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
