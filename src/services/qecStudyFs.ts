import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  watch,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import type { PlatformBridge } from '../platform/bridge';

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

function unavailable(operation: string, path: string): Error {
  return new Error(`${operation} is unavailable for the web project path "${path}".`);
}

/** Bind read-only web project discovery to the existing platform boundary. */
export function createPlatformQecStudyFs(platform: PlatformBridge): QecStudyFs {
  return {
    async readTextFile(path: string): Promise<string> {
      const content = await platform.readFile(path);
      if (content === null) throw unavailable('Reading', path);
      return content;
    },
    async writeTextFile(path: string, content: string): Promise<void> {
      const created = await platform.createFile(path, content);
      if (created === null) throw unavailable('Writing', path);
    },
    async readDir(path: string): Promise<QecStudyDirEntry[]> {
      const entries = await platform.listDirectory(path);
      if (entries === null) throw unavailable('Listing', path);
      return entries.map((entry) => ({ name: entry.name, isDirectory: entry.kind === 'directory' }));
    },
    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      const existing = await platform.listDirectory(path);
      if (existing !== null) return;
      const created = await platform.createDirectory(path, options?.recursive);
      if (created === null) throw unavailable('Creating a directory at', path);
    },
    async exists(path: string): Promise<boolean> {
      const [content, entries] = await Promise.all([
        platform.readFile(path),
        platform.listDirectory(path),
      ]);
      return content !== null || entries !== null;
    },
    join: joinPath,
    async watch(): Promise<() => void> {
      return () => undefined;
    },
  };
}
