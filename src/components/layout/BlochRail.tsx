import type { ReactNode } from 'react';
import { useElementSize } from '../../hooks/useElementSize';
import { blochRailHeights } from '../../layout/blochRail';

/** The empty state keeps this much room so it stays centred while there is nothing to draw. */
const EMPTY_MIN_PX = 240;

/**
 * Holds the Bloch panel in the right rail. The rail split (src/layout/railHeights.ts) decides how much
 * height the circuit keeps; the spheres take every pixel left over, never less than one full row, so
 * the panel pages its grid from a box that is as tall as the rail can honestly give it.
 */
export function BlochRail({ children, count }: { children: ReactNode; /** Spheres on show: measured, or the starting states before a run. */ count: number }) {
  const [measureRef, size] = useElementSize<HTMLDivElement>();
  const { min } = blochRailHeights(count, size.width);
  return (
    <div
      ref={measureRef}
      data-testid="bloch-rail"
      style={{ flex: '1 1 0px', minHeight: count > 0 ? min : EMPTY_MIN_PX, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {/* The panel is absolutely positioned: this box is its frame. */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}
