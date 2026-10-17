import { useEffect, useState, type ReactNode } from 'react';
import { useSimulationStore } from '../../stores/simulationStore';
import { useElementSize } from '../../hooks/useElementSize';
import { blochRailHeights, blochRailUsedHeight } from '../../layout/blochRail';

/** Closer than this to the allocated height and the rail is already snug. */
const SNUG_SLACK_PX = 4;

/**
 * Holds the Bloch panel in the right rail. The panel pages its own grid from the box it is given,
 * so this box is what we control: as tall as the qubits want (up to a 3x2 grid) but shrinkable
 * when the column is short, and never below one full row.
 *
 * When the column squeezes the rail the grid may need fewer rows than the rail was sized for. The rail
 * then tightens to the height the grid really occupies, handing the slack back to the circuit above.
 * It loosens again (and re-measures) when the qubit count, rail width, window or result changes.
 */
export function BlochRail({ children }: { children: ReactNode }) {
  const result = useSimulationStore((s) => s.result);
  const count = result?.bloch_coords?.length ?? 0;
  const [measureRef, size] = useElementSize<HTMLDivElement>();
  const [tightened, setTightened] = useState<number | null>(null);
  const { desired, min } = blochRailHeights(count, size.width);

  useEffect(() => {
    setTightened(null);
    const loosen = () => setTightened(null);
    window.addEventListener('resize', loosen);
    return () => window.removeEventListener('resize', loosen);
  }, [count, size.width, result]);

  useEffect(() => {
    if (count === 0 || size.height <= 0 || size.width <= 0) return;
    const used = Math.max(min, blochRailUsedHeight(count, size.width, size.height));
    if (used < size.height - SNUG_SLACK_PX) setTightened(used);
  }, [count, size.width, size.height, min]);

  const height = tightened === null ? desired : Math.min(desired, tightened);
  return (
    <div
      ref={measureRef}
      data-testid="bloch-rail"
      style={{
        flex: '0 1 auto', minHeight: count > 0 ? min : 240, height: count > 0 ? height : undefined,
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
