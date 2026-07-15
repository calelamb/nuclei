import { useProjectStore } from '../stores/projectStore';
import { useDialogStore } from '../stores/dialogStore';
import { getFileOps } from '../App';

const basename = (p: string) => p.split('/').pop() ?? p;

/**
 * Close an open tab, prompting to save first if it has unsaved changes.
 *
 * Shared by the tab bar AND the Open Files sidebar (and any other close
 * affordance) so closing a dirty file from *any* of them raises the same
 * unsaved-changes dialog — never a silent discard. Previously the sidebar's
 * close button called `closeTab` directly and dropped unsaved work.
 */
export function requestCloseTab(path: string): void {
  const tab = useProjectStore.getState().tabs.find((t) => t.path === path);
  if (!tab) return;
  if (!tab.isDirty) {
    useProjectStore.getState().closeTab(path);
    return;
  }
  useDialogStore.getState().requestClose({
    fileName: basename(path),
    onSave: async () => {
      useProjectStore.getState().setActiveTab(path);
      const ops = getFileOps();
      if (ops) await ops.saveFile();
      useProjectStore.getState().markTabSaved(path, tab.content);
      useProjectStore.getState().closeTab(path);
    },
    onDontSave: () => useProjectStore.getState().closeTab(path),
    onCancel: () => {},
  });
}
