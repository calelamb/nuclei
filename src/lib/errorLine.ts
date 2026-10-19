/**
 * Where in the student's own code an error happened, parsed from the traceback
 * text the Python worker already sends (`File "<string>", line N`). The last
 * match is the innermost frame in the student's code.
 */
const USER_FRAME_RE = /File "<string>", line (\d+)/g;

/** 1-based line in the student's code, or null when the traceback names none. `offset` is the harness lines placed before it. */
export function errorLineFromTraceback(traceback: string | undefined | null, offset = 0): number | null {
  if (!traceback) return null;
  let line: number | null = null;
  for (const match of traceback.matchAll(USER_FRAME_RE)) line = Number(match[1]);
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
