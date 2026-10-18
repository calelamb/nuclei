/**
 * Kernel start failures, turned into something a person can act on.
 *
 * The Rust side (src-tauri/src/commands/kernel.rs) rejects `start_kernel`
 * with a plain string; the web build fails with a PyodideRuntimeError message.
 * Both arrive here as `unknown`.
 */

import { DOCS_BASE as DOCS_ROOT } from '../config/docsLinks';
import { isWebBuild } from '../platform/buildTarget';

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
  /** The single name for a failed start on this runtime ("Python didn't start" / "Kernel didn't start"). */
  title: string;
  /** The specific reason followed by the message (what the banner body shows). */
  detail: string;
  docsUrl: string;
}

const DOCS_BASE = `${DOCS_ROOT}/introduction/kernel-troubleshooting/`;

/** What went wrong, in a phrase. Becomes the start of the body, never the heading. */
const REASONS: Record<KernelFailureKind, string> = {
  'port-in-use': 'Another app is using the kernel port',
  'script-missing': "Nuclei couldn't find its Python kernel",
  'python-missing': "Nuclei couldn't start Python",
  'auth-rejected': 'The kernel rejected this session',
  'not-responding': 'The kernel is not responding',
  'browser-load': "Couldn't start the browser Python engine",
  unknown: "The kernel didn't start",
};

/** One name per runtime for a start that failed, shared by the banner, the results column and the status bar. */
export function kernelStartFailureTitle(isWeb: boolean): string {
  return isWeb ? "Python didn't start" : "Kernel didn't start";
}

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

export function describeKernelFailure(error: unknown, options: { isWeb?: boolean } = {}): KernelFailure {
  const message = normalizeKernelError(error);
  const kind = classify(message);
  const reason = REASONS[kind];
  // 'unknown' and 'not-responding' reasons only restate the heading, so the message stands alone.
  const standsAlone = kind === 'unknown' || kind === 'not-responding';
  const rest = message.startsWith(reason) ? message.slice(reason.length).replace(/^[\s.:—-]+/, '').trim() : message;
  const detail = standsAlone ? message : `${reason.replace(/[.]$/, '')}.${rest ? ` ${rest}` : ''}`;
  return {
    kind,
    message,
    title: kernelStartFailureTitle(options.isWeb ?? isWebBuild()),
    detail,
    docsUrl: `${DOCS_BASE}#${kind}`,
  };
}

/** The engine's name on this runtime: the browser build says Python and never "kernel". */
export function kernelEngineName(isWeb: boolean = isWebBuild()): 'Python' | 'Kernel' {
  return isWeb ? 'Python' : 'Kernel';
}

/** One sentence for "you asked while the engine is still booting". `again` is the follow-up the caller wants. */
export function kernelStartingMessage(options: { isWeb?: boolean; again?: string } = {}): string {
  const subject = options.isWeb ?? isWebBuild() ? 'Python is' : 'The kernel is';
  return `${subject} still starting. ${options.again ?? 'Try again'} when the status bar says ready.`;
}

/** One sentence for "there is no engine connection to send this to". */
export function kernelNotConnectedMessage(options: { isWeb?: boolean } = {}): string {
  const subject = options.isWeb ?? isWebBuild() ? "Python isn't running" : "The kernel isn't connected";
  return `${subject}. Check the status bar, then try again.`;
}

/** The disabled-button label while the engine boots. */
export function kernelWaitingLabel(isWeb: boolean = isWebBuild()): string {
  return isWeb ? 'Waiting for Python…' : 'Waiting for the kernel…';
}

/** The one sentence for an action that needs the desktop app's native bridge. */
export const DESKTOP_ONLY_MESSAGE = 'This runs in the desktop app. Download Nuclei to use it.';

/**
 * Text for an error from a desktop-only command. A missing Tauri bridge
 * (`reading 'invoke'` / `'transformCallback'`) means the browser build, so say
 * so instead of leaking the raw JavaScript message.
 */
export function describeDesktopCommandError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/reading '(?:invoke|transformCallback)'|__TAURI/i.test(raw)) return DESKTOP_ONLY_MESSAGE;
  return raw;
}
