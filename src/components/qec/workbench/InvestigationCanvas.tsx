import { Activity, ChartSpline, Clock3, Grid3x3, Link2, Share2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { QEC_PANEL_REGISTRY, type QecWorkbenchPanelId } from '../../../layout/qecPanelRegistry';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';

const PANEL_ICONS: Partial<Readonly<Record<QecWorkbenchPanelId, LucideIcon>>> = {
  timeline: Clock3,
  lattice: Grid3x3,
  'detector-graph': Share2,
  'campaign-center': ChartSpline,
  'stream-health': Activity,
  'calibration-timeline': Clock3,
};

export function InvestigationCanvas(): ReactElement {
  const preset = useQecWorkbenchStore((state) => state.preset);
  const panels = QEC_PANEL_REGISTRY.filter(
    (panel) => panel.zone === 'canvas' && panel.presets.includes(preset),
  );

  return (
    <main className="qec-investigation" aria-label="QEC investigation canvas">
      <header className="qec-investigation__header">
        <div>
          <span className="qec-zone-heading__eyebrow">{preset} preset</span>
          <h1>Investigation Canvas</h1>
        </div>
        <div className="qec-instrument-state" aria-label="Instrument state">
          <Link2 aria-hidden="true" size={14} />
          <span>Selections linked</span>
        </div>
      </header>

      <div className="qec-instrument-strip" aria-label="Canvas instruments">
        <span>Split view</span>
        <span>Compare</span>
        <span>Time / round</span>
        <span>Checkpoint</span>
      </div>

      <div className="qec-investigation__panels">
        {panels.map((panel, index) => {
          const Icon = PANEL_ICONS[panel.id] ?? Activity;
          return (
            <section
              key={panel.id}
              className={`qec-instrument qec-instrument--${index === 0 ? 'primary' : 'secondary'}`}
              aria-labelledby={`${panel.id}-instrument-heading`}
            >
              <header>
                <span className="qec-instrument__icon"><Icon aria-hidden="true" size={16} /></span>
                <div>
                  <h2 id={`${panel.id}-instrument-heading`}>{panel.title}</h2>
                  <span className="qec-mono">Linked · awaiting session data</span>
                </div>
              </header>
              <div className="qec-instrument__field" aria-hidden="true">
                <span className="qec-instrument__axis qec-instrument__axis--horizontal" />
                <span className="qec-instrument__axis qec-instrument__axis--vertical" />
                <span className="qec-instrument__trace" />
              </div>
              <p>Open or run a compatible source to populate this registered instrument.</p>
            </section>
          );
        })}
      </div>
    </main>
  );
}
