// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusAfterViewSelect, focusNavLanding, focusVizLanding, NAV_LANDING_ATTR, TAKEOVER_ATTR, VIZ_LANDING_ATTR } from './focusViz';

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

describe('focusAfterViewSelect', () => {
  it('a newer keyboard route cancels the older one, so a stale takeover poll never steals focus later', async () => {
    focusAfterViewSelect('learning');
    focusAfterViewSelect('files');
    const heading = document.createElement('h2');
    heading.setAttribute(NAV_LANDING_ATTR, '');
    heading.tabIndex = -1;
    document.body.append(heading);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(document.activeElement).toBe(heading);
    const takeover = document.createElement('section');
    takeover.setAttribute(TAKEOVER_ATTR, '');
    takeover.append(document.createElement('h1'));
    document.body.append(takeover);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(document.activeElement).toBe(heading);
  });
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('takeover routing (shell-r9-01, shell-r9-02)', () => {
  it('lands on the NEW takeover heading, not the previous takeover that is still mounted', async () => {
    const old = document.createElement('div');
    old.setAttribute(TAKEOVER_ATTR, 'learning');
    old.innerHTML = '<h1>Learn quantum computing</h1>';
    document.body.append(old);
    focusAfterViewSelect('challenges');
    await wait(60);
    expect(document.activeElement).toBe(document.body);
    old.remove();
    const next = document.createElement('div');
    next.setAttribute(TAKEOVER_ATTR, 'challenges');
    next.innerHTML = '<h2>Quantum problem set</h2>';
    document.body.append(next);
    await wait(80);
    expect(document.activeElement).toBe(next.querySelector('h2'));
  });

  it('re-lands when the heading it focused is unmounted before the page settles', async () => {
    const first = document.createElement('div');
    first.setAttribute(TAKEOVER_ATTR, 'challenges');
    first.innerHTML = '<h2>Skeleton</h2>';
    document.body.append(first);
    focusAfterViewSelect('challenges');
    await wait(40);
    first.remove();
    const second = document.createElement('div');
    second.setAttribute(TAKEOVER_ATTR, 'challenges');
    second.innerHTML = '<h2>Quantum problem set</h2>';
    document.body.append(second);
    await wait(120);
    expect(document.activeElement).toBe(second.querySelector('h2'));
  });

  it('leaving a takeover waits for it to unmount and wins focus back from the editor', async () => {
    const takeover = document.createElement('div');
    takeover.setAttribute(TAKEOVER_ATTR, 'learning');
    document.body.append(takeover);
    focusAfterViewSelect('launch');
    await wait(60);
    const heading = document.createElement('h2');
    heading.setAttribute(NAV_LANDING_ATTR, '');
    document.body.append(heading);
    await wait(60);
    expect(document.activeElement).toBe(document.body); // takeover still mounted: do not trust the landing yet
    takeover.remove();
    await wait(80);
    expect(document.activeElement).toBe(heading);
    const editor = document.createElement('textarea');
    document.body.append(editor);
    const monaco = document.createElement('div');
    monaco.className = 'monaco-editor';
    monaco.append(editor);
    document.body.append(monaco);
    editor.focus();
    await wait(80);
    expect(document.activeElement).toBe(heading);
  });

  it('falls back to a pane-header title when the view has no sidebar (web QEC Workbench)', async () => {
    const header = document.createElement('div');
    header.className = 'nuclei-pane-header';
    header.innerHTML = '<h1>QEC Workbench</h1>';
    document.body.append(header);
    focusAfterViewSelect('qec');
    await wait(250);
    expect(document.activeElement).toBe(header.querySelector('h1'));
    expect(header.querySelector('h1')?.getAttribute('tabindex')).toBe('-1');
  });
});
