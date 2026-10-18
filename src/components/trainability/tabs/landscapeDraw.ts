import { interpolateRamp } from '../../lab/chartUtils';
import type { LandscapeResult } from '../../../types/trainability';

/** Row-major, y outer (`values[iy][ix]`); iy = 0 is drawn at the bottom. */
export function drawLandscape(canvas: HTMLCanvasElement, data: LandscapeResult, ramp: string[]): boolean {
  if (ramp.length < 2) return false;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const { resolution, values, min, max } = data;
  canvas.width = resolution;
  canvas.height = resolution;
  const image = ctx.createImageData(resolution, resolution);
  const span = max - min;
  for (let iy = 0; iy < resolution; iy += 1) {
    for (let ix = 0; ix < resolution; ix += 1) {
      const t = span > 0 ? (values[iy][ix] - min) / span : 0.5;
      const [r, g, b] = interpolateRamp(ramp, t);
      const o = ((resolution - 1 - iy) * resolution + ix) * 4;
      image.data[o] = r;
      image.data[o + 1] = g;
      image.data[o + 2] = b;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return true;
}

/** Percent position of the slice origin (axis value 0) within the plot; 50 when symmetric. */
export function centerPercent(axis: readonly number[]): number {
  if (axis.length < 2) return 50;
  const lo = axis[0];
  const hi = axis[axis.length - 1];
  const span = hi - lo;
  if (!(span > 0)) return 50;
  return Math.min(100, Math.max(0, ((0 - lo) / span) * 100));
}

