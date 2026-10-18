/**
 * Correlation ids for Lab sync requests (CR-M4). A request carries a
 * `request_id`; a kernel that supports it echoes the id on the reply and on
 * errors. Replies carrying a different id belong to another request and are
 * dropped; replies with no id come from an older kernel and are accepted, as
 * they were before ids existed.
 */

let counter = 0;

export function newRequestId(prefix: string): string {
  counter += 1;
  const c = globalThis.crypto;
  const entropy = c && typeof c.randomUUID === 'function' ? c.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${counter.toString(36)}-${entropy}`;
}

/** True when a reply may answer the request `sent`: same id, or no id at all (older kernel). */
export function replyMatches(sent: string, got: unknown): boolean {
  return got === undefined || got === null || got === sent;
}
