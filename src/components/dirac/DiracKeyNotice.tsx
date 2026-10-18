import { useThemeStore } from '../../stores/themeStore';
import { Button } from '../ui';
import { DIRAC_KEY_NOTICE_BODY, DIRAC_KEY_NOTICE_TITLE, openDiracKeyEntry } from './diracKeyAccess';

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
