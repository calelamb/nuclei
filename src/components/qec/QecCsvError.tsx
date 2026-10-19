import { AlertCircle, X } from 'lucide-react';
import { IconButton } from '../ui';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { useThemeStore } from '../../stores/themeStore';
import { ICON_SIZE, ICON_STROKE, TYPOGRAPHY } from '../../styles/tokens';

const NOT_SINTER = 'Not a sinter stats CSV: ';

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Splits the parser's whole-file message into a plain lead sentence and the detail line behind it. */
function splitCsvError(message: string): { lead: string; detail: string | null } {
  if (message.startsWith(NOT_SINTER)) {
    return { lead: "This isn't a sinter stats CSV.", detail: capitalize(message.slice(NOT_SINTER.length)) };
  }
  return { lead: message, detail: null };
}

interface QecCsvErrorProps {
  message: string;
  id: string;
  /** When a file is already showing, a compact line says it is still on screen. */
  stillShowing?: string | null;
  compact?: boolean;
}

/** An inline danger notice for a rejected CSV: icon, one lead sentence, the specifics beneath. Keeps role=alert. */
export function QecCsvError({ message, id, stillShowing, compact = false }: QecCsvErrorProps) {
  const colors = useThemeStore((s) => s.colors);
  const clearCsvError = useQecCampaignStore((s) => s.clearCsvError);
  const { lead, detail } = splitCsvError(message);
  return (
    <div
      id={id}
      role="alert"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, textAlign: 'left',
        padding: compact ? '6px 12px' : '8px 10px', fontFamily: TYPOGRAPHY.fontSans, fontSize: 12, lineHeight: 1.45,
        color: colors.error, wordBreak: 'break-word',
        ...(compact
          ? { borderBottom: `1px solid ${colors.border}` }
          : { border: `1px solid ${colors.error}`, borderRadius: 'var(--radius-soft)', alignSelf: 'stretch' }),
      }}
    >
      <AlertCircle size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>{lead}{stillShowing ? ` Still showing ${stillShowing}.` : ''}</div>
        {detail && <div style={{ color: colors.textMuted, fontSize: 11 }}>{detail}</div>}
      </div>
      {compact && (
        <IconButton size="sm" aria-label="Dismiss" onClick={clearCsvError} style={{ marginLeft: 'auto', marginTop: -2 }}>
          <X size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}
