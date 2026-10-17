import { Check, X } from 'lucide-react';
import { useDiracStore } from '../../stores/diracStore';
import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';
import { TYPOGRAPHY } from '../../styles/tokens';
import { Button, Dialog } from '../ui';

const paneLabel = {
  padding: '6px 12px',
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
};

/**
 * Overlay shown after a successful compose. Side-by-side Current vs
 * Proposed buffer, Apply replaces the whole editor content, Reject
 * dismisses. Keyboard: Esc = reject; focus starts on Apply, so Enter applies.
 */
export function DiffPreview() {
  const preview = useDiracStore((s) => s.composePreview);
  const clear = useDiracStore((s) => s.clearComposePreview);
  const setCode = useEditorStore((s) => s.setCode);
  const currentCode = useEditorStore((s) => s.code);
  const colors = useThemeStore((s) => s.colors);

  if (!preview) return null;

  const accept = () => {
    setCode(preview.code);
    clear();
  };

  return (
    <Dialog
      title="Proposed code from Dirac"
      description={<>&ldquo;{preview.intent}&rdquo;{preview.explanation ? ` — ${preview.explanation}` : ''}</>}
      width={880}
      flush
      onClose={clear}
      initialFocus="[data-apply]"
      footer={(
        <>
          <Button onClick={clear} icon={<X size={14} />}>
            Reject <span style={{ color: colors.textDim, fontSize: 11 }}>Esc</span>
          </Button>
          <Button variant="primary" data-apply onClick={accept} icon={<Check size={14} />}>
            Apply <span style={{ opacity: 0.7, fontSize: 11 }}>↵</span>
          </Button>
        </>
      )}
    >
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0, maxHeight: '52vh' }}
      >
        <div style={{ borderRight: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ ...paneLabel, color: colors.textDim, borderBottom: `1px solid ${colors.border}` }}>Current</div>
          <pre style={{ margin: 0, padding: '10px 14px', overflow: 'auto', flex: 1, fontSize: 12, fontFamily: TYPOGRAPHY.fontMono, color: colors.textMuted, background: `${colors.error}08` }}>
            {currentCode || '(empty)'}
          </pre>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ ...paneLabel, color: colors.textDim, borderBottom: `1px solid ${colors.border}` }}>Proposed</div>
          <pre style={{ margin: 0, padding: '10px 14px', overflow: 'auto', flex: 1, fontSize: 12, fontFamily: TYPOGRAPHY.fontMono, color: colors.text, background: `${colors.success}08` }}>
            {preview.code}
          </pre>
        </div>
      </div>
    </Dialog>
  );
}
