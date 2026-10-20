// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealTerminalError } from './revealTerminalError';

afterEach(() => { document.body.innerHTML = ''; });

describe('revealTerminalError', () => {
  it('scrolls to the last error line and moves focus into the terminal output', () => {
    document.body.innerHTML = '<div data-terminal-output tabindex="-1"><div data-terminal-error id="a"></div><div data-terminal-error id="b"></div></div>';
    const scroll = vi.fn();
    (document.getElementById('b') as HTMLElement).scrollIntoView = scroll;
    expect(revealTerminalError()).toBe(true);
    expect(scroll).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(document.querySelector('[data-terminal-output]'));
  });

  it('still focuses the output when there is no error line, and reports false without a terminal', () => {
    expect(revealTerminalError()).toBe(false);
    document.body.innerHTML = '<div data-terminal-output tabindex="-1"></div>';
    expect(revealTerminalError()).toBe(true);
  });
});
