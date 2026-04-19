import { useDialogStore } from '../../stores/dialogStore';
import { useThemeStore } from '../../stores/themeStore';

export function UnsavedChangesModal() {
  const pending = useDialogStore((s) => s.pendingClose);
  const clearPending = useDialogStore((s) => s.clearPendingClose);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);

  if (!pending) return null;
  const { fileName, onSave, onDontSave, onCancel } = pending;

  return (
    <>
      <div
        role="presentation"
        onClick={() => {
          onCancel();
          clearPending();
        }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          zIndex: 9998,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          top: '32vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(440px, 92vw)',
          background: colors.bgPanel,
          border: `1px solid ${colors.borderStrong}`,
          borderRadius: 12,
          boxShadow: shadow.lg,
          padding: 18,
          zIndex: 9999,
          fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: colors.text,
            marginBottom: 8,
          }}
        >
          Save changes to {fileName}?
        </div>
        <div
          style={{
            fontSize: 12,
            color: colors.textMuted,
            marginBottom: 16,
            lineHeight: 1.5,
          }}
        >
          Your unsaved edits will be lost if you don't save.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => {
              onCancel();
              clearPending();
            }}
            style={{
              background: 'transparent',
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: '6px 14px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              await onDontSave();
              clearPending();
            }}
            style={{
              background: 'transparent',
              color: colors.error,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: '6px 14px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            Don't save
          </button>
          <button
            onClick={async () => {
              await onSave();
              clearPending();
            }}
            style={{
              background: colors.accent,
              color: '#0a0f1a',
              border: 'none',
              borderRadius: 8,
              padding: '6px 14px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
}
