import { formatInterval, formatSci, seqColor } from '../lab';
import type { GateOverlay } from './heatmapMath';

export interface TileBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Short label that fits a tile. */
export function shortGateName(name: string): string {
  return name.length > 5 ? `${name.slice(0, 4)}…` : name;
}

/** Fill for a tile: a hatch for dead / unresolved, the ramp for measured, flat otherwise. */
export function tileFill(overlay: GateOverlay, hatchDead: string, hatchUnresolved: string): string {
  if (overlay.dead) return `url(#${hatchDead})`;
  if (overlay.unresolved) return `url(#${hatchUnresolved})`;
  return overlay.t === null ? 'var(--lab-surface-3)' : seqColor(overlay.t);
}

/** Accessible name, never reading a ramp value out of a null variance. */
export function overlayLabel(overlay: GateOverlay): string {
  if (overlay.unresolved) {
    return `${overlay.parameter}: unresolved, interval only${overlay.interval ? ` ${formatInterval(overlay.interval, 2)}` : ''}`;
  }
  if (overlay.variance === null) return `${overlay.parameter}: variance not measured`;
  return `${overlay.parameter}: ${overlay.dead ? 'dead gate' : `variance ${formatSci(overlay.variance, 3)}`}`;
}

/** Tooltip rows for an overlay. */
export function overlayRows(overlay: GateOverlay): Array<{ label: string; value: string }> {
  return [
    {
      label: 'Var[∂C/∂θ]',
      value: overlay.unresolved ? 'unresolved (interval only)' : overlay.variance === null ? 'not measured' : formatSci(overlay.variance, 3),
    },
    ...(overlay.interval ? [{ label: 'interval', value: formatInterval(overlay.interval, 2) }] : []),
    { label: 'E|∂C/∂θ|', value: overlay.absMean === null ? '—' : formatSci(overlay.absMean, 3) },
    ...(overlay.dead ? [{ label: 'Status', value: 'dead (≈ zero variance)' }] : []),
  ];
}
