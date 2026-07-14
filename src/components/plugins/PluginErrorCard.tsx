import { AlertTriangle } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';

interface PluginErrorCardProps {
  /** Short label (usually the plugin or panel name) shown in the card header. */
  title: string;
  /** The failure reason — printed verbatim so the author can act on it. */
  message: string;
}

/**
 * Inline red status card for a plugin (or one of its panels) that failed to
 * load, activate, or render. Per-plugin error isolation means one broken
 * plugin surfaces here instead of blanking the whole Plugins view.
 */
export function PluginErrorCard({ title, message }: PluginErrorCardProps) {
  const colors = useThemeStore((s) => s.colors);
  const font = "'Geist Sans', sans-serif";

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        padding: '10px 12px',
        margin: '8px 12px',
        borderRadius: 6,
        border: `1px solid ${colors.error}55`,
        background: `${colors.error}12`,
        fontFamily: font,
      }}
    >
      <AlertTriangle size={14} color={colors.error} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.error }}>{title}</div>
        <div
          style={{
            fontSize: 11,
            color: colors.textMuted,
            marginTop: 2,
            lineHeight: 1.4,
            wordBreak: 'break-word',
            fontFamily: "'Geist Mono', monospace",
          }}
        >
          {message}
        </div>
      </div>
    </div>
  );
}
