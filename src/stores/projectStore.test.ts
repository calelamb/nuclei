import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

describe('projectStore tabs', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projectRoot: null,
      tabs: [],
      activeTabPath: null,
    });
  });

  it('starts with no tabs and no active tab', () => {
    const s = useProjectStore.getState();
    expect(s.tabs).toEqual([]);
    expect(s.activeTabPath).toBeNull();
  });

  it('openTab adds a tab and activates it', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    const s = useProjectStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].path).toBe('/p/a.py');
    expect(s.tabs[0].content).toBe('x');
    expect(s.tabs[0].isDirty).toBe(false);
    expect(s.activeTabPath).toBe('/p/a.py');
  });

  it('openTab on an already-open path just reactivates it', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().openTab({ path: '/p/b.py', content: 'y' });
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'stale-ignored' });
    const s = useProjectStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.activeTabPath).toBe('/p/a.py');
    expect(s.tabs.find((t) => t.path === '/p/a.py')?.content).toBe('x');
  });

  it('updateActiveTabContent marks the active tab dirty', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().updateActiveTabContent('x\nprint(1)');
    const tab = useProjectStore.getState().tabs[0];
    expect(tab.content).toBe('x\nprint(1)');
    expect(tab.isDirty).toBe(true);
  });

  it('markTabSaved clears dirty and stores saved content', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().updateActiveTabContent('y');
    useProjectStore.getState().markTabSaved('/p/a.py', 'y');
    const tab = useProjectStore.getState().tabs[0];
    expect(tab.isDirty).toBe(false);
    expect(tab.content).toBe('y');
  });

  it('closeTab removes the tab and keeps the current active if different', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().openTab({ path: '/p/b.py', content: 'y' });
    useProjectStore.getState().openTab({ path: '/p/c.py', content: 'z' });
    useProjectStore.getState().closeTab('/p/b.py');
    const s = useProjectStore.getState();
    expect(s.tabs.map((t) => t.path)).toEqual(['/p/a.py', '/p/c.py']);
    expect(s.activeTabPath).toBe('/p/c.py');
  });

  it('closeTab on the active tab picks the previous as new active', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().openTab({ path: '/p/b.py', content: 'y' });
    useProjectStore.getState().closeTab('/p/b.py');
    expect(useProjectStore.getState().activeTabPath).toBe('/p/a.py');
  });

  it('closing the last tab leaves activeTabPath null', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().closeTab('/p/a.py');
    const s = useProjectStore.getState();
    expect(s.tabs).toEqual([]);
    expect(s.activeTabPath).toBeNull();
  });

  it('setProjectRoot updates root and keeps tabs', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().setProjectRoot('/p');
    expect(useProjectStore.getState().projectRoot).toBe('/p');
    expect(useProjectStore.getState().tabs).toHaveLength(1);
  });

  it('renameTab updates path on a single tab', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().renameTab('/p/a.py', '/p/aa.py');
    const s = useProjectStore.getState();
    expect(s.tabs[0].path).toBe('/p/aa.py');
    expect(s.activeTabPath).toBe('/p/aa.py');
  });

  it('hasAnyDirty returns true when any tab is dirty', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    expect(useProjectStore.getState().hasAnyDirty()).toBe(false);
    useProjectStore.getState().updateActiveTabContent('y');
    expect(useProjectStore.getState().hasAnyDirty()).toBe(true);
  });
});
