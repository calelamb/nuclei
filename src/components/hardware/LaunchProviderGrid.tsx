import { useThemeStore } from '../../stores/themeStore';
import { ProviderLogo } from './ProviderLogo';
import { ProviderStatusBadge } from './ProviderStatusBadge';
import { QSHARP_GATE_TOOLTIP, providerStatus } from './launchGating';
import { PROVIDERS, type ProviderMeta } from './launchProviders';
import type { HardwareProviderType } from '../../types/hardware';
import { TYPOGRAPHY } from '../../styles/tokens';

interface Props {
  readonly isWeb: boolean;
  readonly cudaqInstalled: boolean;
  readonly connected: ReadonlySet<HardwareProviderType>;
  readonly qsharpBlocks: (provider: HardwareProviderType) => boolean;
  readonly onPick: (provider: ProviderMeta) => void;
}

const PRICING_LABEL: Record<ProviderMeta['pricing'], string> = {
  Free: 'Free',
  Credits: 'Credits',
  Paid: 'Paid',
  Local: 'Local',
};

/** Step one: where to run. Every card carries the same status badge the Hardware panel shows. */
export function LaunchProviderGrid({ isWeb, cudaqInstalled, connected, qsharpBlocks, onPick }: Props) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 14,
      }}
    >
      {PROVIDERS.map((p) => {
        const status = providerStatus({
          provider: p.name,
          connected: connected.has(p.name),
          isWeb,
          cudaqInstalled,
        });
        const qsharpBlocked = qsharpBlocks(p.name);
        const disabled = status.kind === 'coming-soon' || qsharpBlocked;
        const card = (
          <button
            type="button"
            className="nuclei-hover-lift"
            data-provider={p.name}
            onClick={() => onPick(p)}
            disabled={disabled}
            style={{
              textAlign: 'left',
              background: disabled ? 'transparent' : colors.bgElevated,
              border: `1px solid ${colors.border}`,
              borderRadius: 14,
              padding: 16,
              cursor: disabled ? 'not-allowed' : 'pointer',
              color: colors.text,
              fontFamily: TYPOGRAPHY.fontSans,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minHeight: 160,
              transition: 'transform 150ms ease, border-color 120ms ease, background 120ms ease',
              opacity: disabled ? 0.55 : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: `${colors.accent}14`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: colors.accentLight,
                }}
              >
                <ProviderLogo provider={p.name} size={32} />
              </div>
              <span style={{ fontSize: 12, color: colors.textMuted }}>{PRICING_LABEL[p.pricing]}</span>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>{p.label}</div>
              <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 1.5 }}>
                {p.tagline}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div>
              {qsharpBlocked ? (
                <span style={{ fontSize: 12, color: colors.textMuted }}>{QSHARP_GATE_TOOLTIP}</span>
              ) : (
                <ProviderStatusBadge status={status} />
              )}
            </div>
          </button>
        );
        return <span key={p.name} style={{ display: 'contents' }}>{card}</span>;
      })}
    </div>
  );
}
