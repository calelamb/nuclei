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

function RovingHarness() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, { autoFocus: false });
  return (
    <div ref={ref}>
      <input aria-label="query" />
      <div role="listbox" tabIndex={-1}>
        <button tabIndex={-1}>option a</button>
        <button tabIndex={-1}>option b</button>
      </div>
    </div>
  );
}

describe('useFocusTrap with roving (tabindex=-1) descendants', () => {
  it('ignores them as wrap boundaries: Tab and Shift+Tab never reach body or an option', () => {
    render(<RovingHarness />);
    const input = screen.getByLabelText('query');
    input.focus();
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(document.activeElement).toBe(input);
  });

  it('pulls focus from a non-tabbable inner node back into the Tab order', () => {
    render(<RovingHarness />);
    screen.getByText('option b').focus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByLabelText('query'));
    expect(document.activeElement).not.toBe(document.body);
  });
});
