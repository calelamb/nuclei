import { useEffect } from 'react';
import type { ChartScales } from '../lab';

/** Reports a chart's current scales upward after render (children get them only as a render prop). */
export function ScaleSink({ scales, onScales }: { scales: ChartScales; onScales: (scales: ChartScales) => void }) {
  useEffect(() => {
    onScales(scales);
  }, [scales, onScales]);
  return null;
}
