/**
 * After the Python worker is killed and boots again it has forgotten the circuit, so the buffer
 * is parsed again to keep the diagram honest. The exception is a preview that was already paused
 * for running too long: parsing that code again would just time out and restart Python in a loop.
 */
export function shouldReparseAfterRestart(previewPaused: boolean): boolean {
  return !previewPaused;
}

/**
 * Between the restart and the re-parse answering (up to the preview time limit when the code
 * runs forever), the diagram would pass for current. Mark it as the last good circuit right away;
 * a successful parse replaces the mark, a timeout keeps it.
 */
export function shouldMarkStaleWhileReparsing(previewPaused: boolean): boolean {
  return shouldReparseAfterRestart(previewPaused);
}
