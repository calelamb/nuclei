// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { runShortcutOwnedElsewhere } from './runShortcut';

afterEach(() => { document.body.innerHTML = ''; });

function inside(html: string, selector: string): Element {
  document.body.innerHTML = html;
  return document.querySelector(selector) as Element;
}

describe('runShortcutOwnedElsewhere', () => {
  it('is false on the Run button, the rail and the body: the global Run applies there', () => {
    expect(runShortcutOwnedElsewhere(inside('<nav><button id="x">Run</button></nav>', '#x'))).toBe(false);
    expect(runShortcutOwnedElsewhere(document.body)).toBe(false);
    expect(runShortcutOwnedElsewhere(null)).toBe(false);
  });
  it('is true inside Monaco, which binds the chord itself', () => {
    expect(runShortcutOwnedElsewhere(inside('<div class="monaco-editor"><textarea id="x"></textarea></div>', '#x'))).toBe(true);
  });
  it('is true inside dialogs and Dirac panel inputs', () => {
    expect(runShortcutOwnedElsewhere(inside('<div role="dialog" aria-modal="true"><input id="x"></div>', '#x'))).toBe(true);
    expect(runShortcutOwnedElsewhere(inside('<div data-dirac-panel=""><textarea id="x"></textarea></div>', '#x'))).toBe(true);
  });
});

describe('runShortcutHiddenEditor', () => {
  it('blocks the chord while any takeover hides the editor', async () => {
    const { runShortcutHiddenEditor } = await import('./runShortcut');
    for (const kind of ['lesson', 'challenge', 'qec', 'transpiler', 'experiment'] as const) {
      expect(runShortcutHiddenEditor(kind)).toBe(true);
    }
    expect(runShortcutHiddenEditor(null)).toBe(false);
  });
});
