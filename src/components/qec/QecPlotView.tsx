import { useMemo, useState } from 'react';
import type { ThemeColors } from '../../stores/themeStore';
import type { PlotModel } from '../../lib/qecPlotModel';
import { tooltipLines } from '../../lib/qecPlotPoints';
import { FIGURE_FONT, QecPlotFigure, type HoverTarget } from './QecPlotFigure';

interface Props {
  model: PlotModel;
  colors: ThemeColors;
  width: number;
  height: number;
  metadata: string;
  title: string;
  description: string;
}

const TOOLTIP_WIDTH = 230;
const TOOLTIP_OFFSET = 14;

/** The interactive figure: hover shows the point's counts and interval in a tooltip. */
export function QecPlotView({ model, colors, width, height, metadata, title, description }: Props) {
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const series = useMemo(() => model.parts.find((s) => s.source.key === hover?.seriesKey)?.source, [model, hover]);
  const flip = hover !== null && hover.x > width - TOOLTIP_WIDTH - TOOLTIP_OFFSET;
  return (
    <div style={{ position: 'relative', width, height, flex: 'none' }}>
      <QecPlotFigure
        model={model} colors={colors} width={width} height={height} metadata={metadata}
        title={title} description={description} hover={hover} onHover={setHover}
      />
      {hover && series && (
        <div
          role="tooltip"
          style={{
            position: 'absolute', pointerEvents: 'none', width: TOOLTIP_WIDTH, zIndex: 2,
            left: flip ? hover.x - TOOLTIP_WIDTH - TOOLTIP_OFFSET : hover.x + TOOLTIP_OFFSET,
            top: Math.max(4, hover.y - 20),
            background: colors.bgElevated, color: colors.text, border: `1px solid ${colors.borderStrong}`,
            borderRadius: 6, padding: '6px 8px', fontSize: 11, lineHeight: 1.45, fontFamily: FIGURE_FONT,
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          }}
        >
          {tooltipLines(series, hover.point, model.units).map((line, i) => (
            <div key={i} style={{ fontWeight: i === 0 ? 600 : 400, color: i === 0 ? colors.text : colors.textMuted }}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
