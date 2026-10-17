import { useMemo, type ReactNode } from 'react';
import { LayoutGrid, Grid3x3, Share2, Orbit, Play, Workflow, type LucideIcon } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecStore } from '../../stores/qecStore';
import { useProjectStore } from '../../stores/projectStore';
import { useVizZoneStore } from '../../stores/vizZoneStore';
import { PanelReveal } from '../layout/PanelReveal';
import { CircuitRenderer } from '../circuit/CircuitRenderer';
import { Button } from '../ui';
import { getExecute } from '../../App';
import { visibleVizPanelIds } from '../../layout/vizPanels';
import { shortcutLabel } from '../../config/keybindings';
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
  render: () => ReactNode;
}

const MAIN_VIZ_PANELS: VizPanelDef[] = [
  { id: 'circuit', title: 'Circuit', icon: Workflow, render: () => <CircuitRenderer /> },
  { id: 'bloch', title: 'Bloch Sphere', icon: Orbit, render: () => <BlochRail><BlochPanel /></BlochRail> },
  { id: 'qecTimeline', title: 'Timeline', icon: LayoutGrid, render: () => <QecTimelinePanel /> },
  { id: 'qecLattice', title: 'Code Lattice', icon: Grid3x3, render: () => <CodeLatticePanel /> },
  { id: 'qecDetectorGraph', title: 'Detector Graph', icon: Share2, render: () => <DetectorGraphPanel /> },
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

  const circuitPanel = panels.find((p) => p.id === 'circuit');
  const statePanels = panels.filter((p) => p.id !== 'circuit');

  return (
    <div style={COLUMN_STYLE}>
      {circuitPanel && (
        <PanelReveal when from="right" style={{ flexShrink: 0, maxHeight: '45%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <section aria-label={circuitPanel.title} style={{ borderBottom: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: '100%' }}>
            {circuitPanel.render()}
          </section>
        </PanelReveal>
      )}

      {statePanels.length === 0 && circuitPanel && <RunPrompt />}

      {statePanels.length > 0 && statePanels.length <= 2 && statePanels.map((p) => (
        <PanelReveal key={p.id} when from="right" style={FILL_STYLE}>
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 240, display: 'flex', flexDirection: 'column' }}>
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
      {chip}
    </div>
  );
}

const COLUMN_STYLE = { width: '100%', height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' } as const;
const FILL_STYLE = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } as const;

/**
 * Fills the rest of the rail when only the circuit can be shown (Clean preset,
 * before the first run): says what will appear and offers the one action that
 * makes it appear, instead of leaving a blank column.
 */
function RunPrompt() {
  const colors = useThemeStore((s) => s.colors);
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
  const colors = useThemeStore((s) => s.colors);
  // Persisted active tab, falling back to the first panel when the remembered
  // one isn't currently available.
  const active = panels.find((p) => p.id === rememberedTab) ?? panels[0];
  return (
    <>
      <div
        role="tablist"
        aria-label="Visualization panels"
        style={{
          display: 'flex', alignItems: 'stretch', height: 28, flexShrink: 0,
          borderBottom: `1px solid ${colors.border}`, background: colors.bg, overflow: 'hidden',
        }}
      >
        {panels.map((p) => {
          const Icon = p.icon;
          const isActive = p.id === active.id;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={isActive}
              data-active={isActive}
              className="nuclei-quiet"
              onClick={() => onSelect(p.id)}
              title={p.title}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px',
                background: 'transparent', border: 'none',
                borderBottom: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
                cursor: 'pointer',
                fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              <Icon size={12} />
              {p.title}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minHeight: 240, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {active.render()}
      </div>
    </>
  );
}
