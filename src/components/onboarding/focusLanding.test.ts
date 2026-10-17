// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { focusLanding } from './focusLanding';

afterEach(() => { document.body.innerHTML = ''; });

describe('focusLanding', () => {
  it('focuses the lesson heading when a lesson opened', () => {
    document.body.innerHTML = '<h1 class="lesson__title">Qubits</h1><div class="monaco-editor"><textarea></textarea></div>';
    expect(focusLanding()).toBe(true);
    expect(document.activeElement?.textContent).toBe('Qubits');
  });

  it('focuses the track chooser heading when no lesson is open', () => {
    document.body.innerHTML = '<h1 class="tracks__title">Learn</h1><div class="monaco-editor"><textarea></textarea></div>';
    focusLanding();
    expect(document.activeElement?.className).toBe('tracks__title');
  });

  it('falls back to the editor', () => {
    document.body.innerHTML = '<div class="monaco-editor"><textarea id="ed"></textarea></div>';
    focusLanding();
    expect(document.activeElement?.id).toBe('ed');
  });

  it('reports false when nothing is focusable', () => {
    expect(focusLanding()).toBe(false);
  });
});
