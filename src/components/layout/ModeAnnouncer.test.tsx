// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { ModeAnnouncer } from './PanelLayout';
import { useModeSwitchStore } from '../../stores/modeSwitchStore';

afterEach(cleanup);

describe('ModeAnnouncer (S-25)', () => {
  it('is a polite live region using the shared visually-hidden class', () => {
    const { container } = render(<ModeAnnouncer />);
    const region = container.firstElementChild as HTMLElement;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.className).toContain('nuclei-sr-only');
    act(() => { useModeSwitchStore.setState({ announcement: 'Switched to Research mode' }); });
    expect(region.textContent).toBe('Switched to Research mode');
  });

  it('the hidden class is anchored at the origin so it cannot grow the page scroll area', () => {
    const css = readFileSync(join(__dirname, '../ui/ui.css'), 'utf8');
    const rule = css.match(/\.nuclei-sr-only\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/top:\s*0/);
    expect(rule).toMatch(/left:\s*0/);
  });
});
