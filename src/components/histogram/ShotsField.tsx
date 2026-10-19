import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSimulationStore } from '../../stores/simulationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { TYPOGRAPHY } from '../../styles/tokens';
import { TextInput } from '../ui';
import { commitShotsDraft } from './shotsDraft';

/**
 * Shots entry for the histogram panel. Edits a local draft and commits on blur or Enter (an
 * out-of-range number is rejected with a hint, never rewritten), so typing "2048" never gets reverted keystroke by keystroke. It writes the same
 * setting Settings > Default shots shows.
 */
export function ShotsField() {
  const colors = useThemeStore((s) => s.colors);
  const shots = useSimulationStore((s) => s.shots);
  const setShots = useSimulationStore((s) => s.setShots);
  // The draft belongs to the shot count it was started from, so a change made elsewhere (Settings) replaces it.
  const [draftState, setDraftState] = useState<{ base: number; text: string } | null>(null);
  const draft = draftState !== null && draftState.base === shots ? draftState.text : null;
  const setDraft = (text: string | null) => setDraftState(text === null ? null : { base: shots, text });
  const [hint, setHint] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectOnDraft = useRef(false);

  // Focus swaps the grouped "1,024" for the plain "1024". Selecting before that re-render is lost, so
  // select once the plain value is in the DOM and typing replaces it instead of appending.
  useLayoutEffect(() => {
    if (draft !== null && selectOnDraft.current) {
      selectOnDraft.current = false;
      inputRef.current?.select();
    }
  }, [draft]);

  const commit = () => {
    if (draft === null) return;
    const result = commitShotsDraft(draft, shots);
    setHint(result.hint);
    setDraft(null);
    // A rejected draft keeps the current value, so nothing is written (Settings never sees a typo).
    if (result.value !== shots) {
      setShots(result.value);
      useSettingsStore.getState().updateKernel({ defaultShots: result.value });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') {
      setDraft(null);
      setHint(null);
    }
  };

  return (
    <label style={{ color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, display: 'flex', alignItems: 'center', gap: 6 }}>
      Shots
      <TextInput
        ref={inputRef}
        type="text"
        inputMode="numeric"
        size="sm"
        mono
        value={draft ?? shots.toLocaleString('en-US')}
        onFocus={() => { setHint(null); selectOnDraft.current = true; setDraft(String(shots)); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        aria-label="Shots"
        aria-describedby={hint ? 'histogram-shots-hint' : undefined}
        aria-invalid={hint ? true : undefined}
        style={{ width: 80 }}
      />
      {hint && (
        <span id="histogram-shots-hint" role="status" style={{ color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans }}>{hint}</span>
      )}
    </label>
  );
}
