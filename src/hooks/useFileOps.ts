import { useCallback, useEffect } from 'react';
import { usePlatform } from '../platform/PlatformProvider';
import { useEditorStore } from '../stores/editorStore';

const RECENT_FILES_KEY = 'recent_files';
const MAX_RECENT = 10;

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
  }, [setCode, setFilePath, addRecent, platform]);

  const saveFileAs = useCallback(async () => {
    const result = await platform.saveFileAs(code, filePath ?? undefined);
    if (!result) return;

    setFilePath(result.path);
    await addRecent(result.path);
  }, [filePath, code, setFilePath, addRecent, platform]);

  const saveFile = useCallback(async () => {
    if (filePath) {
      await platform.saveFile(filePath, code);
      setFilePath(filePath);
      await addRecent(filePath);
    } else {
      await saveFileAs();
    }
  }, [filePath, code, setFilePath, addRecent, platform, saveFileAs]);

  const newFile = useCallback((templateCode?: string) => {
    setCode(templateCode ?? useEditorStore.getState().code);
    setFilePath(null);
  }, [setCode, setFilePath]);

  const getRecentFiles = useCallback(async (): Promise<string[]> => {
    return (await platform.getStoredValue<string[]>(RECENT_FILES_KEY)) ?? [];
  }, [platform]);

  return { openFile, saveFile, saveFileAs, newFile, getRecentFiles };
}
