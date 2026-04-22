import { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, X, Loader2 } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useDiracStore } from '../../stores/diracStore';
import { useThemeStore } from '../../stores/themeStore';
import { compose } from '../../services/compose';

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * ⌘I quick-ask. Gathers the student's intent, calls the compose service,
 * and stores the result as a ComposePreview for the DiffPreview overlay
 * to pick up.
 */
export function ComposeModal({ open, onClose }: ComposeModalProps) {
  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const framework = useEditorStore((s) => s.framework);
  const currentCode = useEditorStore((s) => s.code);
  const setPreview = useDiracStore((s) => s.setComposePreview);

  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setIntent('');
        setError(null);
      });
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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

  if (!open) return null;

  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          zIndex: 9998,
        }}
      />
      <div
        role="dialog"
        aria-label="Ask Dirac to write code"
        style={{
          position: 'fixed',
          top: '14vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(680px, 92vw)',
          background: colors.bgPanel,
          border: `1px solid ${colors.borderStrong}`,
          borderRadius: 12,
          boxShadow: shadow.lg,
          padding: 14,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: colors.dirac,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          <Sparkles size={14} />
          Dirac · Compose
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: colors.textDim,
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={14} />
          </button>
        </div>
        <input
          ref={inputRef}
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Describe what you want — e.g. 'a 3-qubit GHZ state'"
          style={{
            background: colors.bgElevated,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: '10px 12px',
            color: colors.text,
            fontSize: 14,
            fontFamily: "'Geist Sans', sans-serif",
            outline: 'none',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 11,
            color: colors.textDim,
          }}
        >
          {loading && (
            <>
              <Loader2 size={12} style={{ animation: 'nuclei-spin 800ms linear infinite' }} /> Thinking…
            </>
          )}
          {!loading && (
            <span>
              Framework: <span style={{ color: colors.accentLight }}>{framework}</span> · Enter to submit · Esc to close
            </span>
          )}
          {error && (
            <span style={{ color: colors.error, marginLeft: 'auto' }}>{error}</span>
          )}
        </div>
      </div>
    </>
  );
}
