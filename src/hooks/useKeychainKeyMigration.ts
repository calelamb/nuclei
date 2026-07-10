import { useEffect, useRef } from 'react';
import { usePlatform } from '../platform/PlatformProvider';
import { useDiracStore } from '../stores/diracStore';

/**
 * One-time, idempotent migration for desktop installs upgrading from the
 * TS agent orchestrator to the Rust harness: the Anthropic API key used to
 * live only in `diracStore` (backed by localStorage). The Rust harness
 * reads it from the OS keychain instead, so on mount we check whether the
 * keychain already has a key and, if not, push whatever `diracStore`
 * currently holds into it. Runs once per app session; a no-op on web and
 * once the keychain has a key.
 *
 * `diracStore`'s own key (and localStorage persistence) is left untouched
 * — the non-agent chat surface (useDirac) keeps reading from there.
 */
export function useKeychainKeyMigration(): void {
  const platform = usePlatform();
  const isDesktop = platform.getPlatform() === 'desktop';
  const hasRun = useRef(false);

  useEffect(() => {
    if (!isDesktop || hasRun.current) return;
    hasRun.current = true;

    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const hasKeychainKey = await invoke<boolean>('dirac_has_api_key');
        if (hasKeychainKey) return;

        const localKey = useDiracStore.getState().apiKey;
        if (!localKey || localKey.trim() === '') return;

        await invoke('dirac_set_api_key', { key: localKey });
      } catch {
        // Best-effort — the agent will simply report "no API key" via
        // dirac_has_api_key next run, and chat (useDirac) is unaffected
        // either way since it never reads from the keychain.
      }
    })();
  }, [isDesktop]);
}
