/**
 * Nuclei Plugin System — manifest validation.
 *
 * A plugin folder's `plugin.json` is validated against this zod schema before
 * anything is loaded. The schema mirrors the existing `PluginManifest`
 * interface exactly (the parsed value is assigned back to `PluginManifest`
 * below as a compile-time drift guard), so tightening the manifest here can
 * never silently diverge from the runtime type the rest of the app consumes.
 *
 * The only guards that are real *safety* checks (as opposed to friendly UX
 * validation) are:
 *   - `entry`'s path-traversal refinement — the entry file must stay inside
 *     the plugin folder, so a manifest can't point the loader at `/etc/…` or
 *     `../../secrets.js`.
 *   - `z.strictObject` — unknown/typo'd keys are rejected rather than
 *     silently ignored, which catches `capabilties: [...]` at load time.
 *
 * Everything else (kebab-case name, semver version) is authoring ergonomics.
 */

import { z } from 'zod';
import type { PluginManifest } from './types';

/** The manifest filename at a plugin folder's root. */
export const MANIFEST_FILENAME = 'plugin.json';

export const CAPABILITIES = [
  'custom-panel',
  'gate-renderer',
  'kernel-extension',
  'dirac-skill',
  'theme',
] as const;

export const PERMISSIONS = [
  'read-circuit',
  'read-results',
  'read-editor',
  'write-editor',
] as const;

const KEBAB_CASE = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

/** Reject entry paths that escape the plugin folder (absolute or `..`). */
function isContainedEntry(p: string): boolean {
  if (p.startsWith('/') || p.startsWith('\\')) return false; // POSIX / UNC absolute
  if (/^[A-Za-z]:[\\/]/.test(p)) return false; // Windows drive absolute
  // Reject any `..` segment (covers `..`, `../x`, `a/../../b`, `a\..\b`).
  return !p.split(/[\\/]/).includes('..');
}

export const pluginManifestSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .regex(KEBAB_CASE, 'name must be kebab-case (lowercase letters, digits, hyphens)'),
  version: z.string().regex(SEMVER, 'version must be semver x.y.z'),
  description: z.string().default(''),
  author: z.string().default(''),
  entry: z
    .string()
    .min(1)
    .refine(isContainedEntry, 'entry must be a relative path inside the plugin folder (no "/" or "..")'),
  capabilities: z.array(z.enum(CAPABILITIES)).min(1, 'declare at least one capability'),
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
});

/** Output shape of the schema — kept identical to `PluginManifest`. */
export type ParsedManifest = z.infer<typeof pluginManifestSchema>;

export type ManifestParse =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; errors: string[] };

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * Parse + validate raw `plugin.json` text. Never throws — a malformed file,
 * bad JSON, or schema violation all come back as `{ ok: false, errors }` with
 * field-addressed messages the UI can show verbatim.
 */
export function parseManifestJson(text: string): ManifestParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`invalid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }

  const result = pluginManifestSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, errors: formatIssues(result.error) };
  }

  // Compile-time drift guard: if the schema output ever stops matching the
  // canonical `PluginManifest` interface, this assignment fails `tsc`.
  const manifest: PluginManifest = result.data;
  return { ok: true, manifest };
}
