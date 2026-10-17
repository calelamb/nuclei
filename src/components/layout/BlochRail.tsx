import type { ReactNode } from 'react';
import { useSimulationStore } from '../../stores/simulationStore';
import { useElementSize } from '../../hooks/useElementSize';
import { blochRailHeights } from '../../layout/blochRail';

/**
 * Holds the Bloch panel in the right rail. The panel pages its own grid from the box it is given,
 * so this box is what we control: as tall as the qubits want (up to a 3x2 grid) but shrinkable
 * when the column is short, and never below one full row. Sized to its content, no dead bands.
 */
export function BlochRail({ children }: { children: ReactNode }) {
  const count = useSimulationStore((s) => s.result?.bloch_coords?.length ?? 0);
  const [measureRef, size] = useElementSize<HTMLDivElement>();
  const { desired, min } = blochRailHeights(count, size.width);
  return (
    <div
      ref={measureRef}
      data-testid="bloch-rail"
      style={{
        flex: '0 1 auto', minHeight: count > 0 ? min : 240, height: count > 0 ? desired : undefined,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      {/* The panel is absolutely positioned: this box is its frame. */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}
