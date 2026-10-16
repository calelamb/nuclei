export const FONT = "'Geist Sans', sans-serif";
export const MONO = "'Geist Mono', monospace";

/** Stim's SVG rendered as an <img> data URL: scripts never run in an image. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
