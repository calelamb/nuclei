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
  /** aria-disabled + muted. A desktop-only card is still activatable: it opens the launcher's Download note. */
  readonly inert: boolean;
  readonly onPick: () => void;
}

/**
 * One destination in the Launch sidebar. Name and description come from the shared provider catalog,
 * so the sidebar, the full launcher and the Hardware panel can never describe a provider differently.
 */
export function PortalProviderCard({ provider, status, reason, inert, onPick }: PortalProviderCardProps) {
  const colors = useThemeStore((s) => s.colors);
  // Dim only the logo and copy; the "Desktop app" reason must stay legible.
  const dim: React.CSSProperties = inert ? { opacity: 0.5 } : {};
  const card = (
    <button
      className={inert ? undefined : 'nuclei-hover-lift'}
      data-provider={provider.name}
      onClick={onPick}
      aria-disabled={inert || undefined}
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
      <div className="launch-grid__name" style={{ ...dim, fontSize: 12, fontWeight: 600, color: colors.text }}>{provider.label}</div>
      <div
        style={{
          ...dim, fontSize: 11, color: colors.textMuted, lineHeight: 1.4, overflow: 'hidden',
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const,
        }}
      >
        {provider.tagline}
      </div>
      {status.kind === 'desktop-only' && (
        <span data-testid="portal-badge-cell" style={{ alignSelf: 'flex-start', display: 'flex' }}>
          <ProviderStatusBadge status={status} />
        </span>
      )}
    </button>
  );
  // A blocked card stays focusable so its reason is reachable by keyboard as well as by pointer.
  return reason ? <Tooltip label={reason} placement="above">{card}</Tooltip> : card;
}
