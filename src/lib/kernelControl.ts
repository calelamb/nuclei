/**
 * Lets UI far from useKernel (the editor toolbar, the failure banner) ask the
 * running kernel hook to restart, without threading callbacks through App.
 */
let retryHandler: (() => void) | null = null;

export function registerKernelRetry(handler: (() => void) | null): void {
  retryHandler = handler;
}

/** Restart the kernel (desktop: stop+start+reconnect; web: reboot the Python worker). */
export function retryKernel(): void {
  retryHandler?.();
}

let stopHandler: (() => void) | null = null;

/** Registered only by runtimes that can interrupt a run (the browser Python worker). */
export function registerKernelStop(handler: (() => void) | null): void {
  stopHandler = handler;
}

export function canStopKernelRun(): boolean {
  return stopHandler !== null;
}

/** Stop the program that is running right now. No-op when the runtime cannot. */
export function stopKernelRun(): void {
  stopHandler?.();
}

let bannerFocusHandler: (() => void) | null = null;

/** The kernel failure banner registers itself while it is on screen, so other UI can bring the user to it. */
export function registerKernelBannerFocus(handler: (() => void) | null): void {
  bannerFocusHandler = handler;
}

/** Move focus to the kernel failure banner (where Retry lives). Returns false when no banner is showing. */
export function focusKernelBanner(): boolean {
  if (!bannerFocusHandler) return false;
  bannerFocusHandler();
  return true;
}
