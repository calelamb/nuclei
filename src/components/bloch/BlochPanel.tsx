import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSimulationStore } from '../../stores/simulationStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { useDebugStore } from '../../stores/debugStore';
import { activeDebugStep } from '../../lib/debugTrace';
import { useThemeStore } from '../../stores/themeStore';
import { useElementSize } from '../../hooks/useElementSize';
import { blochGridLayout, CELL_CAPTION_PX } from '../../lib/blochGrid';
import { IconButton } from '../ui';
import { BlochCell } from './BlochCell';
import { BlochStage } from './blochStage';
import { blochPalette } from '../../lib/blochPalette';
import type { BlochVector } from '../../lib/blochMath';
import { prefersReducedMotion } from '../../lib/animations';
import { BlochEmptyState } from './BlochEmptyState';
import './bloch.css';

const COMPACT_CELL_PX = 250;
/** Matches --space-2 on .bloch-panel__canvas-host. */
const STAGE_INSET_PX = 8;

/**
 * Bloch spheres for every qubit on ONE shared WebGL canvas: a responsive grid
 * (spheres never shrink below a readable size, extra qubits become pages), drag
 * to rotate each sphere, smooth transitions between states, and an explicit
 * readout when a qubit is entangled and has no single-qubit Bloch vector.
 */
export function BlochPanel() {
  const result = useSimulationStore((s) => s.result);
  const stepMode = useCircuitStore((s) => s.stepMode);
  const stepIndex = useCircuitStore((s) => s.stepIndex);
  const trace = useDebugStore((s) => s.trace);
  const step = stepMode ? activeDebugStep(trace, stepIndex) : null;
  const [measureRef, size] = useElementSize<HTMLDivElement>();
  const [requestedPage, setRequestedPage] = useState(0);
  const colors = useThemeStore((s) => s.colors);
  const themeMode = useThemeStore((s) => s.mode);
  const [glFailure, setGlFailure] = useState<string | null>(null);
  const stageRef = useRef<BlochStage | null>(null);
  const viewportEls = useRef(new Map<number, HTMLDivElement>());
  const themeModeRef = useRef(themeMode);
  const shownRef = useRef<{ coords: readonly BlochVector[]; first: number }>({ coords: [], first: 0 });

  const blochCoords = useMemo(
    () => step?.bloch_coords ?? result?.bloch_coords ?? [],
    [step, result],
  );
  const qubitCount = blochCoords.length;

  const layout = useMemo(
    () => blochGridLayout({
      count: Math.max(1, qubitCount),
      width: Math.max(0, size.width - STAGE_INSET_PX * 2),
      height: Math.max(0, size.height - STAGE_INSET_PX * 2),
    }),
    [qubitCount, size.width, size.height],
  );
  const page = Math.min(requestedPage, layout.pageCount - 1);
  const first = page * layout.pageSize;
  const visible = useMemo(
    () => blochCoords.slice(first, first + layout.pageSize),
    [blochCoords, first, layout.pageSize],
  );

  /** Hand the stage the boxes currently on screen. Reads refs only, so it is safe from any commit phase. */
  const pushViews = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const { coords, first: start } = shownRef.current;
    stage.setViews(coords.flatMap((coord, i) => {
      const element = viewportEls.current.get(start + i);
      return element ? [{ element, coord }] : [];
    }));
  }, []);

  // The canvas mounts once there is data to draw; the stage lives exactly as long as the canvas does.
  const attachCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return undefined;
    try {
      const stage = new BlochStage(canvas, blochPalette(themeModeRef.current), { reducedMotion: prefersReducedMotion() });
      stageRef.current = stage;
      // React StrictMode re-attaches the canvas after the layout effect ran: give the new stage its views.
      pushViews();
      return () => {
        stage.dispose();
        if (stageRef.current === stage) stageRef.current = null;
      };
    } catch (error) {
      setGlFailure(error instanceof Error ? error.message : 'WebGL is unavailable');
      return undefined;
    }
  }, [pushViews]);

  useLayoutEffect(() => {
    themeModeRef.current = themeMode;
    stageRef.current?.setPalette(blochPalette(themeMode));
  }, [themeMode]);

  useLayoutEffect(() => {
    shownRef.current = { coords: visible, first };
    pushViews();
  }, [visible, first, glFailure, size.width, size.height, pushViews]);

  useEffect(() => {
    stageRef.current?.resize();
  }, [size.width, size.height]);

  if (qubitCount === 0) return <BlochEmptyState />;

  const needsPager = layout.pageCount > 1;

  return (
    <div className="bloch-panel" role="region" aria-label="Bloch sphere visualization" style={{ background: colors.bg }}>
      <div ref={measureRef} className="bloch-panel__stage">
        {size.width > 0 && (
          <div className="bloch-panel__canvas-host">
            <div
              className="bloch-grid"
              style={{
                gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
                gridAutoRows: `${layout.cellHeight}px`,
                ['--bloch-caption' as string]: `${CELL_CAPTION_PX}px`,
              }}
            >
              {visible.map((coord, i) => (
                <BlochCell
                  key={first + i}
                  ref={(el) => {
                    if (el) viewportEls.current.set(first + i, el);
                    else viewportEls.current.delete(first + i);
                  }}
                  qubit={first + i}
                  label={qubitCount > 1 ? `q${first + i}` : undefined}
                  compact={layout.cellWidth < COMPACT_CELL_PX}
                  coord={coord}
                />
              ))}
            </div>
            {glFailure ? (
              <p className="bloch-panel__fallback" role="status">
                3D view unavailable on this device. Each qubit&rsquo;s readout still shows its state.
              </p>
            ) : (
              <canvas ref={attachCanvas} className="bloch-canvas" aria-hidden="true" />
            )}
          </div>
        )}
      </div>
      {needsPager && (
        <div className="bloch-pager">
          <IconButton size="sm" aria-label="Previous qubits" disabled={page === 0} onClick={() => setRequestedPage(page - 1)}>
            <ChevronLeft size={14} />
          </IconButton>
          <span className="bloch-pager__label" aria-live="polite">
            q{first}&ndash;q{first + visible.length - 1} of {qubitCount}
          </span>
          <IconButton size="sm" aria-label="Next qubits" disabled={page >= layout.pageCount - 1} onClick={() => setRequestedPage(page + 1)}>
            <ChevronRight size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
