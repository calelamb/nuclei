/** Pixel width of an exported QEC figure; height follows the viewBox aspect ratio. */
export const QEC_EXPORT_WIDTH = 900;

/**
 * Copy of the on-screen figure with a fixed size and no viewport-relative
 * styling, so a standalone file renders at figure scale instead of filling
 * the browser window. The input element is left untouched.
 */
export function exportableSvg(svg: SVGSVGElement, width = QEC_EXPORT_WIDTH): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const box = (clone.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  const [vbW, vbH] = [box[2], box[3]];
  const height = vbW > 0 && vbH > 0 ? Math.round((width * vbH) / vbW) : Math.round(width * 0.7);
  clone.removeAttribute('style');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  return clone;
}
