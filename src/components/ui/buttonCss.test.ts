// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'ui.css'), 'utf8');
const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('primary button identity', () => {
  it('is teal in both themes: light uses the AA accent-text teal with white text', () => {
    const light = rule(":root[data-theme='light'] .nuclei-btn.nuclei-btn--primary:not(:disabled)");
    expect(light).toContain('background: var(--color-accent-quantum-text)');
    expect(light).toContain('color: #fff');
    expect(light).not.toContain('--color-text-primary');
  });

  it('never puts white text on the raw light teal fill when hovered', () => {
    const hover = rule(":root[data-theme='light'] .nuclei-btn.nuclei-btn--primary:hover:not(:disabled)");
    expect(hover).not.toMatch(/background:\s*var\(--color-accent-quantum\)/);
  });

  it('has a pressed state', () => {
    expect(rule(".nuclei-btn.nuclei-btn--primary:active:not(:disabled):not([aria-busy='true'])")).toContain('brightness');
  });

  it('renders disabled primary as a neutral surface, not faded teal', () => {
    const disabled = rule('.nuclei-btn.nuclei-btn--primary:disabled');
    expect(disabled).toContain('--color-surface-overlay');
    expect(disabled).toContain('--color-text-disabled');
    expect(disabled).toContain('opacity: 1');
  });
});

describe('disabled primary under the light theme (cascade)', () => {
  it('does not paint the teal fill on a disabled primary button', () => {
    const style = document.createElement('style');
    style.textContent = css.replace(/var\(--[\w-]+\)/g, (m) => (m.includes('surface-overlay') ? 'rgb(1, 2, 3)' : 'rgb(9, 9, 9)'));
    document.head.appendChild(style);
    document.documentElement.setAttribute('data-theme', 'light');
    const btn = document.createElement('button');
    btn.className = 'nuclei-btn nuclei-btn--primary';
    btn.disabled = true;
    document.body.appendChild(btn);
    expect(getComputedStyle(btn).backgroundColor).toBe('rgb(1, 2, 3)');
    btn.remove();
    style.remove();
    document.documentElement.removeAttribute('data-theme');
  });
});

describe('menu hints', () => {
  it('keeps at least 24px (gap + margin) between a label and its hint so they do not read as one phrase', () => {
    const item = rule('.nuclei-menu__item');
    const hint = rule('.nuclei-menu__hint');
    expect(item).toContain('gap: var(--space-2)');
    expect(hint).toMatch(/margin-left:\s*var\(--space-4\)/);
  });
});
