import { useMemo, type ReactNode } from 'react';
import { LayoutGrid, Grid3x3, Share2, Orbit, Play, Workflow, type LucideIcon } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useQecStore } from '../../stores/qecStore';
import { useProjectStore } from '../../stores/projectStore';
import { useVizZoneStore } from '../../stores/vizZoneStore';
import { PanelReveal } from '../layout/PanelReveal';
import { CircuitRenderer } from '../circuit/CircuitRenderer';
import { Button, Tabs } from '../ui';
import { getExecute } from '../../App';
import { visibleVizPanelIds } from '../../layout/vizPanels';
import { shortcutLabel } from '../../config/keybindings';
import { useResultStale } from '../../hooks/useResultStale';
import { StaleResultNotice, STALE_RESULT_OPACITY } from '../layout/StaleResultNotice';
import { BlochRail } from '../layout/BlochRail';
import { BlochPanel } from '../bloch/BlochPanel';
import { QecTimelinePanel } from './QecTimelinePanel';
import { CodeLatticePanel } from './CodeLatticePanel';
import { DetectorGraphPanel } from './DetectorGraphPanel';
import type { VisiblePanels, PanelId } from '../../layout/panelRegistry';

import { TYPOGRAPHY } from '../../styles/tokens';
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
  render: () => ReactNode;
}

const MAIN_VIZ_PANELS: VizPanelDef[] = [
  { id: 'circuit', title: 'Circuit', icon: Workflow, fit: 'content', render: () => <CircuitRenderer /> },
  { id: 'bloch', title: 'Bloch Sphere', icon: Orbit, fit: 'content', render: () => <BlochRail><BlochPanel /></BlochRail> },
  { id: 'qecTimeline', title: 'Timeline', icon: LayoutGrid, fit: 'fill', render: () => <QecTimelinePanel /> },
  { id: 'qecLattice', title: 'Code Lattice', icon: Grid3x3, fit: 'fill', render: () => <CodeLatticePanel /> },
  { id: 'qecDetectorGraph', title: 'Detector Graph', icon: Share2, fit: 'fill', render: () => <DetectorGraphPanel /> },
];

export function VizZone({
  visible,
  chip,
}: {
  visible: VisiblePanels;
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
  const circuitPanel = panels.find((p) => p.id === 'circuit');
  const statePanels = panels.filter((p) => p.id !== 'circuit');

  return (
    <div style={COLUMN_STYLE}>
      {circuitPanel && (
        <PanelReveal when from="right" style={CIRCUIT_REVEAL_STYLE}>
          <section aria-label={circuitPanel.title} style={{ borderBottom: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: '100%' }}>
            {circuitPanel.render()}
          </section>
        </PanelReveal>
      )}

      {statePanels.length === 0 && circuitPanel && <RunPrompt />}

      {statePanels.length > 0 && statePanels.length <= 2 && statePanels.map((p) => (
        <PanelReveal key={p.id} when from="right" style={p.fit === 'fill' ? FILL_STYLE : CONTENT_STYLE}>
          <div
            className={p.id === 'bloch' && stale ? 'nuclei-stale-results' : undefined}
            style={p.fit === 'fill' ? FILL_BODY_STYLE : CONTENT_BODY_STYLE}
          >
            {p.id === 'bloch' && stale && <StaleResultNotice />}
            {p.render()}
          </div>
        </PanelReveal>
      ))}

      {statePanels.length > 2 && (
        <TabbedPanels
          panels={statePanels}
          rememberedTab={rememberedTab}
          onSelect={(id) => setActiveTab(projectRoot, id)}
        />
      )}
      <div style={stale ? STALE_CHIP_STYLE : undefined} data-stale={stale ? 'true' : undefined}>{chip}</div>
    </div>
  );
}
const STALE_CHIP_STYLE = { opacity: STALE_RESULT_OPACITY, flexShrink: 0 } as const;

const COLUMN_STYLE = { width: '100%', height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' } as const;
// The circuit grows to its content and only yields space (scrolling inside) when the rail is short.
const CIRCUIT_REVEAL_STYLE = { flex: '0 1 auto', minHeight: 96, display: 'flex', flexDirection: 'column' } as const;
const CONTENT_STYLE = { flex: '0 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } as const;
const CONTENT_BODY_STYLE = { overflow: 'hidden', position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' } as const;
const FILL_BODY_STYLE = { flex: 1, overflow: 'hidden', position: 'relative', minHeight: 240, display: 'flex', flexDirection: 'column' } as const;
const FILL_STYLE = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } as const;

/**
 * Fills the rest of the rail when only the circuit can be shown (Clean preset,
 * before the first run): says what will appear and offers the one action that
 * makes it appear, instead of leaving a blank column.
 */
function RunPrompt() {
  const colors = useThemeStore((s) => s.colors);
  const isRunning = useSimulationStore((s) => s.isRunning);
  if (isRunning) {
    return (
      <div role="status" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
        <Orbit size={28} strokeWidth={1.25} color={colors.accentText} aria-hidden="true" style={{ animation: 'nuclei-heartbeat 1.5s ease infinite' }} />
        <p style={{ margin: 0, fontSize: 13, color: colors.textMuted, fontFamily: TYPOGRAPHY.fontSans }}>Running&hellip;</p>
      </div>
    );
  }
  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center',
    }}>
      <Orbit size={28} strokeWidth={1.25} color={colors.textDim} aria-hidden="true" />
      <p style={{ margin: 0, maxWidth: 220, fontSize: 13, lineHeight: 1.5, color: colors.textMuted, fontFamily: TYPOGRAPHY.fontSans }}>
        Run your circuit to see each qubit&apos;s Bloch sphere and the outcome histogram.
      </p>
      <Button variant="secondary" size="sm" icon={<Play size={12} />} onClick={() => getExecute()?.()}>
        Run {shortcutLabel('run')}
      </Button>
    </div>
  );
}

function TabbedPanels({ panels, rememberedTab, onSelect }: {
  panels: VizPanelDef[];
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
        {active.render()}
      </div>
    </>
  );
}
