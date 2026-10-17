import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { QecPlotFigure, type FigureColors, type QecPlotFigureProps } from '../components/qec/QecPlotFigure';
import { LIGHT_COLORS } from '../styles/tokens';

/** Paper palette: white page, dark text, regardless of the app theme. Series
 * colours come from the light palette (see buildPlotModel('light', ...)). */
export const PRINT_COLORS: FigureColors = {
  bg: LIGHT_COLORS.surfaceBase,
  text: LIGHT_COLORS.textPrimary,
  textMuted: LIGHT_COLORS.textSecondary,
  textDim: LIGHT_COLORS.textTertiary,
};

/** Pixel width of an exported QEC figure. Text stays at its on-screen pixel sizes. */
export const QEC_EXPORT_WIDTH = 900;
/** Height of the plot area in an export; the legend and footer add to it. */
export const QEC_EXPORT_PLOT_HEIGHT = 460;

export type ExportFigureProps = Omit<QecPlotFigureProps, 'width' | 'height' | 'plotHeight' | 'hover' | 'onHover' | 'colors'> & {
  /** Defaults to the print palette. */
  colors?: FigureColors;
};

/**
 * Renders the same figure the panel shows (legend, superscript ticks, fixed
 * font sizes) at a fixed export size, off-screen, and returns a detached copy
 * as a standalone SVG element: absolute pixel size, background rectangle, no
 * CSS or fonts beyond a generic fallback stack.
 */
export function renderFigureSvg(props: ExportFigureProps, width = QEC_EXPORT_WIDTH): SVGSVGElement {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(createElement(QecPlotFigure, { colors: PRINT_COLORS, ...props, width, plotHeight: QEC_EXPORT_PLOT_HEIGHT, idPrefix: 'qec-export' }));
    });
    const rendered = host.querySelector('svg');
    if (!rendered) throw new Error('Could not render the figure as SVG');
    const copy = rendered.cloneNode(true) as SVGSVGElement;
    copy.removeAttribute('style');
    return copy;
  } finally {
    root.unmount();
  }
}
