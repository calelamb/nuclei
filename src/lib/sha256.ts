/**
 * SHA-256 hex digest via the Web Crypto API (available in both the desktop
 * webview and Node's test runtime as `globalThis.crypto.subtle`). Kept as a
 * tiny standalone helper so the experiment runner can hash entry code and
 * manifests without pulling in a hashing dependency.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
