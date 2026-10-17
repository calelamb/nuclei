import type { MarkerShape } from '../../lib/qecPlotStyle';

export const MARKER_RADIUS = 3.6;
const f = (n: number) => Number(n.toFixed(2));

interface MarkerProps {
  shape: MarkerShape;
  cx: number;
  cy: number;
  color: string;
  r?: number;
}

/** Filled data marker; each shape stays recognisable at 7px. */
export function Marker({ shape, cx, cy, color, r = MARKER_RADIUS }: MarkerProps) {
  switch (shape) {
    case 'square':
      return <rect x={f(cx - r)} y={f(cy - r)} width={f(2 * r)} height={f(2 * r)} fill={color} />;
    case 'diamond': {
      const d = r * 1.35;
      return <polygon points={`${f(cx)},${f(cy - d)} ${f(cx + d)},${f(cy)} ${f(cx)},${f(cy + d)} ${f(cx - d)},${f(cy)}`} fill={color} />;
    }
    case 'cross': {
      const d = r * 0.95;
      return (
        <path
          d={`M${f(cx - d)} ${f(cy - d)}L${f(cx + d)} ${f(cy + d)}M${f(cx - d)} ${f(cy + d)}L${f(cx + d)} ${f(cy - d)}`}
          stroke={color} strokeWidth={1.8} strokeLinecap="round" fill="none"
        />
      );
    }
    default:
      return <circle cx={f(cx)} cy={f(cy)} r={f(r)} fill={color} />;
  }
}

/** Hollow downward triangle: a zero-error point drawn at its upper bound. */
export function UpperLimitMarker({ cx, cy, color, fill, r = MARKER_RADIUS }: { cx: number; cy: number; color: string; fill: string; r?: number }) {
  const w = r * 1.25;
  return (
    <polygon
      points={`${f(cx - w)},${f(cy - r)} ${f(cx + w)},${f(cy - r)} ${f(cx)},${f(cy + r * 1.2)}`}
      fill={fill} stroke={color} strokeWidth={1.4} strokeLinejoin="round"
    />
  );
}
