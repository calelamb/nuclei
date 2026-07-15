import { describe, it, expect, beforeEach, vi } from 'vitest';

// getFileOps is only reached inside the save callback (not exercised here), so
// a null stub keeps the App module out of the test.
vi.mock('../App', () => ({ getFileOps: () => null }));

import { requestCloseTab } from './tabClose';
import { useProjectStore } from '../stores/projectStore';
import { useDialogStore } from '../stores/dialogStore';

function seedTab(over: { path: string; isDirty: boolean; content?: string }) {
  useProjectStore.setState({
    tabs: [{ path: over.path, content: over.content ?? '', isDirty: over.isDirty }],
    activeTabPath: over.path,
  });
}

describe('requestCloseTab', () => {
  beforeEach(() => {
    useProjectStore.setState({ tabs: [], activeTabPath: null });
    useDialogStore.setState({ pendingClose: null });
  });

  it('raises the unsaved-changes dialog for a dirty tab instead of dropping it', () => {
    seedTab({ path: '/proj/bell.py', isDirty: true, content: 'qc.h(0)' });
    requestCloseTab('/proj/bell.py');

    const pending = useDialogStore.getState().pendingClose;
    expect(pending).not.toBeNull();
    expect(pending?.fileName).toBe('bell.py');
    // The buffer is NOT closed until the user answers the dialog.
    expect(useProjectStore.getState().tabs).toHaveLength(1);
  });

  it('closes a clean tab directly, no dialog', () => {
    seedTab({ path: '/proj/clean.py', isDirty: false });
    requestCloseTab('/proj/clean.py');

    expect(useDialogStore.getState().pendingClose).toBeNull();
    expect(useProjectStore.getState().tabs).toHaveLength(0);
  });

  it('is a no-op for an unknown path', () => {
    seedTab({ path: '/proj/a.py', isDirty: true });
    requestCloseTab('/proj/does-not-exist.py');
    expect(useDialogStore.getState().pendingClose).toBeNull();
    expect(useProjectStore.getState().tabs).toHaveLength(1);
  });
});
