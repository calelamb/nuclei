import { useEffect } from 'react';
import type { PlatformBridge } from '../platform/bridge';
import { useUIModeStore } from '../stores/uiModeStore';
import { useThemeStore } from '../stores/themeStore';

/**
 * Writes the user's UI mode and theme preference to platform storage whenever
 * they change, from ANY caller (onboarding, Settings, the status-bar chip, a
 * shortcut). Previously only a couple of call sites persisted, so a choice made
 * in Settings or onboarding silently reverted on reload.
 *
 * `ready` must stay false until the stored values have been read back, or the
 * store defaults would overwrite them.
 */
export function usePersistedPrefs(platform: Pick<PlatformBridge, 'setStoredValue'>, ready: boolean): void {
  useEffect(() => {
    if (!ready) return undefined;
    const write = (key: string, value: string) => {
      platform.setStoredValue(key, value).catch(() => {
        /* preference persistence is best-effort */
      });
    };
    const unsubUi = useUIModeStore.subscribe((state, prev) => {
      if (state.mode !== prev.mode) write('ui_mode', state.mode);
    });
    const unsubTheme = useThemeStore.subscribe((state, prev) => {
      if (state.preference !== prev.preference) write('theme', state.preference);
    });
    return () => {
      unsubUi();
      unsubTheme();
    };
  }, [platform, ready]);
}
