/**
 * PRD 09 Phase D (D3) — "Open run folder" for a historical experiment run.
 * Desktop-only (Research mode itself is desktop-only per the PRD's
 * non-goals); no-ops harmlessly on web/test environments where the Tauri
 * shell plugin isn't available.
 */
export async function openRunFolder(path: string): Promise<void> {
  const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  if (!isTauri) return;

  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(path);
  } catch (err) {
    console.warn('Failed to open run folder', err);
  }
}
