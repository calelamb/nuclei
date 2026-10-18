// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusNavLanding, focusVizLanding, NAV_LANDING_ATTR, VIZ_LANDING_ATTR } from './focusViz';

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

  it('moves keyboard navigation focus to the sidebar heading, not leaving it in the editor', async () => {
    const editor = document.createElement('textarea');
    document.body.append(editor);
    editor.focus();
    focusNavLanding();
    const heading = document.createElement('h2');
    heading.tabIndex = -1;
    heading.setAttribute(NAV_LANDING_ATTR, '');
    document.body.append(heading);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(document.activeElement).toBe(heading);
  });
});
