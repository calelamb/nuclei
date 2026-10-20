/**
 * Remembers which runs-table row opened the run detail so Back can put focus
 * on it again. A single slot is enough: only one detail is open at a time.
 */
let lastOpenedRunDir: string | null = null;

export function rememberOpenedRun(dir: string): void {
  lastOpenedRunDir = dir;
}

/** Returns the remembered run once, then forgets it. */
export function takeOpenedRun(): string | null {
  const dir = lastOpenedRunDir;
  lastOpenedRunDir = null;
  return dir;
}
