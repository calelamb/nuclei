import type { HardwareProviderType } from '../../types/hardware';

interface ProviderLogoProps {
  provider: HardwareProviderType;
  size?: number;
  color?: string;
}

/**
 * Minimal inline-SVG monograms for each hardware provider. Kept vector +
 * single-color so they tint to the theme accent and stay crisp at any size.
 * Not the official logos — deliberately abstract marks that read as
 * "provider X" without trademark risk.
 */
export function ProviderLogo({ provider, size = 48, color = 'currentColor' }: ProviderLogoProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 48 48',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
  };

  switch (provider) {
    case 'ibm':
      // Three pairs of horizontal bars — IBM's classic striped mark, abstracted.
      return (
        <svg {...common}>
          {[10, 18, 26, 34].map((y) => (
            <g key={y}>
              <rect x="6" y={y - 1} width="8" height="3" fill={color} />
              <rect x="16" y={y - 1} width="8" height="3" fill={color} />
              <rect x="26" y={y - 1} width="8" height="3" fill={color} />
              <rect x="36" y={y - 1} width="6" height="3" fill={color} />
            </g>
          ))}
        </svg>
      );
    case 'ionq':
      // Concentric ion trap: outer ring + inner ion point.
      return (
        <svg {...common}>
          <circle cx="24" cy="24" r="18" stroke={color} strokeWidth="2.5" />
          <circle cx="24" cy="24" r="10" stroke={color} strokeWidth="1.5" strokeDasharray="3 3" />
          <circle cx="24" cy="24" r="3" fill={color} />
          <circle cx="8" cy="24" r="2" fill={color} />
          <circle cx="40" cy="24" r="2" fill={color} />
        </svg>
      );
    case 'nvidia':
      // Angular parallelogram eye — NVIDIA's signature silhouette, abstracted.
      return (
        <svg {...common}>
          <path
            d="M8 32 L22 12 L40 12 L26 32 Z"
            stroke={color}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <circle cx="24" cy="22" r="3" fill={color} />
        </svg>
      );
    case 'google':
      // Four-arc quadrant ring — evocative of Google's Sycamore.
      return (
        <svg {...common}>
          <path d="M24 6 A18 18 0 0 1 42 24" stroke={color} strokeWidth="3" strokeLinecap="round" />
          <path d="M42 24 A18 18 0 0 1 24 42" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
          <path d="M24 42 A18 18 0 0 1 6 24" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.45" />
          <path d="M6 24 A18 18 0 0 1 24 6" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.25" />
        </svg>
      );
    case 'simulator':
    default:
      // Lightning bolt inside a square — "local / fast" vibe.
      return (
        <svg {...common}>
          <rect x="6" y="6" width="36" height="36" rx="6" stroke={color} strokeWidth="2.5" />
          <path
            d="M24 12 L16 26 L22 26 L20 36 L30 22 L24 22 Z"
            fill={color}
          />
        </svg>
      );
  }
}
