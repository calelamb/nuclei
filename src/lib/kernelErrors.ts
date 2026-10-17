/**
 * Kernel start failures, turned into something a person can act on.
 *
 * The Rust side (src-tauri/src/commands/kernel.rs) rejects `start_kernel`
 * with a plain string; the web build fails with a PyodideRuntimeError message.
 * Both arrive here as `unknown`.
 */

import { DOCS_BASE as DOCS_ROOT } from '../config/docsLinks';

export type KernelFailureKind =
  | 'port-in-use'
  | 'script-missing'
  | 'python-missing'
  | 'auth-rejected'
  | 'not-responding'
  | 'browser-load'
  | 'unknown';

export interface KernelFailure {
  kind: KernelFailureKind;
  /** The message shown to the student (verbatim Rust text where we have it). */
  message: string;
  /** Short heading for the banner. */
  title: string;
  docsUrl: string;
}

const DOCS_BASE = `${DOCS_ROOT}/introduction/kernel-troubleshooting/`;

const TITLES: Record<KernelFailureKind, string> = {
  'port-in-use': 'Another app is using the kernel port',
  'script-missing': "Nuclei couldn't find its Python kernel",
  'python-missing': "Nuclei couldn't start Python",
  'auth-rejected': 'The kernel rejected this session',
  'not-responding': 'The kernel is not responding',
  'browser-load': "Couldn't start the browser Python engine",
  unknown: "The kernel didn't start",
};

export const KERNEL_NOT_RESPONDING_MESSAGE =
  'The kernel did not respond after 15 attempts. Check that Python is installed, then retry.';

/** Best-effort extraction of a message from whatever a rejected promise carried. */
export function normalizeKernelError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const text = raw.replace(/^Error:\s*/, '').trim();
  return text.length > 0 ? text : 'The kernel failed to start for an unknown reason.';
}

function classify(message: string): KernelFailureKind {
  if (/already in use|address already|port \d+/i.test(message)) return 'port-in-use';
  if (/kernel script not found/i.test(message)) return 'script-missing';
  if (/failed to start kernel|no such file|python3? (?:not found|is not installed)|spawn/i.test(message)) {
    return 'python-missing';
  }
  if (/session token|rejected/i.test(message)) return 'auth-rejected';
  if (/not responding|did not respond/i.test(message)) return 'not-responding';
  if (/browser python engine|content blocker/i.test(message)) return 'browser-load';
  return 'unknown';
}

export function describeKernelFailure(error: unknown): KernelFailure {
  const message = normalizeKernelError(error);
  const kind = classify(message);
  return { kind, message, title: TITLES[kind], docsUrl: `${DOCS_BASE}#${kind}` };
}
