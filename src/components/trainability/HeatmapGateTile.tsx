import type { CSSProperties } from 'react';
import { seqInk } from '../lab';
import type { GateOverlay } from './heatmapMath';
import { overlayLabel, shortGateName, tileFill, type TileBox } from './heatmapTileLabels';

/**
 * One parameterized gate: a tinted rounded box with its name. The label ink
 * comes from the sequential ink tokens (black or white by luminance), so it
 * stays readable on every ramp step in both themes.
 */
export function HeatmapGateTile({
  overlay,
  box,
  labelX,
  labelY,
  gateName,
  hatchDead,
  hatchUnresolved,
  onShow,
  onHide,
}: {
  overlay: GateOverlay;
  box: TileBox;
  labelX: number;
  labelY: number;
  gateName: string;
  hatchDead: string;
  hatchUnresolved: string;
  onShow: (overlay: GateOverlay, x: number, y: number) => void;
  onHide: () => void;
}) {
  const flat = overlay.t === null;
  const tinted = !flat;
  const textStyle: CSSProperties = {
    fill: tinted ? seqInk(overlay.t as number) : 'var(--color-text-primary)',
    // A halo only helps on the flat/hatched fills; on a ramp step it would muddy the ink.
    stroke: tinted ? 'none' : 'var(--lab-surface-2)',
    strokeWidth: tinted ? 0 : 3,
    paintOrder: 'stroke',
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
  };
  return (
    <g
      tabIndex={0}
      role="img"
      aria-label={overlayLabel(overlay)}
      style={{ cursor: 'default', outline: 'none' }}
      className="trainability-gate"
      onPointerEnter={(e) => onShow(overlay, e.clientX, e.clientY)}
      onPointerMove={(e) => onShow(overlay, e.clientX, e.clientY)}
      onPointerLeave={onHide}
      onFocus={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onShow(overlay, r.right, r.top);
      }}
      onBlur={onHide}
    >
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={5}
        style={{
          fill: tileFill(overlay, hatchDead, hatchUnresolved),
          stroke: overlay.dead ? 'var(--color-text-tertiary)' : 'var(--color-accent-quantum)',
          strokeWidth: flat && !overlay.dead && !overlay.unresolved ? 1.2 : 1.6,
          strokeDasharray: overlay.unresolved || (flat && !overlay.dead) ? '3 2' : undefined,
        }}
      />
      <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="central" style={textStyle}>
        {shortGateName(gateName)}
      </text>
    </g>
  );
}
