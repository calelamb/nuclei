import type { ReactNode } from 'react';
import { useSimulationStore } from '../../stores/simulationStore';
import { blochRailSizes } from '../../layout/blochRail';

/**
 * Holds the Bloch panel in the right rail at a size where every sphere stays
 * whole: square cards, centred in the spare height, scrolling sideways when
 * there are more qubits than fit. The panel itself fills whatever box it is
 * given, so the box is what we control.
 */
export function BlochRail({ children }: { children: ReactNode }) {
  const count = useSimulationStore((s) => s.result?.bloch_coords?.length ?? 0);
  const { width, height } = blochRailSizes(count);
  return (
    <div
      data-testid="bloch-rail"
      style={{
        flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'auto',
        containerType: 'inline-size', display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ width: count > 0 ? width : '100%', height: count > 0 ? height : '100%', margin: 'auto', flexShrink: 0, minHeight: count > 0 ? undefined : 240 }}>
        {children}
      </div>
    </div>
  );
}
