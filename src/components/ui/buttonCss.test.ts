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
    const light = rule(":root[data-theme='light'] .nuclei-btn.nuclei-btn--primary");
    expect(light).toContain('background: var(--color-accent-quantum-text)');
    expect(light).toContain('color: #fff');
    expect(light).not.toContain('--color-text-primary');
  });

  it('never puts white text on the raw light teal fill when hovered', () => {
    const hover = rule(":root[data-theme='light'] .nuclei-btn.nuclei-btn--primary:hover:not(:disabled)");
    expect(hover).not.toMatch(/background:\s*var\(--color-accent-quantum\)/);
  });

  it('has a pressed state', () => {
    expect(rule('.nuclei-btn.nuclei-btn--primary:active:not(:disabled)')).toContain('brightness');
  });

  it('renders disabled primary as a neutral surface, not faded teal', () => {
    const disabled = rule('.nuclei-btn.nuclei-btn--primary:disabled');
    expect(disabled).toContain('--color-surface-overlay');
    expect(disabled).toContain('--color-text-disabled');
    expect(disabled).toContain('opacity: 1');
  });
});
