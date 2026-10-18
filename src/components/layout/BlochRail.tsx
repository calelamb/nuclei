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
  const [resizeTick, setResizeTick] = useState(0);
  const [probe, setProbe] = useState<{ result: unknown; count: number; width: number; tick: number; tight: number | null }>(
    { result, count, width: size.width, tick: 0, tight: null },
  );
  const { desired, min } = blochRailHeights(count, size.width);

  useEffect(() => {
    const loosen = () => setResizeTick((t) => t + 1);
    window.addEventListener('resize', loosen);
    return () => window.removeEventListener('resize', loosen);
  }, []);

  // Adjust state while rendering (React's derived-state pattern): loosen on a new run, count, width or window
  // size, then tighten once the measured box proves the grid needs less than it was given.
  const stale = probe.result !== result || probe.count !== count || probe.width !== size.width || probe.tick !== resizeTick;
  if (stale) {
    setProbe({ result, count, width: size.width, tick: resizeTick, tight: null });
  } else if (probe.tight === null && count > 0 && size.height > 0 && size.width > 0) {
    const used = Math.max(min, blochRailUsedHeight(count, size.width, size.height));
    if (used < size.height - SNUG_SLACK_PX) setProbe({ ...probe, tight: used });
  }
  const tightened = stale ? null : probe.tight;
  const height = tightened === null ? desired : Math.min(desired, tightened);
  return (
    <div
      ref={measureRef}
      data-testid="bloch-rail"
      style={{
        flex: count > 0 ? '0 1 auto' : '1 1 auto', minHeight: count > 0 ? min : 240, height: count > 0 ? height : undefined,
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
