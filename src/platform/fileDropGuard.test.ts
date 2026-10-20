// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { installFileDropGuard } from './fileDropGuard';

function fileEvent(type: 'dragover' | 'drop', types: string[]): Event {
  const e = new Event(type, { cancelable: true, bubbles: true });
  Object.defineProperty(e, 'dataTransfer', { value: { types } });
  return e;
}

let dispose: (() => void) | null = null;
afterEach(() => { dispose?.(); dispose = null; });

describe('installFileDropGuard', () => {
  it('cancels file dragover/drop so the webview never navigates to the file', () => {
    dispose = installFileDropGuard(window);
    for (const type of ['dragover', 'drop'] as const) {
      const e = fileEvent(type, ['Files']);
      document.body.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    }
  });

  it('leaves non-file drags (text, links) alone', () => {
    dispose = installFileDropGuard(window);
    const e = fileEvent('drop', ['text/plain']);
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('does not stop propagation, and stops guarding once disposed', () => {
    let reached = false;
    document.body.addEventListener('drop', () => { reached = true; }, { once: true });
    dispose = installFileDropGuard(window);
    document.body.dispatchEvent(fileEvent('drop', ['Files']));
    expect(reached).toBe(true);
    dispose(); dispose = null;
    const e = fileEvent('drop', ['Files']);
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
