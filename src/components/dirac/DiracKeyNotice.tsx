import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { useDiracStore } from '../../stores/diracStore';
import { useThemeStore } from '../../stores/themeStore';
import { Button } from '../ui';

export const DIRAC_KEY_NOTICE_TITLE = 'Connect Dirac to use AI edits';
export const DIRAC_KEY_NOTICE_BODY = 'Add your Anthropic API key in the Dirac panel. It stays on this device.';

/** True when Dirac has no usable key. Reactive, so a surface switches the moment a key is saved. */
export function useHasDiracKey(): boolean {
  return useDiracStore((s) => Boolean(s.apiKey && s.apiKey.trim() !== ''));
}

/** Opens the Dirac panel on its key form and puts the caret in the key field. */
export function openDiracKeyEntry(): void {
  useDiracPanelStore.getState().focusInput();
}

interface Props {
  /** Called after the key form is requested, so the host surface can close itself. */
  onAddKey: () => void;
}

/**
 * The one "no key" state for the editor's AI surfaces (⌘K inline edit and ⌘I Compose):
 * it explains what is missing and offers the action, instead of overwriting the prompt.
 */
export function DiracKeyNotice({ onAddKey }: Props) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ color: colors.text, fontSize: 13, fontWeight: 600 }}>{DIRAC_KEY_NOTICE_TITLE}</div>
        <div style={{ color: colors.textMuted, fontSize: 12, lineHeight: 1.4, marginTop: 2 }}>
          {DIRAC_KEY_NOTICE_BODY}
        </div>
      </div>
      <Button
        size="sm"
        variant="primary"
        onClick={() => { onAddKey(); openDiracKeyEntry(); }}
      >
        Add API key
      </Button>
    </div>
  );
}
