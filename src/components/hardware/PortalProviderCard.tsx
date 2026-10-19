import { Tooltip } from '../ui';
import { useThemeStore } from '../../stores/themeStore';
import { TYPOGRAPHY } from '../../styles/tokens';
import { ProviderLogo } from './ProviderLogo';
import { ProviderStatusBadge } from './ProviderStatusBadge';
import type { ProviderStatus } from './launchGating';
import type { ProviderMeta } from './launchProviders';

interface PortalProviderCardProps {
  readonly provider: ProviderMeta;
  readonly status: ProviderStatus;
  /** Why the card is inert (coming soon, Q# gating), shown on a shared Tooltip; null when there is no reason to show. */
  readonly reason: string | null;
  /** Truly unavailable (coming soon, Q# gating): aria-disabled, dimmed, not-allowed cursor. */
  readonly inert: boolean;
  /** Desktop-only: still activates (opens the launcher's Download note), so it is neither aria-disabled nor dimmed; only the logo is softened. */
  readonly muted?: boolean;
  readonly onPick: () => void;
}

/**
 * One destination in the Launch sidebar. Name and description come from the shared provider catalog,
 * so the sidebar, the full launcher and the Hardware panel can never describe a provider differently.
 */
export function PortalProviderCard({ provider, status, reason, inert, muted = false, onPick }: PortalProviderCardProps) {
  const colors = useThemeStore((s) => s.colors);
  // Dim only the logo; copy stays AA-legible, and so does the "Desktop app" reason.
  const dim: React.CSSProperties = inert || muted ? { opacity: 0.5 } : {};
  const copyDim: React.CSSProperties = inert ? { opacity: 0.5 } : {};
  const badgeId = `portal-badge-${provider.name}`;
  const card = (
    <button
      className={inert ? undefined : 'nuclei-hover-lift'}
      data-provider={provider.name}
      onClick={onPick}
      aria-disabled={inert || undefined}
      aria-describedby={muted && !inert ? badgeId : undefined}
      style={{
        textAlign: 'left',
        background: colors.bgElevated,
        border: `1px solid ${colors.border}`,
        borderRadius: 'var(--radius-round)',
        padding: 10,
        cursor: inert ? 'not-allowed' : 'pointer',
        color: colors.text,
        fontFamily: TYPOGRAPHY.fontSans,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        transition: 'border-color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard)',
      }}
    >
      <div
        style={{
          ...dim, width: 30, height: 30, borderRadius: 6, background: `${colors.accent}14`, color: colors.accentLight,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <ProviderLogo provider={provider.name} size={20} />
      </div>
      <div className="launch-grid__name" style={{ ...copyDim, fontSize: 12, fontWeight: 600, color: muted ? colors.textMuted : colors.text }}>{provider.label}</div>
      <div
        style={{
          ...copyDim, fontSize: 11, color: muted ? colors.textDim : colors.textMuted, lineHeight: 1.4, overflow: 'hidden',
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const,
        }}
      >
        {provider.tagline}
      </div>
      {status.kind === 'desktop-only' && (
        <span id={badgeId} data-testid="portal-badge-cell" style={{ alignSelf: 'flex-start', display: 'flex' }}>
          <ProviderStatusBadge status={status} />
        </span>
      )}
    </button>
  );
  // A blocked card stays focusable so its reason is reachable by keyboard as well as by pointer.
  return reason ? <Tooltip label={reason} placement="above">{card}</Tooltip> : card;
}
