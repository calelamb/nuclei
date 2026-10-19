import { useState, type KeyboardEvent } from 'react';
import { useSimulationStore } from '../../stores/simulationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { TYPOGRAPHY } from '../../styles/tokens';
import { TextInput } from '../ui';
import { commitShotsDraft, MAX_SHOTS, MIN_SHOTS } from './shotsDraft';

/**
 * Shots entry for the histogram panel. Edits a local draft and commits on blur or Enter (clamped,
 * with a hint), so typing "2048" never gets reverted keystroke by keystroke. It writes the same
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

  const commit = () => {
    if (draft === null) return;
    const result = commitShotsDraft(draft, shots);
    setHint(result.hint);
    setDraft(null);
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
      Shots:
      <TextInput
        type="text"
        inputMode="numeric"
        size="sm"
        mono
        value={draft ?? shots.toLocaleString('en-US')}
        onFocus={(e) => { setDraft(String(shots)); e.currentTarget.select(); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        aria-label="Shots"
        aria-describedby={hint ? 'histogram-shots-hint' : undefined}
        aria-invalid={hint ? true : undefined}
        title={`${MIN_SHOTS.toLocaleString('en-US')} to ${MAX_SHOTS.toLocaleString('en-US')} shots`}
        style={{ width: 80 }}
      />
      {hint && (
        <span id="histogram-shots-hint" role="status" style={{ color: colors.warning, fontSize: 11 }}>{hint}</span>
      )}
    </label>
  );
}
