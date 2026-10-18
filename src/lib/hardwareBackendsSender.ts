/**
 * Module-level bridge for asking the kernel which backends the connected
 * providers actually expose. The kernel socket owner registers a sender after
 * authentication; the Launch dialog and Hardware panel call
 * `requestHardwareBackends` without threading the socket through props.
 * Mirrors `transpileSender`.
 */
export type HardwareBackendsSender = () => void;

let sender: HardwareBackendsSender | null = null;

export function setHardwareBackendsSender(next: HardwareBackendsSender | null): void {
  sender = next;
}

/** Ask the kernel for the live backend list. Returns false when no kernel is attached (web build / socket closed). */
export function requestHardwareBackends(): boolean {
  if (!sender) return false;
  sender();
  return true;
}
