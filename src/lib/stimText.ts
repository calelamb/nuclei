/**
 * True when the editor buffer can be handed to the kernel's Stim circuit
 * analyses as circuit text. A `.stim` file always qualifies, as does an
 * untitled or extension-less buffer that does not look like Python; any other
 * extension (.py, .qasm, .qs ...) never does (Stim-in-Python builds circuits
 * programmatically, so there is no single circuit text to map lines onto).
 */
const PYTHON_HINT = /^\s*(import\s+\w|from\s+\S+\s+import\s|def\s+\w|class\s+\w|print\()/m;

/** Final path segment's extension (lower-case, with dot), or '' when it has none. */
function extensionOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

export function isStimCircuitText(code: string, filePath: string | null): boolean {
  if (!code.trim()) return false;
  if (filePath) {
    const ext = extensionOf(filePath);
    if (ext === '.stim') return true;
    // Allow-list: .qasm, .qs, .py, .txt ... are other languages, not Stim.
    if (ext !== '') return false;
  }
  return !PYTHON_HINT.test(code);
}
