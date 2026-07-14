/**
 * Plugin persistence — remember which plugin folders were loaded (and whether
 * they were enabled) so they reload on the next launch.
 *
 * Only `{ source, enabled }` is ever serialized — never the live `api` or any
 * closures. On boot, `pluginLoader.restorePersistedPlugins()` re-reads each
 * folder from disk (picking up the author's on-disk edits) and re-activates
 * the enabled ones. A moved/deleted folder surfaces as an honest error record,
 * not a ghost entry.
 *
 * Storage reuses the app's `settings.json` store via the platform bridge, so
 * this works on desktop and no-ops safely on web (the web bridge returns null).
 */

import { z } from 'zod';
import { loadBridge } from '../platform/PlatformProvider';
import { usePluginStore } from './pluginManager';

const STORE_KEY = 'installedPlugins';

const recordSchema = z.object({
  source: z.string().min(1),
  enabled: z.boolean(),
});
const recordsSchema = z.array(recordSchema);

export type PersistedPlugin = z.infer<typeof recordSchema>;

/** Read the persisted plugin records. Never throws — returns [] on any error. */
export async function readPersistedPlugins(): Promise<PersistedPlugin[]> {
  try {
    const bridge = await loadBridge();
    const raw = await bridge.getStoredValue<unknown>(STORE_KEY);
    const parsed = recordsSchema.safeParse(raw);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/**
 * Snapshot the current installed plugins to storage. Sourceless legacy records
 * (no folder path) are skipped — there is nothing to reload them from.
 * Best-effort: a write failure must not break the UI.
 */
export async function persistInstalledPlugins(): Promise<void> {
  try {
    const bridge = await loadBridge();
    const records: PersistedPlugin[] = usePluginStore
      .getState()
      .plugins.map((p) => ({ source: p.source, enabled: p.enabled }))
      .filter((r) => r.source.length > 0);
    await bridge.setStoredValue(STORE_KEY, records);
  } catch {
    // Best-effort persistence.
  }
}
