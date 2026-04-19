import { useCallback, useEffect } from 'react';
import { usePlatform } from '../platform/PlatformProvider';
import { useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';

const RECENT_FILES_KEY = 'recent_files';
const MAX_RECENT = 10;
const LAST_OPENED_FILE_KEY = 'last_opened_file';

export const MEMORY_PREFIX = 'memory://';
export const isMemoryPath = (p: string | null | undefined): boolean =>
  !!p && p.startsWith(MEMORY_PREFIX);

function parentDir(path: string): string | null {
  const idx = path.lastIndexOf('/');
  if (idx <= 0) return null;
  return path.slice(0, idx);
}

export function useFileOps() {
  const { code, filePath, isDirty, setCode, setFilePath } = useEditorStore();
  const platform = usePlatform();

  // Update window title on filePath / isDirty change
  useEffect(() => {
    const name = filePath ? filePath.split('/').pop() ?? 'untitled' : 'untitled';
    const dirty = isDirty ? '● ' : '';
    platform.setWindowTitle(`${dirty}${name} — Nuclei`).catch(() => {});
  }, [filePath, isDirty, platform]);

  const addRecent = useCallback(async (path: string) => {
    try {
      const recents = (await platform.getStoredValue<string[]>(RECENT_FILES_KEY)) ?? [];
      const updated = [path, ...recents.filter((p) => p !== path)].slice(0, MAX_RECENT);
      await platform.setStoredValue(RECENT_FILES_KEY, updated);
    } catch { /* non-critical recent files persistence */ }
  }, [platform]);

  const openFile = useCallback(async () => {
    const result = await platform.openFile();
    if (!result) return;

    setCode(result.content);
    setFilePath(result.path);
    await addRecent(result.path);
    await platform.setStoredValue(LAST_OPENED_FILE_KEY, result.path);
  }, [setCode, setFilePath, addRecent, platform]);

  const saveFileAs = useCallback(async () => {
    // A memory:// filePath is a synthetic id for an unsaved buffer — we must
    // not suggest it as a default disk location, so strip it out of the hint.
    const defaultPath = filePath && !isMemoryPath(filePath) ? filePath : undefined;
    const result = await platform.saveFileAs(code, defaultPath);
    if (!result) return;

    const priorPath = filePath;
    setFilePath(result.path);
    await addRecent(result.path);
    await platform.setStoredValue(LAST_OPENED_FILE_KEY, result.path);

    // Keep projectStore in sync: rename the active tab to the saved disk
    // path, and mark it as saved so the dirty dot clears.
    if (priorPath) {
      const ps = useProjectStore.getState();
      if (ps.tabs.some((t) => t.path === priorPath)) {
        ps.renameTab(priorPath, result.path);
        ps.markTabSaved(result.path, code);
      }
    }

    // If this was an in-memory project, migrate the project root to the
    // saved file's parent folder so the sidebar tree switches from the
    // tab-only view to the real filesystem view.
    const ps = useProjectStore.getState();
    if (isMemoryPath(ps.projectRoot)) {
      const parent = parentDir(result.path);
      if (parent) {
        ps.setProjectRoot(parent);
        platform.setStoredValue('project_root', parent).catch(() => {});
      }
    }
  }, [filePath, code, setFilePath, addRecent, platform]);

  const saveFile = useCallback(async () => {
    if (filePath && !isMemoryPath(filePath)) {
      await platform.saveFile(filePath, code);
      setFilePath(filePath);
      await addRecent(filePath);
      await platform.setStoredValue(LAST_OPENED_FILE_KEY, filePath);

      // Mirror the save into the tab so its dirty state clears.
      const ps = useProjectStore.getState();
      if (ps.tabs.some((t) => t.path === filePath)) {
        ps.markTabSaved(filePath, code);
      }
    } else {
      await saveFileAs();
    }
  }, [filePath, code, setFilePath, addRecent, platform, saveFileAs]);

  const newFile = useCallback((templateCode?: string) => {
    setCode(templateCode ?? '');
    setFilePath(null);
  }, [setCode, setFilePath]);

  // Rename the current file. Returns the new path on success, or null if
  // the user passed an empty name, the new name collided with an existing
  // file, or the underlying rename failed. For an untitled (unsaved) buffer
  // we update the display name only — the actual file lands on disk at the
  // next Save.
  const renameFile = useCallback(async (newName: string): Promise<string | null> => {
    const trimmed = newName.trim();
    if (!trimmed) return null;
    if (!filePath) {
      setFilePath(trimmed);
      return trimmed;
    }
    const result = await platform.renameFile(filePath, trimmed);
    if (!result) return null;
    setFilePath(result.path);
    await addRecent(result.path);
    await platform.setStoredValue(LAST_OPENED_FILE_KEY, result.path);
    return result.path;
  }, [filePath, setFilePath, addRecent, platform]);

  const getRecentFiles = useCallback(async (): Promise<string[]> => {
    return (await platform.getStoredValue<string[]>(RECENT_FILES_KEY)) ?? [];
  }, [platform]);

  return { openFile, saveFile, saveFileAs, newFile, renameFile, getRecentFiles };
}
