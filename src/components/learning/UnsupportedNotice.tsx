import { Monitor } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { openExternal } from '../../lib/openExternal';
import { DESKTOP_DOWNLOAD_URL, DESKTOP_VS_WEB_DOCS } from '../../config/docsLinks';

interface UnsupportedNoticeProps {
  /** The runtime's own explanation of what is outside the browser subset. */
  message: string;
}

/**
 * Calm, non-error state for code the browser build can't run (it ships a
 * Qiskit subset, not full Qiskit). Not red: the student did nothing wrong.
 */
export function UnsupportedNotice({ message }: UnsupportedNoticeProps) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div
      role="status"
      style={{
        display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 14px',
        background: `${colors.info}12`, border: `1px solid ${colors.info}40`, borderRadius: 8,
        fontFamily: "'Geist Sans', sans-serif",
      }}
    >
      <Monitor size={15} color={colors.info} style={{ marginTop: 1, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: colors.text, fontSize: 12, fontWeight: 600 }}>Runs in the desktop app</div>
        <div style={{ color: colors.textMuted, fontSize: 12, lineHeight: 1.5, marginTop: 2, wordBreak: 'break-word' }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => { void openExternal(DESKTOP_DOWNLOAD_URL); }}
            style={{
              height: 24, padding: '0 10px', borderRadius: 6, border: `1px solid ${colors.info}`,
              background: 'transparent', color: colors.text, fontSize: 12, cursor: 'pointer',
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            Get the desktop app
          </button>
          <button
            type="button"
            onClick={() => { void openExternal(DESKTOP_VS_WEB_DOCS); }}
            style={{
              height: 24, padding: '0 10px', borderRadius: 6, border: `1px solid ${colors.border}`,
              background: 'transparent', color: colors.textMuted, fontSize: 12, cursor: 'pointer',
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            What runs in the browser
          </button>
        </div>
      </div>
    </div>
  );
}
