import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  watch,
  writeTextFile,
} from '@tauri-apps/plugin-fs';

export interface QecStudyDirEntry {
  name: string;
  isDirectory: boolean;
}

/** Injectable filesystem boundary for QEC Study lifecycle features. */
export interface QecStudyFs {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<QecStudyDirEntry[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  join(...parts: string[]): string;
  watch(
    path: string,
    onEvent: () => void,
    options?: { recursive?: boolean },
  ): Promise<() => void>;
}

function joinPath(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join('/')
    .replace(/\/{2,}/g, '/');
}

/** Bind the QEC Study filesystem port to Tauri's filesystem plugin. */
export function createTauriQecStudyFs(): QecStudyFs {
  return {
    readTextFile: (path: string) => readTextFile(path),
    writeTextFile: (path: string, content: string) => writeTextFile(path, content),
    async readDir(path: string): Promise<QecStudyDirEntry[]> {
      const entries = await readDir(path);
      return entries.map((entry) => ({
        name: entry.name ?? '',
        isDirectory: entry.isDirectory,
      }));
    },
    mkdir: (path: string, options?: { recursive?: boolean }) =>
      mkdir(path, { recursive: options?.recursive ?? false }),
    exists: (path: string) => exists(path),
    join: joinPath,
    async watch(
      path: string,
      onEvent: () => void,
      options?: { recursive?: boolean },
    ): Promise<() => void> {
      return watch(path, () => onEvent(), { recursive: options?.recursive ?? true });
    },
  };
}
