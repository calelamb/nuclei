import { useEditorStore } from '../stores/editorStore';
import { kernelLanguageFor } from '../types/quantum';

const LEGACY_CREDENTIAL_PREFIX = 'nuclei-hardware-';

/** Hand credentials stashed in localStorage by earlier builds to the kernel, then wipe them. */
function migrateLegacyCredentials(ws: WebSocket): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LEGACY_CREDENTIAL_PREFIX)) continue;
      const provider = key.slice(LEGACY_CREDENTIAL_PREFIX.length);
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const creds = JSON.parse(raw);
        if (creds && typeof creds === 'object') {
          ws.send(JSON.stringify({ type: 'hardware_set_credentials', provider, credentials: creds }));
        }
      } catch { /* malformed legacy entry - drop it */ }
      localStorage.removeItem(key);
    }
  } catch { /* localStorage may be unavailable in some embedded webviews */ }
}

/**
 * Everything the app sends once the kernel has accepted our session token:
 * parse the open document, migrate legacy credentials, and rehydrate
 * hardware providers and the persistent job list.
 */
export function sendPostAuthMessages(ws: WebSocket): void {
  const { code, framework, filePath } = useEditorStore.getState();
  if (code.trim()) {
    ws.send(JSON.stringify({ type: 'parse', code, language: kernelLanguageFor(framework, filePath) }));
  }
  migrateLegacyCredentials(ws);
  ws.send(JSON.stringify({ type: 'hardware_connected_providers' }));
  ws.send(JSON.stringify({ type: 'hardware_list_jobs' }));
}
