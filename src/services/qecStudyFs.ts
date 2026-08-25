import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  lstat,
  watch,
} from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { resolve } from '@tauri-apps/api/path';
import type { PlatformBridge } from '../platform/bridge';

export interface QecStudyDirEntry {
  name: string;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface QecStudyManifestFile {
  fileName: string;
  content: string | null;
  error: string | null;
}

export class QecStudyFileExistsError extends Error {
  constructor(path: string) {
    super(`A file already exists at "${path}".`);
    this.name = 'QecStudyFileExistsError';
  }
}

/** Injectable filesystem boundary for QEC Study lifecycle features. */
export interface QecStudyFs {
  readTextFile(path: string): Promise<string>;
  readStudyManifests?(projectRoot: string): Promise<readonly QecStudyManifestFile[]>;
  createTextFileExclusive(projectRoot: string, fileName: string, content: string): Promise<void>;
  readDir(path: string): Promise<QecStudyDirEntry[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  isSymlink(path: string): Promise<boolean>;
  resolvePath(...parts: string[]): Promise<string>;
  join(...parts: string[]): string;
  watch(
    path: string,
    onEvent: (paths: readonly string[]) => void,
    options?: { recursive?: boolean },
  ): Promise<() => void>;
}

function joinPath(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join('/')
    .replace(/\/{2,}/g, '/');
}

function lexicalResolvePath(...parts: string[]): string {
  const joined = joinPath(...parts).replaceAll('\\', '/');
  const prefix = joined.startsWith('/') ? '/' : '';
  const segments: string[] = [];
  for (const segment of joined.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return `${prefix}${segments.join('/')}`;
}

/** Bind the QEC Study filesystem port to Tauri's filesystem plugin. */
export function createTauriQecStudyFs(): QecStudyFs {
  return {
    readTextFile: (path: string) => readTextFile(path),
    readStudyManifests: (projectRoot: string) =>
      invoke<QecStudyManifestFile[]>('qec_read_study_manifests', { projectRoot }),
    async createTextFileExclusive(
      projectRoot: string,
      fileName: string,
      content: string,
    ): Promise<void> {
      const result = await invoke<'created' | 'exists'>('qec_create_study_manifest', {
        projectRoot,
        fileName,
        content,
      });
      if (result === 'exists') {
        throw new QecStudyFileExistsError(joinPath(projectRoot, 'studies', fileName));
      }
    },
    async readDir(path: string): Promise<QecStudyDirEntry[]> {
      const entries = await readDir(path);
      return entries.map((entry) => ({
        name: entry.name ?? '',
        isDirectory: entry.isDirectory,
        isSymlink: entry.isSymlink,
      }));
    },
    mkdir: (path: string, options?: { recursive?: boolean }) =>
      mkdir(path, { recursive: options?.recursive ?? false }),
    exists: (path: string) => exists(path),
    async isSymlink(path: string): Promise<boolean> {
      if (!await exists(path)) return false;
      return (await lstat(path)).isSymlink;
    },
    resolvePath: (...parts: string[]) => resolve(...parts),
    join: joinPath,
    async watch(
      path: string,
      onEvent: (paths: readonly string[]) => void,
      options?: { recursive?: boolean },
    ): Promise<() => void> {
      return watch(path, (event) => onEvent(event.paths), { recursive: options?.recursive ?? true });
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
    async createTextFileExclusive(
      projectRoot: string,
      fileName: string,
      content: string,
    ): Promise<void> {
      const path = joinPath(projectRoot, 'studies', fileName);
      const result = await platform.createFileExclusive?.(path, content) ?? null;
      if (result === 'exists') throw new QecStudyFileExistsError(path);
      if (result !== 'created') throw unavailable('Writing', path);
    },
    async readDir(path: string): Promise<QecStudyDirEntry[]> {
      const entries = await platform.listDirectory(path);
      if (entries === null) throw unavailable('Listing', path);
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.kind === 'directory',
        isSymlink: false,
      }));
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
    async isSymlink(): Promise<boolean> { return false; },
    async resolvePath(...parts: string[]): Promise<string> { return lexicalResolvePath(...parts); },
    join: joinPath,
    async watch(): Promise<() => void> {
      return () => undefined;
    },
  };
}
