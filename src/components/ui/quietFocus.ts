let quiet = false;

/**
 * Move focus without announcing it: the focus ring shows, but a Tooltip on the target stays shut.
 * For hand-offs the person did not ask for with the keyboard (a fold or unmount that takes the
 * focused control away); keyboard Tab focus keeps its tooltip.
 */
export function focusQuietly(el: HTMLElement, options?: FocusOptions): void {
  quiet = true;
  try {
    el.focus(options);
  } finally {
    quiet = false;
  }
}

/** True while a `focusQuietly` call is dispatching its focus event. */
export function isQuietFocus(): boolean {
  return quiet;
}
