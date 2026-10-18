import type { ReactNode } from 'react';
import { MoreVertical, EyeOff, RotateCcw, HelpCircle, type LucideIcon } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';

import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { IconButton, Menu, type MenuEntry } from '../ui';
/**
 * PRD 11 Phase C — the shared panel header.
 *
 * One header chrome for every panel: a title (optional icon + context), an
 * actions slot, and an overflow menu (Hide panel / Reset layout / Help→docs).
 * PRD 10 Phase D's QEC panels register into the panel registry and inherit
 * THIS header instead of hand-rolling their own — which is why Phase C gates
 * that work.
 *
 * Style matches the existing hand-rolled headers (RunDetail, BottomPanel tabs):
 * a slim bar with a bottom border, uppercase-free 13px title, right-aligned
 * actions. No new dependencies — the overflow menu reuses the app's portal
 * dropdown pattern.
 */
export interface PanelHeaderProps {
  title: string;
  /** Secondary context after the title, e.g. the active experiment name. */
  context?: string;
  icon?: LucideIcon;
  /** Leading element before the title (e.g. a back button). */
  leading?: ReactNode;
  /** Right-aligned action buttons, before the overflow menu. */
  actions?: ReactNode;
  /** Overflow: hide this panel (wired to layoutStore.setPanelOverride). */
  onHide?: () => void;
  /** Overflow: reset the panel layout (layoutStore.resetPanelOverrides). */
  onResetLayout?: () => void;
  /** Overflow: deep-link to the relevant docs page. */
  helpHref?: string;
}

export function PanelHeader({
  title,
  context,
  icon: Icon,
  leading,
  actions,
  onHide,
  onResetLayout,
  helpHref,
}: PanelHeaderProps) {
  const colors = useThemeStore((s) => s.colors);
  const openHelp = () => { if (helpHref) window.open(helpHref, '_blank', 'noopener,noreferrer'); };
  const helpOnly = Boolean(helpHref) && !onHide && !onResetLayout;
  const entries: MenuEntry[] = [
    ...(onHide ? [{ id: 'hide', label: 'Hide panel', icon: <EyeOff size={ICON_SIZE.md} />, onSelect: onHide }] : []),
    ...(onResetLayout ? [{ id: 'reset', label: 'Reset layout', icon: <RotateCcw size={ICON_SIZE.md} />, onSelect: onResetLayout }] : []),
    ...(helpHref ? [{ id: 'help', label: 'Help', icon: <HelpCircle size={ICON_SIZE.md} />, onSelect: openHelp }] : []),
  ];

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        padding: '10px 12px', borderBottom: `1px solid ${colors.border}`,
        background: colors.bg,
      }}
    >
      {leading}
      {Icon && <Icon size={14} color={colors.textDim} />}
      <span
        style={{
          fontSize: 13, fontWeight: 600, color: colors.text,
          fontFamily: TYPOGRAPHY.fontSans,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>
      {context && (
        <span
          style={{
            fontSize: 11, color: colors.textDim, fontFamily: TYPOGRAPHY.fontMono,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {context}
        </span>
      )}
      <div style={{ flex: 1 }} />
      {actions}
      {helpOnly && (
        <IconButton size="sm" aria-label="Help" onClick={openHelp} tooltip={{ placement: 'below' }}>
          <HelpCircle size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
        </IconButton>
      )}
      {!helpOnly && entries.length > 0 && (
        <Menu
          label={`${title} panel options`}
          placement="bottom-end"
          entries={entries}
          trigger={(p) => (
            <IconButton {...p} size="sm" aria-label="Panel options" tooltip={{ placement: 'below' }}>
              <MoreVertical size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
            </IconButton>
          )}
        />
      )}
    </div>
  );
}
