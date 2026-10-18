import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One tooltip system: icon buttons and menu triggers in the shell, editor, Dirac, circuit, histogram
 * and Bloch components use the shared Tooltip (or an aria-label), never a native `title` attribute.
 */
const ROOT = join(__dirname, '..');
const DIRS = ['components/dirac', 'components/editor', 'components/circuit', 'components/histogram', 'components/bloch', 'components/commandPalette', 'components/layout'];
const FILES = ['components/qec/VizZone.tsx'];
const CONTROL_WITH_TITLE = /<(?:IconButton|Button|button)\b(?:[^<>]|=>)*?\btitle=/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

describe('native title attributes on controls', () => {
  const files = [...DIRS.flatMap((d) => sourceFiles(join(ROOT, d))), ...FILES.map((f) => join(ROOT, f))];

  it('scans a meaningful set of files', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  // Status-bar readouts keep a native title for long values they truncate; only real controls are policed here.
  const ALLOWED = new Set(['components/layout/StatusBar.tsx']);

  it.each(files.map((f) => [f.slice(ROOT.length + 1), f]))('%s has no title= on a button', (rel, file) => {
    if (ALLOWED.has(rel)) return;
    expect(CONTROL_WITH_TITLE.test(readFileSync(file, 'utf8'))).toBe(false);
  });
});
