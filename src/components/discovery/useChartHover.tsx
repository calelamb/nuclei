import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { ChartPointer, ChartScales, LabTooltipState } from '../lab';
import { nearestPoint } from '../../services/discovery/chartHover';
import { ScaleSink } from './ScaleSink';

/**
 * Nearest-point hover and click-through for a ChartFrame scatter. Render
 * `sink(scales)` inside the chart so pointer events (which arrive in plot
 * space) can be matched against the plotted items.
 */
export function useChartHover<T>(
  items: readonly T[],
  position: (item: T, scales: ChartScales) => readonly [number, number],
  describe: (item: T) => ReactNode,
) {
  const scalesRef = useRef<ChartScales | null>(null);
  const [hover, setHover] = useState<{ item: T; tooltip: LabTooltipState } | null>(null);

  const onPointer = useCallback(
    (pointer: ChartPointer | null) => {
      const scales = scalesRef.current;
      if (!pointer || !scales) return setHover(null);
      const item = nearestPoint(items, pointer.px, pointer.py, (it) => position(it, scales));
      setHover(item === null ? null : { item, tooltip: { x: pointer.clientX, y: pointer.clientY, content: describe(item) } });
    },
    [items, position, describe],
  );

  const onScales = useCallback((scales: ChartScales) => {
    scalesRef.current = scales;
  }, []);
  const sink = useCallback((scales: ChartScales) => <ScaleSink scales={scales} onScales={onScales} />, [onScales]);
  return { hover, onPointer, sink };
}
