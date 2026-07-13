import { useMemo, type ReactNode } from 'react';
import { LayoutGrid, Grid3x3, Share2, Orbit, type LucideIcon } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecStore } from '../../stores/qecStore';
import { useProjectStore } from '../../stores/projectStore';
import { useVizZoneStore } from '../../stores/vizZoneStore';
import { PanelReveal } from '../layout/PanelReveal';
import { BlochPanel } from '../bloch/BlochPanel';
import { QecTimelinePanel } from './QecTimelinePanel';
import { CodeLatticePanel } from './CodeLatticePanel';
import { DetectorGraphPanel } from './DetectorGraphPanel';
import type { VisiblePanels, PanelId } from '../../layout/panelRegistry';

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
  { id: 'bloch', title: 'Bloch Sphere', icon: Orbit, render: () => <BlochPanel /> },
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

  // Panels the registry says are visible, minus those with no data to show:
  // the code lattice hides gracefully when the circuit has no qubit coords.
  const panels = useMemo(() => {
    const latticeHasCoords = Boolean(qec?.coords.qubits.some((c) => c !== null));
    return MAIN_VIZ_PANELS.filter((p) => {
      if (!visible[p.id]) return false;
      if (p.id === 'qecLattice' && !latticeHasCoords) return false;
      return true;
    });
  }, [visible, qec]);

  if (panels.length === 0) {
    return (
      <div style={{ width: '100%', minWidth: 200, display: 'flex', flexDirection: 'column' }}>
        {chip}
      </div>
    );
  }

  // ≤ 2 panels → stacked. The single-Bloch (non-stim) case reproduces the
  // pre-Phase-D right rail exactly: a full-height reveal-from-right panel.
  if (panels.length <= 2) {
    return (
      <div style={{ width: '100%', minWidth: 200, display: 'flex', flexDirection: 'column' }}>
        {panels.map((p) => (
          <PanelReveal key={p.id} when from="right">
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 240 }}>
              {p.render()}
            </div>
          </PanelReveal>
        ))}
        {chip}
      </div>
    );
  }

  // > 2 panels → tabbed group. Persisted active tab, falling back to the first
  // panel when the remembered one isn't currently available.
  const active = panels.find((p) => p.id === rememberedTab) ?? panels[0];

  return (
    <div style={{ width: '100%', minWidth: 200, display: 'flex', flexDirection: 'column' }}>
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
              onClick={() => setActiveTab(projectRoot, p.id)}
              title={p.title}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px',
                background: 'transparent', border: 'none',
                borderBottom: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
                color: isActive ? colors.text : colors.textDim, cursor: 'pointer',
                fontSize: 10.5, fontFamily: "'Geist Sans', sans-serif", fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = colors.textMuted; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = colors.textDim; }}
            >
              <Icon size={12} />
              {p.title}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minHeight: 240, overflow: 'hidden', position: 'relative' }}>
        {active.render()}
      </div>
      {chip}
    </div>
  );
}
