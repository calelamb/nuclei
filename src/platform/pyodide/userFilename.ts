/**
 * The file name the browser kernel compiles user code under, so a traceback reads
 * `File "bell.py", line 3` instead of `File "<string>"`. The app registers where
 * the running tab's path lives; the platform layer never imports the stores.
 */
export const DEFAULT_USER_FILENAME = 'untitled.py';

const MEMORY_PREFIX = 'memory://';

type FilenameSource = () => string | null | undefined;

let source: FilenameSource | null = null;

/** Register the live source of the running tab's path (pass null to clear). */
export function setUserFilenameSource(next: FilenameSource | null): void {
  source = next;
}

/** Last path segment, without a memory:// project prefix; falls back to untitled.py. */
export function displayFilename(path: string | null | undefined): string {
  if (!path) return DEFAULT_USER_FILENAME;
  const rest = path.startsWith(MEMORY_PREFIX) ? path.slice(MEMORY_PREFIX.length) : path;
  const segments = rest.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? DEFAULT_USER_FILENAME;
}

export function currentUserFilename(): string {
  try {
    return displayFilename(source?.());
  } catch {
    return DEFAULT_USER_FILENAME;
  }
}
