import { useCallback, useEffect } from 'react';
import { usePlatform } from '../platform/PlatformProvider';
import { useEditorStore } from '../stores/editorStore';

const RECENT_FILES_KEY = 'recent_files';
const MAX_RECENT = 10;
const LAST_OPENED_FILE_KEY = 'last_opened_file';

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
    const result = await platform.saveFileAs(code, filePath ?? undefined);
    if (!result) return;

    setFilePath(result.path);
    await addRecent(result.path);
    await platform.setStoredValue(LAST_OPENED_FILE_KEY, result.path);
  }, [filePath, code, setFilePath, addRecent, platform]);

  const saveFile = useCallback(async () => {
    if (filePath) {
      await platform.saveFile(filePath, code);
      setFilePath(filePath);
      await addRecent(filePath);
      await platform.setStoredValue(LAST_OPENED_FILE_KEY, filePath);
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
