/**
 * Where in the student's own code an error happened, parsed from the traceback
 * text the Python worker already sends (`File "untitled.py", line N`, any file name). The last
 * match is the innermost frame in the student's code.
 */
const USER_FRAME_RE = /File "(<string>|<exec>|[^"\n]+\.py)", line (\d+)/g;

/** Filenames of runtime/harness frames that are never the student's code. */
const NON_USER_FILE_RE = /(^|[\\/])(site-packages|pyodide|lib[\\/]python[\d.]*|shim)([\\/]|$)/;

/** Rewrites "on line N" in an error message (IndentationError etc.) from harness to student numbering. */
export function shiftLineMentions(message: string, offset: number): string {
  if (offset <= 0) return message;
  return message.replace(/\bon line (\d+)/g, (whole, n: string) => {
    const shifted = Number(n) - offset;
    return shifted >= 1 ? `on line ${shifted}` : whole;
  });
}

/** 1-based line in the student's code, or null when the traceback names none. `offset` is the harness lines placed before it. */
export function errorLineFromTraceback(traceback: string | undefined | null, offset = 0): number | null {
  if (!traceback) return null;
  let line: number | null = null;
  for (const match of traceback.matchAll(USER_FRAME_RE)) {
    if (!NON_USER_FILE_RE.test(match[1])) line = Number(match[2]);
  }
  if (line === null) return null;
  const adjusted = line - offset;
  return adjusted >= 1 ? adjusted : null;
}

export interface CodeErrorText {
  line: number | null;
  /** "Line 2 · SyntaxError: invalid syntax" or the bare message when no line is known. */
  text: string;
}

export function describeCodeError(
  message: string,
  traceback?: string | null,
  offset = 0,
): CodeErrorText {
  const line = errorLineFromTraceback(traceback, offset);
  return { line, text: line === null ? message : `Line ${line} · ${message}` };
}
