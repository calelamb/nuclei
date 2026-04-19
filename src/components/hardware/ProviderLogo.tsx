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
      // Four rows of striped bars — IBM's classic striped mark, abstracted.
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
      // Angular parallelogram — NVIDIA's signature silhouette, abstracted.
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
    case 'braket':
      // Stacked tiers + triangular roof — AWS Braket as an aggregator.
      return (
        <svg {...common}>
          <path d="M8 18 L24 8 L40 18 L32 18 L24 14 L16 18 Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          <path d="M10 28 L38 28" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <path d="M14 36 L34 36" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
          <path d="M18 42 L30 42" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.45" />
        </svg>
      );
    case 'azure':
      // Two overlapping triangles — evokes Azure's A-mark.
      return (
        <svg {...common}>
          <path d="M10 38 L22 10 L34 38 Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          <path d="M20 38 L30 18 L40 38 Z" stroke={color} strokeWidth="2" strokeLinejoin="round" opacity="0.6" />
        </svg>
      );
    case 'quantinuum':
      // Figure-eight track — "ions cycling through a race-track trap".
      return (
        <svg {...common}>
          <path
            d="M14 24 C14 16 24 16 24 24 C24 32 34 32 34 24 C34 16 24 16 24 24 C24 32 14 32 14 24 Z"
            stroke={color}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <circle cx="24" cy="24" r="2.5" fill={color} />
        </svg>
      );
    case 'xanadu':
      // Horizontal photon pulse — hints at continuous-variable optics.
      return (
        <svg {...common}>
          <path
            d="M4 24 Q12 12 20 24 T36 24 T44 24"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="24" cy="24" r="3" fill={color} />
        </svg>
      );
    case 'dwave':
      // Discrete tiled grid — annealing / Ising lattice.
      return (
        <svg {...common}>
          {[0, 1, 2].map((r) =>
            [0, 1, 2].map((c) => (
              <rect
                key={`${r}-${c}`}
                x={8 + c * 11}
                y={8 + r * 11}
                width="8"
                height="8"
                rx="1.5"
                stroke={color}
                strokeWidth="1.5"
                opacity={r === 1 && c === 1 ? 1 : 0.55}
              />
            )),
          )}
        </svg>
      );
    case 'simulator':
    default:
      // Lightning bolt inside a square — "local / fast" vibe.
      return (
        <svg {...common}>
          <rect x="6" y="6" width="36" height="36" rx="6" stroke={color} strokeWidth="2.5" />
          <path d="M24 12 L16 26 L22 26 L20 36 L30 22 L24 22 Z" fill={color} />
        </svg>
      );
  }
}
