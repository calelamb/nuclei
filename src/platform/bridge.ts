/**
 * PlatformBridge — abstracts all platform-specific operations.
 *
 * In Phase 2, only TauriBridge is implemented (desktop).
 * In Phase 4, a WebBridge will be added for browser-based deployment.
 *
 * All platform-specific imports (@tauri-apps/*) should be confined to
 * the TauriBridge implementation. Components access platform features
 * exclusively through this interface via PlatformProvider.
 */
export interface DirEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
}

export interface PlatformBridge {
  // Kernel management
  startKernel(): Promise<string>;
  stopKernel(): Promise<string>;

  // Canonical QEC data-engine management. The desktop implementation owns
  // the native child process; callers must stop it before changing projects.
  startQecDataEngine?(projectRoot: string): Promise<unknown>;
  stopQecDataEngine?(): Promise<void>;

  // File operations
  openFile(): Promise<{ path: string; content: string } | null>;
  readFile(path: string): Promise<string | null>;
  saveFile(path: string, content: string): Promise<void>;
  saveFileAs(content: string, defaultPath?: string): Promise<{ path: string } | null>;
  // Rename a file on disk. On desktop this is an atomic rename within the
  // same directory (or across directories if newPath is absolute). On web the
  // platform may only update the display name since files are ephemeral —
  // returning the new path is still correct behavior for that surface.
  renameFile(oldPath: string, newName: string): Promise<{ path: string } | null>;

  // Storage (settings, preferences)
  getStoredValue<T>(key: string): Promise<T | null>;
  setStoredValue(key: string, value: unknown): Promise<void>;

  // Window
  setWindowTitle(title: string): Promise<void>;

  // Platform info
  getPlatform(): 'desktop' | 'web';

  // Project / directory ops (desktop-primary). Web implementations return
  // null to indicate the current surface doesn't support folder projects.
  openDirectory(): Promise<{ path: string } | null>;
  listDirectory(path: string): Promise<DirEntry[] | null>;
  createFile(path: string, content: string): Promise<{ path: string } | null>;
  /** Optional atomic create used by confined project adapters. Never overwrites. */
  createFileExclusive?(path: string, content: string): Promise<'created' | 'exists' | null>;
  createDirectory(path: string, recursive?: boolean): Promise<{ path: string } | null>;
  deleteFile(path: string): Promise<boolean>;
}
