/**
 * Monaco cancels its delayed tasks (word highlight, hover, suggest) by rejecting
 * the pending promise with an Error named "Canceled" when the model or editor is
 * disposed. That is control flow, not a failure, but the rejection is unhandled,
 * so every file switch and lesson change logged a page error. Only that one name
 * is swallowed; any other rejection still surfaces.
 */
const MONACO_CANCELED = 'Canceled';

export function isMonacoCancellation(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && (reason as { name?: unknown }).name === MONACO_CANCELED;
}

export function installMonacoCancellationGuard(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const onRejection = (event: PromiseRejectionEvent) => {
    if (isMonacoCancellation(event.reason)) event.preventDefault();
  };
  target.addEventListener('unhandledrejection', onRejection);
  return () => target.removeEventListener('unhandledrejection', onRejection);
}
