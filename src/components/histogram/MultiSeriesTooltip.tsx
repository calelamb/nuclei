import type { ReactElement } from 'react';
import { TYPOGRAPHY } from '../../styles/tokens';
import type { ThemeColors } from '../../stores/themeStore';

/** One tooltip row as Recharts hands it over (only the fields we read). */
export interface TooltipRow {
  dataKey?: unknown;
  name?: unknown;
  value?: unknown;
  color?: string;
}

interface Props {
  active?: boolean;
  label?: unknown;
  payload?: readonly TooltipRow[];
  colors: ThemeColors;
  /** Rows are sorted by this (legend order, not Recharts' reversed bar order). */
  order: (dataKey: unknown) => number;
}

/**
 * Compare chart tooltip. The series colour is a swatch only: a bar fill is a graphic (3:1), so using it as text
 * failed AA in the light theme. Names and values use the neutral text token.
 */
export function MultiSeriesTooltip({ active, label, payload, colors, order }: Props): ReactElement | null {
  if (!active || !payload || payload.length === 0) return null;
  const rows = [...payload].sort((a, b) => order(a.dataKey) - order(b.dataKey));
  return (
    <div
      className="nuclei-chart-tooltip"
      style={{
        background: colors.bgElevated, border: `1px solid ${colors.borderStrong}`, 
        fontFamily: TYPOGRAPHY.fontMono, color: colors.text,
      }}
    >
      <div style={{ color: colors.text, marginBottom: 4 }}>{String(label ?? '')}</div>
      {rows.map((row) => (
        <div key={String(row.dataKey)} style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text }}>
          <span aria-hidden="true" data-swatch style={{ width: 9, height: 9, borderRadius: 2, background: row.color, flex: 'none' }} />
          <span>{String(row.name ?? '')}: {typeof row.value === 'number' ? row.value.toFixed(4) : String(row.value ?? '')}</span>
        </div>
      ))}
    </div>
  );
}
