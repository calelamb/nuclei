import { useEffect } from 'react';
import { usePlatform } from '../../platform/PlatformProvider';
import { useEditorStore } from '../../stores/editorStore';
import { useTrainabilityStore } from '../../stores/trainabilityStore';

export const INSPECT_DEBOUNCE_MS = 500;

function currentTarget() {
  const { code, framework, filePath } = useEditorStore.getState();
  return { code, framework, filePath };
}

/** Run the analyses for the active editor file (target bar button and ⌘⇧↵). */
export function runTrainabilityAnalyses(): void {
  void useTrainabilityStore.getState().start(currentTarget());
}

/**
 * Keeps the Lab's inspection in sync with the active editor file while the
 * Lab is mounted, binds the platform, and wires ⌘⇧↵ (⌘↵ stays the global
 * simulator run, so it is never claimed here).
 */
export function useTrainabilityTarget(): void {
  const platform = usePlatform().getPlatform();
  const code = useEditorStore((s) => s.code);
  const framework = useEditorStore((s) => s.framework);
  const filePath = useEditorStore((s) => s.filePath);

  useEffect(() => {
    useTrainabilityStore.getState().setPlatform(platform);
  }, [platform]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void useTrainabilityStore.getState().refreshInspection({ code, framework, filePath });
    }, INSPECT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [code, framework, filePath, platform]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !event.shiftKey || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      runTrainabilityAnalyses();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
