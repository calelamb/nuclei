import type { ReactNode } from 'react';
import { useSimulationStore } from '../../stores/simulationStore';
import { blochRailSizes } from '../../layout/blochRail';

/**
 * Holds the Bloch panel in the right rail at a size where every sphere stays
 * whole: square cards, packed at the top so the histogram sits right under them, scrolling sideways when
 * there are more qubits than fit. The panel itself fills whatever box it is
 * given, so the box is what we control. It sizes to its content (no dead bands).
 */
export function BlochRail({ children }: { children: ReactNode }) {
  const count = useSimulationStore((s) => s.result?.bloch_coords?.length ?? 0);
  const { width, height } = blochRailSizes(count);
  return (
    <div
      data-testid="bloch-rail"
      style={{
        flex: '0 1 auto', minHeight: 0, overflowX: 'auto', overflowY: 'auto',
        containerType: 'inline-size', display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ width: count > 0 ? width : '100%', height: count > 0 ? height : '100%', margin: '0 auto', flexShrink: 0, minHeight: count > 0 ? undefined : 240 }}>
        {children}
      </div>
    </div>
  );
}
