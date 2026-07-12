import type { RunManifest } from '../types/experiment';

/**
 * PRD 09 Phase E (E1) — pure manifest-diff logic for the Compare view.
 *
 * Flattens each selected run's `manifest.json` into a single-level key/value
 * map (dotted paths for the nested `params` / `backend` / `git` / `versions`
 * objects), then partitions the union of keys into fields that are IDENTICAL
 * across every selected run (collapsed in the UI) vs. fields that DIFFER
 * (highlighted). No file/React dependency — CompareView renders the result.
 */

export type ManifestFieldValue = string | number | boolean | null;

export interface DiffField {
  key: string;
  /** One entry per input run, in the same order; `undefined` means the key
   * was absent for that run (e.g. a param or version key only some runs have). */
  values: Array<ManifestFieldValue | undefined>;
}

export interface DiffResult {
  /** Fields whose value differs across at least one pair of selected runs. */
  differing: DiffField[];
  /** Fields with the exact same value (or absence) across every run. */
  identical: Array<{ key: string; value: ManifestFieldValue | undefined }>;
}

function flattenManifest(manifest: RunManifest): Record<string, ManifestFieldValue> {
  const flat: Record<string, ManifestFieldValue> = {
    point_index: manifest.point_index,
    seed: manifest.seed,
    seed_honored: manifest.seed_honored,
    'backend.provider': manifest.backend.provider,
    'backend.target': manifest.backend.target,
    shots: manifest.shots,
    language: manifest.language,
    entry: manifest.entry,
    code_sha256: manifest.code_sha256,
    'git.commit': manifest.git ? manifest.git.commit : null,
    'git.dirty': manifest.git ? manifest.git.dirty : null,
    started_at: manifest.started_at,
    duration_ms: manifest.duration_ms,
    status: manifest.status,
    error: manifest.error,
  };
  for (const [name, value] of Object.entries(manifest.params)) {
    flat[`params.${name}`] = value;
  }
  for (const [name, value] of Object.entries(manifest.versions)) {
    flat[`versions.${name}`] = value;
  }
  return flat;
}

/**
 * Diff 2+ run manifests. Fields present in some runs but not others (e.g. a
 * version key only recorded by one framework, or a param only present in a
 * differently-shaped sweep) count as differing rather than being silently
 * dropped. A single manifest (or zero) has nothing to diff against, so every
 * field is reported as "identical" (there's no other run to differ from).
 */
export function diffManifests(manifests: readonly RunManifest[]): DiffResult {
  if (manifests.length === 0) return { differing: [], identical: [] };

  const flats = manifests.map(flattenManifest);
  const allKeys = new Set<string>();
  for (const flat of flats) {
    for (const key of Object.keys(flat)) allKeys.add(key);
  }

  const differing: DiffField[] = [];
  const identical: Array<{ key: string; value: ManifestFieldValue | undefined }> = [];

  for (const key of allKeys) {
    const values = flats.map((flat) => (key in flat ? flat[key] : undefined));
    const [first, ...rest] = values;
    const allSame = rest.every((v) => v === first);
    if (allSame) {
      identical.push({ key, value: first });
    } else {
      differing.push({ key, values });
    }
  }

  differing.sort((a, b) => a.key.localeCompare(b.key));
  identical.sort((a, b) => a.key.localeCompare(b.key));
  return { differing, identical };
}
