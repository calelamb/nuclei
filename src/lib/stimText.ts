/**
 * True when the editor buffer can be handed to the kernel's Stim circuit
 * analyses as circuit text. A `.stim` file always qualifies; a Python file or
 * a buffer that looks like Python never does (Stim-in-Python builds circuits
 * programmatically, so there is no single circuit text to map lines onto).
 */
const PYTHON_HINT = /^\s*(import\s+\w|from\s+\S+\s+import\s|def\s+\w|class\s+\w|print\()/m;

export function isStimCircuitText(code: string, filePath: string | null): boolean {
  if (!code.trim()) return false;
  if (filePath) {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.stim')) return true;
    if (lower.endsWith('.py')) return false;
  }
  return !PYTHON_HINT.test(code);
}
