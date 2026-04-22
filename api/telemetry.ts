// Anonymous install telemetry endpoint for Nuclei.
//
// Contract:
//   POST /api/telemetry
//   Body: { event, install_id, app_version, os, os_arch?, locale? }
//
// Storage:
//   - Always logs a structured JSON line to stdout (visible in Vercel function
//     logs / log drains). This is the durable path for now.
//   - If POSTHOG_API_KEY is set (env var on the Vercel project), the event is
//     forwarded to PostHog for dashboards. No code changes needed to enable —
//     set the env var in the Vercel dashboard and redeploy.
//
// Privacy:
//   - install_id is a client-generated UUIDv4. No email, no IP persistence,
//     no code contents. Users can opt out via app settings (anonymous usage
//     stats toggle), which stops all pings at the source.

export const config = { runtime: 'edge' };

type EventName = 'first_run' | 'heartbeat' | 'uninstall';

interface TelemetryPayload {
  event: EventName;
  install_id: string;
  app_version: string;
  os: 'macos' | 'windows' | 'linux' | 'unknown';
  os_arch?: string;
  locale?: string;
}

const ALLOWED_EVENTS: ReadonlySet<EventName> = new Set([
  'first_run',
  'heartbeat',
  'uninstall',
]);

const ALLOWED_OS: ReadonlySet<TelemetryPayload['os']> = new Set([
  'macos',
  'windows',
  'linux',
  'unknown',
]);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Semver-ish: 0.4.16, 1.2.3-beta.1, etc. Max 32 chars to bound log cost.
const VERSION_RE = /^[0-9A-Za-z.\-+]{1,32}$/;

function corsHeaders(): Headers {
  const h = new Headers();
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  h.set('Access-Control-Max-Age', '86400');
  return h;
}

function parsePayload(raw: unknown): TelemetryPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const event = typeof r.event === 'string' ? r.event : '';
  const install_id = typeof r.install_id === 'string' ? r.install_id : '';
  const app_version = typeof r.app_version === 'string' ? r.app_version : '';
  const os = typeof r.os === 'string' ? r.os : '';

  if (!ALLOWED_EVENTS.has(event as EventName)) return null;
  if (!UUID_V4.test(install_id)) return null;
  if (!VERSION_RE.test(app_version)) return null;
  if (!ALLOWED_OS.has(os as TelemetryPayload['os'])) return null;

  const out: TelemetryPayload = {
    event: event as EventName,
    install_id,
    app_version,
    os: os as TelemetryPayload['os'],
  };

  if (typeof r.os_arch === 'string' && r.os_arch.length <= 32) {
    out.os_arch = r.os_arch;
  }
  if (typeof r.locale === 'string' && r.locale.length <= 16) {
    out.locale = r.locale;
  }
  return out;
}

async function forwardToPostHog(
  payload: TelemetryPayload,
  key: string,
): Promise<void> {
  try {
    await fetch('https://us.i.posthog.com/capture/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        event: payload.event,
        distinct_id: payload.install_id,
        properties: {
          app_version: payload.app_version,
          os: payload.os,
          os_arch: payload.os_arch,
          locale: payload.locale,
          $lib: 'nuclei-desktop',
        },
      }),
    });
  } catch {
    // Intentionally swallowed — analytics must never break the ingest path.
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: corsHeaders(),
    });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400, headers: corsHeaders() });
  }

  const payload = parsePayload(raw);
  if (!payload) {
    return new Response('Bad payload', { status: 400, headers: corsHeaders() });
  }

  // Durable log line. Every install event is one line, grep-able.
  // Format matches Vercel Edge log conventions.
  console.log(
    JSON.stringify({
      kind: 'nuclei_install_telemetry',
      ts: new Date().toISOString(),
      ...payload,
    }),
  );

  const posthogKey = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.POSTHOG_API_KEY;
  if (posthogKey) {
    await forwardToPostHog(payload, posthogKey);
  }

  return new Response(null, { status: 204, headers: corsHeaders() });
}
