/**
 * After the Python worker is killed and boots again it has forgotten the circuit, so the buffer
 * is parsed again to keep the diagram honest. The exception is a preview that was paused for
 * running too long: parsing that code again would just time out and restart Python in a loop.
 */
export function shouldReparseAfterRestart(previewPaused: boolean): boolean {
  return !previewPaused;
}
