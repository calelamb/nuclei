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
