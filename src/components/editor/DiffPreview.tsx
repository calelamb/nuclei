import { useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { useDiracStore } from '../../stores/diracStore';
import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';

/**
 * Overlay shown after a successful compose. Side-by-side Current vs
 * Proposed buffer, Accept replaces the whole editor content, Reject
 * dismisses. Keyboard shortcuts: Enter = accept, Esc = reject.
 */
export function DiffPreview() {
  const preview = useDiracStore((s) => s.composePreview);
  const clear = useDiracStore((s) => s.clearComposePreview);
  const setCode = useEditorStore((s) => s.setCode);
  const currentCode = useEditorStore((s) => s.code);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        clear();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        setCode(preview.code);
        clear();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, clear, setCode]);

  if (!preview) return null;

  const accept = () => {
    setCode(preview.code);
    clear();
  };
  const reject = () => {
    clear();
  };

  return (
    <>
      <div
        role="presentation"
        onClick={reject}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          zIndex: 9998,
        }}
      />
      <div
        role="dialog"
        aria-label="Proposed code from Dirac"
        style={{
          position: 'fixed',
          top: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(880px, 94vw)',
          maxHeight: '72vh',
          background: colors.bgPanel,
          border: `1px solid ${colors.borderStrong}`,
          borderRadius: 12,
          boxShadow: shadow.lg,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            borderBottom: `1px solid ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            style={{
              color: colors.dirac,
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            Dirac · Preview
          </span>
          <span style={{ color: colors.textDim, fontSize: 12 }}>
            &ldquo;{preview.intent}&rdquo;
          </span>
        </div>
        {preview.explanation && (
          <div
            style={{
              padding: '8px 14px',
              color: colors.textMuted,
              fontSize: 12,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {preview.explanation}
          </div>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            flex: 1,
            minHeight: 0,
          }}
        >
          <div
            style={{
              borderRight: `1px solid ${colors.border}`,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: '6px 12px',
                fontSize: 10,
                color: colors.textDim,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                borderBottom: `1px solid ${colors.border}`,
              }}
            >
              Current
            </div>
            <pre
              style={{
                margin: 0,
                padding: '10px 14px',
                overflow: 'auto',
                flex: 1,
                fontSize: 12,
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                color: colors.textMuted,
                background: `${colors.error}08`,
              }}
            >
              {currentCode || '(empty)'}
            </pre>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div
              style={{
                padding: '6px 12px',
                fontSize: 10,
                color: colors.textDim,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                borderBottom: `1px solid ${colors.border}`,
              }}
            >
              Proposed
            </div>
            <pre
              style={{
                margin: 0,
                padding: '10px 14px',
                overflow: 'auto',
                flex: 1,
                fontSize: 12,
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                color: colors.text,
                background: `${colors.success}08`,
              }}
            >
              {preview.code}
            </pre>
          </div>
        </div>
        <div
          style={{
            padding: '10px 14px',
            borderTop: `1px solid ${colors.border}`,
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={reject}
            style={{
              background: 'transparent',
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: '6px 14px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <X size={13} /> Reject <span style={{ color: colors.textDim, fontSize: 11 }}>Esc</span>
          </button>
          <button
            onClick={accept}
            style={{
              background: colors.success,
              color: '#0a0f1a',
              border: 'none',
              borderRadius: 8,
              padding: '6px 14px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Check size={13} /> Apply <span style={{ opacity: 0.7, fontSize: 11 }}>↵</span>
          </button>
        </div>
      </div>
    </>
  );
}
