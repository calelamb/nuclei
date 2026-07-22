import { Activity, ChartSpline, Clock3, Grid3x3, Link2, PanelRight, Share2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement, RefObject } from 'react';
import { resolveQecPanels, type QecWorkbenchPanelDef, type QecWorkbenchPanelId } from '../../../layout/qecPanelRegistry';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { QEC_RESEARCH_INSPECTOR_ID } from './QecResearchInspector';
import { QecPanelPinButton } from './QecPanelPinButton';

const PANEL_ICONS: Partial<Readonly<Record<QecWorkbenchPanelId, LucideIcon>>> = {
  timeline: Clock3, lattice: Grid3x3, 'detector-graph': Share2,
  'campaign-center': ChartSpline, 'stream-health': Activity, 'calibration-timeline': Clock3,
};

interface InvestigationCanvasProps {
  inspectorOpen: boolean;
  onToggleInspector(): void;
  toggleRef: RefObject<HTMLButtonElement | null>;
}

function CanvasHeader({ inspectorOpen, onToggleInspector, toggleRef }: InvestigationCanvasProps): ReactElement {
  const preset = useQecWorkbenchStore((state) => state.preset);
  return (
    <header className="qec-investigation__header">
      <div>
        <span className="qec-zone-heading__eyebrow">{preset} preset</span>
        <h1>Investigation Canvas</h1>
      </div>
      <div className="qec-investigation__actions">
        <div className="qec-instrument-state" aria-label="Instrument state">
          <Link2 aria-hidden="true" size={14} /><span>Selections linked</span>
        </div>
        <button
          ref={toggleRef}
          type="button"
          className="qec-inspector-toggle"
          aria-controls={QEC_RESEARCH_INSPECTOR_ID}
          aria-expanded={inspectorOpen}
          onClick={onToggleInspector}
        >
          <PanelRight aria-hidden="true" size={15} />
          {inspectorOpen ? 'Hide' : 'Show'} research inspector
        </button>
      </div>
    </header>
  );
}

function CanvasInstrument({ panel, primary }: { panel: QecWorkbenchPanelDef; primary: boolean }): ReactElement {
  const Icon = PANEL_ICONS[panel.id] ?? Activity;
  return (
    <section
      className={`qec-instrument qec-instrument--${primary ? 'primary' : 'secondary'}`}
      aria-labelledby={`${panel.id}-instrument-heading`}
    >
      <header>
        <span className="qec-instrument__icon"><Icon aria-hidden="true" size={16} /></span>
        <div><h2 id={`${panel.id}-instrument-heading`}>{panel.title}</h2><span className="qec-mono">Linked · awaiting session data</span></div>
        <QecPanelPinButton panel={panel} />
      </header>
      <div className="qec-instrument__field" aria-hidden="true">
        <span className="qec-instrument__axis qec-instrument__axis--horizontal" />
        <span className="qec-instrument__axis qec-instrument__axis--vertical" />
        <span className="qec-instrument__trace" />
      </div>
      <p>Open or run a compatible source to populate this registered instrument.</p>
    </section>
  );
}

export function InvestigationCanvas(props: InvestigationCanvasProps): ReactElement {
  const preset = useQecWorkbenchStore((state) => state.preset);
  const pinnedPanelIds = useQecWorkbenchStore((state) => state.pinnedPanelIds);
  const panels = resolveQecPanels(preset, 'canvas', pinnedPanelIds);
  return (
    <main className="qec-investigation" aria-label="QEC investigation canvas">
      <CanvasHeader {...props} />
      <div className="qec-instrument-strip" aria-label="Canvas instruments">
        <span>Split view</span><span>Compare</span><span>Time / round</span><span>Checkpoint</span>
      </div>
      <div className="qec-investigation__panels">
        {panels.map((panel, index) => <CanvasInstrument key={panel.id} panel={panel} primary={index === 0} />)}
      </div>
    </main>
  );
}
