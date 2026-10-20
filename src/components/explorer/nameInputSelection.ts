/**
 * End of the "base name" range of a file name, the way VS Code selects it when
 * you create or rename a file: everything before the last dot, leaving the
 * extension untouched. A leading dot (".env") or no dot selects the whole name.
 */
export function baseNameSelectionEnd(name: string): number {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? dot : name.length;
}
