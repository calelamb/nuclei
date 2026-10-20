import { useCallback, useState } from 'react';
import { usePlatform } from '../../../platform/PlatformProvider';
import { useProjectStore } from '../../../stores/projectStore';
import type { QecStudySource } from '../../../types/qecStudy';

/** Source kinds whose files the editor can open as text. */
const EDITABLE_KINDS: ReadonlySet<QecStudySource['kind']> = new Set(['stim', 'python', 'dem']);

export const isOpenableSource = (source: QecStudySource): boolean => EDITABLE_KINDS.has(source.kind);

const basename = (path: string): string => path.split('/').pop() ?? path;

function absolutePath(projectRoot: string, relative: string): string {
  return `${projectRoot.replace(/\/+$/, '')}/${relative.replace(/^\/+/, '')}`;
}

export interface OpenSourceApi {
  open(source: QecStudySource): Promise<boolean>;
  /** Plain-language reason the last open failed, or null. */
  error: string | null;
}

/** Opens a Study source in the editor as a project tab (the same path File > Open and the explorer use). */
export function useOpenSource(): OpenSourceApi {
  const platform = usePlatform();
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(async (source: QecStudySource): Promise<boolean> => {
    const { projectRoot, tabs, openTab, setActiveTab } = useProjectStore.getState();
    if (!projectRoot) {
      setError('Open a project folder before opening files.');
      return false;
    }
    const path = absolutePath(projectRoot, source.path);
    if (tabs.some((tab) => tab.path === path)) {
      setActiveTab(path);
      setError(null);
      return true;
    }
    try {
      const content = await platform.readFile(path);
      if (content === null) throw new Error('unreadable');
      openTab({ path, content });
      setError(null);
      return true;
    } catch {
      setError(`Could not open ${basename(source.path)}. Check that the file exists in the project.`);
      return false;
    }
  }, [platform]);
  return { open, error };
}
