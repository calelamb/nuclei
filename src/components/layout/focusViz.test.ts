// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusVizLanding, VIZ_LANDING_ATTR } from './focusViz';

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

describe('focusVizLanding', () => {
  it('focuses the landing element once the column has mounted (focus never stays on body)', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    focusVizLanding();
    const section = document.createElement('section');
    section.tabIndex = -1;
    section.setAttribute(VIZ_LANDING_ATTR, '');
    document.body.append(section);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(document.activeElement).toBe(section);
  });

  it('gives up quietly when no landing element ever appears', async () => {
    focusVizLanding();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(document.activeElement).toBe(document.body);
  });

  it('can be cancelled', async () => {
    const cancel = focusVizLanding();
    cancel();
    const section = document.createElement('section');
    section.tabIndex = -1;
    section.setAttribute(VIZ_LANDING_ATTR, '');
    document.body.append(section);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(document.activeElement).toBe(document.body);
  });
});
