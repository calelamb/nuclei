import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QecPlotFigure, type QecPlotFigureProps } from '../components/qec/QecPlotFigure';

/** Pixel width of an exported QEC figure. Text stays at its on-screen pixel sizes. */
export const QEC_EXPORT_WIDTH = 900;
/** Height of the plot area in an export; the legend and footer add to it. */
export const QEC_EXPORT_PLOT_HEIGHT = 460;

export type ExportFigureProps = Omit<QecPlotFigureProps, 'width' | 'height' | 'plotHeight' | 'hover' | 'onHover'>;

/**
 * Renders the same figure the panel shows (legend, superscript ticks, fixed
 * font sizes) at a fixed export size and returns it as a standalone SVG
 * element: absolute pixel size, background rectangle, no CSS or fonts beyond
 * a generic fallback stack.
 */
export function renderFigureSvg(props: ExportFigureProps, width = QEC_EXPORT_WIDTH): SVGSVGElement {
  const markup = renderToStaticMarkup(
    createElement(QecPlotFigure, { ...props, width, plotHeight: QEC_EXPORT_PLOT_HEIGHT, idPrefix: 'qec-export' }),
  );
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = doc.documentElement as unknown as SVGSVGElement;
  if (doc.querySelector('parsererror') || svg.nodeName.toLowerCase() !== 'svg') {
    throw new Error('Could not render the figure as SVG');
  }
  svg.removeAttribute('style');
  return svg;
}
