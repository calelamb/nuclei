/**
 * Window-level guard for file drags. The Tauri window runs with
 * `dragDropEnabled: false` so HTML5 drop events reach the page; without a
 * guard, a file dropped outside a handled drop zone falls to the webview's
 * default action (navigate to the file URL) and the app loses its state.
 * Calling preventDefault on file dragover/drop disables that default while
 * leaving component handlers (which run earlier, in React's root) untouched.
 */
function isFileDrag(e: Event): boolean {
  const types = (e as DragEvent).dataTransfer?.types;
  return types ? Array.from(types).includes('Files') : false;
}

/** Install the guard; returns a function that removes it. */
export function installFileDropGuard(target: Window = window): () => void {
  const guard = (e: Event): void => { if (isFileDrag(e)) e.preventDefault(); };
  target.addEventListener('dragover', guard);
  target.addEventListener('drop', guard);
  return () => {
    target.removeEventListener('dragover', guard);
    target.removeEventListener('drop', guard);
  };
}
