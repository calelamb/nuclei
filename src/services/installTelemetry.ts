// Anonymous install + heartbeat telemetry for the Nuclei desktop app.
//
// Why this exists: we need a defensible "active install" count. GitHub
// download counts double-count updates and include CI/dev traffic, so the
// number is noisy. An anonymous first-run ping plus a weekly heartbeat gives
// us real WAU/MAU without collecting anything identifying.
//
// What's sent (only this, nothing else):
//   - install_id: UUIDv4 generated locally, stable per install
//   - event:      'first_run' | 'heartbeat'
//   - app_version
//   - os: 'macos' | 'windows' | 'linux'
//   - os_arch: navigator.platform string (bounded)
//   - locale: navigator.language
//
// Not sent: no email, no IP persistence, no user code, no circuit data, no
// Dirac prompts, no file paths. The install_id is opaque.
//
// Opt-out: governed by settingsStore.general.anonymousUsageStats. Default on.
// The separate settingsStore.general.telemetryEnabled flag (off by default)
// governs richer in-app usage telemetry and is intentionally independent.

const ENDPOINT = 'https://getnuclei.dev/api/telemetry';

const LS_KEY_INSTALL_ID = 'nuclei-install-id';
const LS_KEY_LAST_HEARTBEAT = 'nuclei-install-last-heartbeat';
const LS_KEY_FIRST_RUN_SENT = 'nuclei-install-first-run-sent';

const HEARTBEAT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type InstallEvent = 'first_run' | 'heartbeat';

type OsKind = 'macos' | 'windows' | 'linux' | 'unknown';

interface InstallPayload {
  event: InstallEvent;
  install_id: string;
  app_version: string;
  os: OsKind;
  os_arch?: string;
  locale?: string;
}

function detectOs(): OsKind {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/Mac|iPhone|iPad|iPod/i.test(ua)) return 'macos';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'unknown';
}

function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* restricted environment — skip */
  }
}

function getOrCreateInstallId(): string {
  const existing = readLocalStorage(LS_KEY_INSTALL_ID);
  if (existing) return existing;

  const fresh =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : fallbackUuidV4();

  writeLocalStorage(LS_KEY_INSTALL_ID, fresh);
  return fresh;
}

// Minimal RFC4122 v4 fallback. Only used if crypto.randomUUID is unavailable
// (very old webviews). Collision risk is fine for an analytics key.
function fallbackUuidV4(): string {
  const rand = (): number => Math.floor(Math.random() * 16);
  const hex = (n: number): string => n.toString(16);
  const chars: string[] = [];
  for (let i = 0; i < 32; i += 1) {
    if (i === 12) {
      chars.push('4');
    } else if (i === 16) {
      chars.push(hex((rand() & 0x3) | 0x8));
    } else {
      chars.push(hex(rand()));
    }
  }
  return `${chars.slice(0, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}-${chars.slice(16, 20).join('')}-${chars.slice(20, 32).join('')}`;
}

async function send(payload: InstallPayload): Promise<void> {
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Telemetry must never block app startup. Keepalive lets the request
      // survive if the webview tears down immediately after dispatch.
      keepalive: true,
    });
  } catch {
    /* swallow — analytics must never break the app */
  }
}

export interface InstallTelemetryOptions {
  appVersion: string;
  /** If false, no pings are sent. Called each invocation to respect live toggles. */
  isEnabled: () => boolean;
  /** If true, endpoint is replaced with console.debug (used in dev / tests). */
  dryRun?: boolean;
}

/**
 * Runs install telemetry. Safe to call on every app mount — it dedupes
 * first_run via localStorage and rate-limits heartbeats to once per week.
 */
export async function runInstallTelemetry(
  opts: InstallTelemetryOptions,
): Promise<void> {
  if (!opts.isEnabled()) return;

  const installId = getOrCreateInstallId();
  const os = detectOs();
  const locale =
    typeof navigator !== 'undefined' ? navigator.language || undefined : undefined;
  const osArch =
    typeof navigator !== 'undefined' ? navigator.platform || undefined : undefined;

  const base: Omit<InstallPayload, 'event'> = {
    install_id: installId,
    app_version: opts.appVersion,
    os,
    os_arch: osArch,
    locale,
  };

  const firstRunSent = readLocalStorage(LS_KEY_FIRST_RUN_SENT) === '1';
  const lastHeartbeatRaw = readLocalStorage(LS_KEY_LAST_HEARTBEAT);
  const lastHeartbeat = lastHeartbeatRaw ? parseInt(lastHeartbeatRaw, 10) : 0;
  const now = Date.now();

  if (!firstRunSent) {
    const payload: InstallPayload = { ...base, event: 'first_run' };
    if (opts.dryRun) {
      console.debug('[installTelemetry] first_run (dryRun)', payload);
    } else {
      await send(payload);
    }
    writeLocalStorage(LS_KEY_FIRST_RUN_SENT, '1');
    writeLocalStorage(LS_KEY_LAST_HEARTBEAT, now.toString());
    return;
  }

  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    const payload: InstallPayload = { ...base, event: 'heartbeat' };
    if (opts.dryRun) {
      console.debug('[installTelemetry] heartbeat (dryRun)', payload);
    } else {
      await send(payload);
    }
    writeLocalStorage(LS_KEY_LAST_HEARTBEAT, now.toString());
  }
}

/** For settings UI — surface the stable id so users can verify what's tracked. */
export function getInstallIdForDisplay(): string | null {
  return readLocalStorage(LS_KEY_INSTALL_ID);
}
