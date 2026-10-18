import { useState, useCallback } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useDiracStore } from '../../stores/diracStore';
import { useThemeStore } from '../../stores/themeStore';
import { compose } from '../../services/compose';
import { Dialog, TextInput } from '../ui';
import { displayFrameworkName } from '../../data/starterTemplates';
import { DiracKeyNotice, useHasDiracKey } from './DiracKeyNotice';

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * ⌘I quick-ask. Gathers the student's intent, calls the compose service,
 * and stores the result as a ComposePreview for the DiffPreview overlay
 * to pick up. The dialog is mounted only while open, so the field starts
 * empty every time and focus returns to the editor on close.
 */
export function ComposeModal({ open, onClose }: ComposeModalProps) {
  if (!open) return null;
  return <ComposeDialog onClose={onClose} />;
}

function ComposeDialog({ onClose }: { onClose: () => void }) {
  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colors = useThemeStore((s) => s.colors);
  const framework = useEditorStore((s) => s.framework);
  const currentCode = useEditorStore((s) => s.code);
  const hasKey = useHasDiracKey();
  const setPreview = useDiracStore((s) => s.setComposePreview);

  const handleSubmit = useCallback(async () => {
    const text = intent.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    const res = await compose({ intent: text, framework, currentCode });
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPreview({ intent: text, code: res.code, explanation: res.explanation });
    onClose();
  }, [intent, loading, framework, currentCode, setPreview, onClose]);

  return (
    <Dialog
      title={(
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: colors.diracText }}>
          <Sparkles size={16} aria-hidden="true" /> Dirac · Compose
        </span>
      )}
      width={680}
      align="top"
      onClose={onClose}
      initialFocus="input"
    >
      {!hasKey ? (
        <DiracKeyNotice onAddKey={onClose} />
      ) : (
        <>
          <TextInput
            size="lg"
            value={intent}
            onChange={(e) => { setIntent(e.target.value); if (error) setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder="Describe what you want — e.g. 'a 3-qubit GHZ state'"
            aria-label="Describe what Dirac should compose"
            invalid={Boolean(error)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: 11, color: colors.textDim }}>
            {loading && (<><Loader2 className="nuclei-spin" size={12} /> Thinking…</>)}
            {!loading && (
              <span>
                Framework: <span style={{ color: colors.accentText }}>{displayFrameworkName(framework)}</span> · Enter to submit · Esc to close
              </span>
            )}
            {error && <span role="alert" style={{ color: colors.error, marginLeft: 'auto' }}>{error}</span>}
          </div>
        </>
      )}
    </Dialog>
  );
}
