import { useMemo, type ReactNode } from 'react';
import { LayoutGrid, Grid3x3, Share2, Orbit, Workflow, type LucideIcon } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useQecStore } from '../../stores/qecStore';
import { useProjectStore } from '../../stores/projectStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useVizZoneStore } from '../../stores/vizZoneStore';
import { PanelReveal } from '../layout/PanelReveal';
import { CircuitRenderer } from '../circuit/CircuitRenderer';
import { Button, EmptyState, Tabs } from '../ui';
import { kernelStartFailureTitle } from '../../lib/kernelErrors';
import { retryKernel } from '../../lib/kernelControl';
import { usePlatform } from '../../platform/PlatformProvider';
import { useEditorStore } from '../../stores/editorStore';
import { visibleVizPanelIds } from '../../layout/vizPanels';
import { circuitMinHeight } from '../../layout/circuitRail';
import { blochRailHeights, blochUsedHeight } from '../../layout/blochRail';
import { circuitWantedHeight, planRailSplit, type RailSplit } from '../../layout/railHeights';
import { computeCircuitGeometry } from '../circuit/geometry';
import { fitCircuitWidth } from '../circuit/fitCircuit';
import { useDisplaySnapshot } from '../../layout/useDisplaySnapshot';
import { useElementSize } from '../../hooks/useElementSize';
import { useResultStale } from '../../hooks/useResultStale';
import { StaleResultNotice, STALE_RESULT_OPACITY } from '../layout/StaleResultNotice';
import { BlochRail } from '../layout/BlochRail';
import { BlochPanel } from '../bloch/BlochPanel';
import { ResultsEmptyState } from '../bloch/ResultsEmptyState';
import { QecTimelinePanel } from './QecTimelinePanel';
import { CodeLatticePanel } from './CodeLatticePanel';
import { DetectorGraphPanel } from './DetectorGraphPanel';
import type { VisiblePanels, PanelId } from '../../layout/panelRegistry';
import type { CircuitSnapshot } from '../../types/quantum';

/** The results empty state keeps this much room below the circuit. */
const EMPTY_RESULTS_MIN_PX = 240;

/**
 * PRD 10 Phase D — the viz zone (right rail).
 *
 * Registry-driven: it renders whichever viz panels `resolveVisiblePanels`
 * marked visible — Bloch for the circuit-model frameworks, the QEC panels for
 * stim — with NO framework conditional here (the swap is the registry's
 * affinity cap). Layout rule (PRD 11 D2):
 *   - ≤ 2 visible main viz panels → stacked (this is the non-stim Bloch case,
 *     byte-identical to the pre-Phase-D layout).
 *   - > 2 → a tabbed group, active tab persisted per project.
 * The histogram chip is a strip below, unchanged.
 */

interface VizPanelDef {
  id: PanelId;
  title: string;
  icon: LucideIcon;
  /** 'content' panels size to what they show (Bloch tiles); 'fill' panels take the rest of the rail. */
  fit: 'content' | 'fill';
  render: (ctx: VizRenderContext) => ReactNode;
}

/** What a panel's body needs from the zone beyond the stores it reads itself. */
interface VizRenderContext {
  /** Spheres on show: measured, or the starting states before a run. */
  blochCount: number;
  /** Qubits to draw at |0> before the first run (the Balanced preset), else 0. */
  initialQubits: number;
}

const MAIN_VIZ_PANELS: VizPanelDef[] = [
  { id: 'circuit', title: 'Circuit', icon: Workflow, fit: 'content', render: () => <CircuitRenderer /> },
  { id: 'bloch', title: 'Bloch Sphere', icon: Orbit, fit: 'content', render: ({ blochCount, initialQubits }) => <BlochRail count={blochCount}><BlochPanel initialQubits={initialQubits} /></BlochRail> },
  { id: 'qecTimeline', title: 'Timeline', icon: LayoutGrid, fit: 'fill', render: () => <QecTimelinePanel /> },
  { id: 'qecLattice', title: 'Code Lattice', icon: Grid3x3, fit: 'fill', render: () => <CodeLatticePanel /> },
  { id: 'qecDetectorGraph', title: 'Detector Graph', icon: Share2, fit: 'fill', render: () => <DetectorGraphPanel /> },
];

export function VizZone({
  visible,
  chip,
  booting = false,
  startFailed = false,
  noCircuit = false,
}: {
  visible: VisiblePanels;
  /** Python is still starting: hold the column open with a placeholder so the editor does not jump when it is ready. */
  booting?: boolean;
  /** Python failed to start: keep the column and offer Retry, so the editor does not change width when it recovers. */
  startFailed?: boolean;
  /** The last run finished as plain Python: keep the column and say there was no circuit to draw. */
  noCircuit?: boolean;
  /** The histogram-chip strip, rendered below the main panels (unchanged). */
  chip: ReactNode;
}) {
  const colors = useThemeStore((s) => s.colors);
  const qec = useQecStore((s) => s.snapshot);
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const rememberedTab = useVizZoneStore((s) => s.activeTabByProject[projectRoot ?? '__global__'] ?? null);
  const setActiveTab = useVizZoneStore((s) => s.setActiveTab);

  // Panels the registry says are visible, minus those with no data to show
  // (the code lattice hides gracefully when the circuit has no qubit coords,
  // and the gate diagram steps aside for the QEC panels).
  const panels = useMemo(() => {
    const latticeHasCoords = Boolean(qec?.coords.qubits.some((c) => c !== null));
    const ids = visibleVizPanelIds(visible, { latticeHasCoords });
    return MAIN_VIZ_PANELS.filter((p) => ids.includes(p.id));
  }, [visible, qec]);

  const stale = useResultStale();
  const platform = usePlatform();
  const { snapshot: circuitSnapshot } = useDisplaySnapshot();
  const [measureColumn, columnSize] = useElementSize<HTMLDivElement>();
  const measuredBlochCount = useSimulationStore((st) => st.result?.bloch_coords?.length ?? 0);
  const preset = useLayoutStore((s) => s.preset);
  // Initial |0> spheres only before any run: a failed run must show its failure state instead.
  const lastRunFailed = useSimulationStore((st) => st.lastRunFailed);
  const lastRunNoCircuit = useSimulationStore((st) => st.lastRunNoCircuit);
  const noRunYet = !lastRunFailed && !lastRunNoCircuit;
  const initialQubits = measuredBlochCount === 0 && preset === 'balanced' && noRunYet ? (circuitSnapshot?.qubit_count ?? 0) : 0;
  const blochCount = measuredBlochCount > 0 ? measuredBlochCount : initialQubits;
  const renderCtx: VizRenderContext = { blochCount, initialQubits };
  const [measureChip, chipSize] = useElementSize<HTMLDivElement>();
  const blochMin = blochCount > 0 ? blochRailHeights(blochCount, columnSize.width).min : EMPTY_RESULTS_MIN_PX;
  const railPlan = useRailPlan({
    snapshot: circuitSnapshot,
    railWidth: columnSize.width,
    railHeight: columnSize.height,
    chipHeight: chipSize.height,
    blochMin,
    blochCount,
  });
  const circuitRevealStyle = { ...CIRCUIT_REVEAL_STYLE, height: railPlan.circuit };
  // Once measured, the spheres get only the height they can draw so the histogram chip follows them (no dead band).
  const blochStyle = columnSize.height > 0 && blochCount > 0 ? { ...BOUNDED_BLOCH_STYLE, height: railPlan.bloch, minHeight: blochMin } : { ...FILL_STYLE, minHeight: blochMin };
  const circuitPanel = panels.find((p) => p.id === 'circuit');
  const statePanels = panels.filter((p) => p.id !== 'circuit');

  const progress = useEditorStore((st) => st.kernelProgress);
  if (booting && panels.length === 0) {
    const stage = progress && progress.kind !== 'attempts' && progress.total > 0 ? ` (step ${progress.step} of ${progress.total})` : '';
    return (
      <div style={COLUMN_STYLE}>
        <EmptyState className="viz-empty viz-empty--boot" icon={<Workflow size={20} />} title={`Preparing Python${stage}`}>
          Circuit and results appear when it&rsquo;s ready.
        </EmptyState>
      </div>
    );
  }

  if (noCircuit && panels.length === 0) {
    return <div style={COLUMN_STYLE}><ResultsEmptyState /></div>;
  }

  if (startFailed && panels.length === 0) {
    return (
      <div style={COLUMN_STYLE}>
        <EmptyState
          className="viz-empty viz-empty--boot"
          icon={<Workflow size={20} />}
          title={kernelStartFailureTitle(platform.getPlatform() === 'web')}
          action={<Button variant="secondary" size="sm" onClick={retryKernel}>Retry</Button>}
        >
          Retry here, or use the banner in the editor for details.
        </EmptyState>
      </div>
    );
  }

  return (
    <div ref={measureColumn} style={COLUMN_STYLE}>
      {circuitPanel && (
        <PanelReveal when from="right" style={circuitRevealStyle}>
          <section aria-label={circuitPanel.title} style={{ borderBottom: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            {circuitPanel.render(renderCtx)}
          </section>
        </PanelReveal>
      )}

      {statePanels.length === 0 && circuitPanel && <ResultsEmptyState />}

      {statePanels.length > 0 && statePanels.length <= 2 && statePanels.map((p) => {
        // Before the first run the Bloch panel is just the shared empty state: it takes the rest of the rail so it is centred like the Clean preset's.
        const fills = p.fit === 'fill' || (p.id === 'bloch' && blochCount === 0);
        return (
        <PanelReveal key={p.id} when from="right" style={p.id === 'bloch' ? blochStyle : fills ? FILL_STYLE : CONTENT_STYLE}>
          <div
            className={p.id === 'bloch' && stale ? 'nuclei-stale-results' : undefined}
            style={p.id === 'bloch' ? FILL_BODY_STYLE_FLEX : fills ? FILL_BODY_STYLE : CONTENT_BODY_STYLE}
          >
            {p.id === 'bloch' && stale && <StaleResultNotice />}
            {p.render(renderCtx)}
          </div>
        </PanelReveal>
        );
      })}

      {statePanels.length > 2 && (
        <TabbedPanels
          panels={statePanels}
          renderCtx={renderCtx}
          rememberedTab={rememberedTab}
          onSelect={(id) => setActiveTab(projectRoot, id)}
        />
      )}
      <div ref={measureChip} data-testid="viz-chip" style={stale ? STALE_CHIP_STYLE : CHIP_STYLE} data-stale={stale ? 'true' : undefined}>{chip}</div>
    </div>
  );
}
const CHIP_STYLE = { flexShrink: 0 } as const;
const STALE_CHIP_STYLE = { opacity: STALE_RESULT_OPACITY, flexShrink: 0 } as const;

// When even the floors of the circuit and the spheres do not fit, the rail scrolls instead of clipping.
const COLUMN_STYLE = { width: '100%', height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' } as const;
// The circuit's height is decided by planRailSplit; it never flexes on its own.
const CIRCUIT_REVEAL_STYLE = { flex: '0 0 auto', display: 'flex', flexDirection: 'column' } as const;
const CONTENT_STYLE = { flex: '0 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } as const;
const CONTENT_BODY_STYLE = { overflow: 'hidden', position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' } as const;
// The QEC panels keep a 240px floor; the Bloch body fills without one (the Bloch rail carries its own minimum).
const FILL_BODY_STYLE = { flex: 1, overflow: 'hidden', position: 'relative', minHeight: 240, display: 'flex', flexDirection: 'column' } as const;
const FILL_BODY_STYLE_FLEX = { flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' } as const;
const BOUNDED_BLOCH_STYLE = { flex: '0 0 auto', display: 'flex', flexDirection: 'column' } as const;
const FILL_STYLE = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } as const;

/** The rail split: the circuit gets its whole diagram when it can be spared, the spheres what they can draw. See planRailSplit. */
function useRailPlan(input: {
  snapshot: CircuitSnapshot | null;
  railWidth: number;
  railHeight: number;
  chipHeight: number;
  blochMin: number;
  blochCount: number;
}): RailSplit {
  const { snapshot, railWidth, railHeight, chipHeight, blochMin, blochCount } = input;
  return useMemo(() => {
    const qubits = snapshot?.qubit_count ?? 1;
    const geometry = snapshot ? computeCircuitGeometry(snapshot) : null;
    const scale = geometry ? fitCircuitWidth(geometry.svgWidth, railWidth).scale : 1;
    return planRailSplit({
      railHeight,
      chipHeight,
      circuitWanted: circuitWantedHeight(geometry?.svgHeight ?? 0, scale),
      circuitFloor: Math.max(96, circuitMinHeight(qubits, railHeight)),
      blochMin,
      blochFit: blochCount > 0 ? (offered) => blochUsedHeight(blochCount, railWidth, offered) : undefined,
    });
  }, [snapshot, railWidth, railHeight, chipHeight, blochMin, blochCount]);
}

function TabbedPanels({ panels, renderCtx, rememberedTab, onSelect }: {
  panels: VizPanelDef[];
  renderCtx: VizRenderContext;
  rememberedTab: string | null;
  onSelect: (id: PanelId) => void;
}) {
  // Persisted active tab, falling back to the first panel when the remembered
  // one isn't currently available.
  const active = panels.find((p) => p.id === rememberedTab) ?? panels[0];
  return (
    <>
      <Tabs
        aria-label="Visualization panels"
        className="viz-zone-tabs"
        value={active.id}
        onChange={(id) => onSelect(id as PanelId)}
        options={panels.map((p) => {
          const Icon = p.icon;
          return { value: p.id, label: <><Icon size={12} />{p.title}</> };
        })}
      />
      <div style={{ flex: 1, minHeight: 240, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {active.render(renderCtx)}
      </div>
    </>
  );
}
