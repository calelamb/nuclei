export async function openExternal(url: string): Promise<void> {
  const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  if (isTauri) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
      return;
    } catch (err) {
      console.warn('shell.open failed, falling back to window.open', err);
    }
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

export function buildYouTubeWatchUrl(youtubeId: string, startSeconds?: number): string {
  const base = `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`;
  return startSeconds && startSeconds > 0 ? `${base}&t=${Math.floor(startSeconds)}s` : base;
}
