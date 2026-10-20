import { Activity, ChartSpline, Clock3, Grid3x3, HelpCircle, PanelRightClose, PanelRightOpen, Share2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactElement, ReactNode, RefObject } from 'react';
import { resolveQecPanels, type QecWorkbenchPanelDef, type QecWorkbenchPanelId } from '../../../layout/qecPanelRegistry';
import { useQecStore } from '../../../stores/qecStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { ICON_SIZE, ICON_STROKE } from '../../../styles/tokens';
import { IconButton } from '../../ui';
import { OpenCircuitAction } from './OpenCircuitAction';
import { instrumentDocsHref } from './instrumentDocs';
import { CodeLatticePanel } from '../CodeLatticePanel';
import { DetectorGraphPanel } from '../DetectorGraphPanel';
import { QecAnalysisView } from '../QecAnalysisView';
import { QecCampaignActions } from '../QecCampaignActions';
import { QecTimelinePanel } from '../QecTimelinePanel';
import { QEC_RESEARCH_INSPECTOR_ID } from './QecResearchInspector';
import { QecPanelPinButton } from './QecPanelPinButton';
import { orderCanvasPanels } from './orderCanvasPanels';
import { canvasGrid, isInstrumentEmpty } from './canvasGrid';
import { useQecCampaignStore } from '../../../stores/qecCampaignStore';

const PANEL_ICONS: Partial<Readonly<Record<QecWorkbenchPanelId, LucideIcon>>> = {
  timeline: Clock3, lattice: Grid3x3, 'detector-graph': Share2,
  'campaign-center': ChartSpline, 'stream-health': Activity, 'calibration-timeline': Clock3,
};

/** What an instrument needs before it can show anything, in plain words. */
const EMPTY_COPY: Partial<Readonly<Record<QecWorkbenchPanelId, { title: string; body: string }>>> = {
  timeline: { title: 'No circuit open', body: 'Open a .stim circuit to see its operations over time.' },
  lattice: { title: 'No circuit open', body: 'Open a .stim circuit with qubit coordinates to see the code lattice.' },
  'detector-graph': { title: 'No circuit open', body: 'Open a .stim circuit to see its detector graph and sample decoded shots.' },
  'stream-health': { title: 'No live stream', body: 'Stream health appears here once a live source is connected.' },
  'calibration-timeline': { title: 'No calibration data', body: 'Calibration history appears here once a source with calibration records is imported.' },
};

const CIRCUIT_PANELS: ReadonlySet<QecWorkbenchPanelId> = new Set(['timeline', 'lattice', 'detector-graph']);

const DEFAULT_EMPTY = { title: 'Nothing to show yet', body: 'Open a compatible source to populate this instrument.' };

interface InvestigationCanvasProps {
  inspectorOpen: boolean;
  onToggleInspector(): void;
  toggleRef: RefObject<HTMLButtonElement | null>;
}

function CanvasHeader({ inspectorOpen, onToggleInspector, toggleRef }: InvestigationCanvasProps): ReactElement {
  const preset = useQecWorkbenchStore((state) => state.preset);
  const label = `${inspectorOpen ? 'Hide' : 'Show'} research inspector`;
  return (
    <header className="qec-investigation__header">
      <div>
        <span className="qec-zone-heading__eyebrow">{preset} preset</span>
        <h1>Investigation Canvas</h1>
      </div>
      <div className="qec-investigation__actions">
        <IconButton
          ref={toggleRef}
          variant="secondary"
          aria-label={label}
          tooltip={{ label, placement: 'below' }}
          aria-controls={QEC_RESEARCH_INSPECTOR_ID}
          aria-expanded={inspectorOpen}
          onClick={onToggleInspector}
        >
          {inspectorOpen
            ? <PanelRightClose aria-hidden="true" size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
            : <PanelRightOpen aria-hidden="true" size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />}
        </IconButton>
      </div>
    </header>
  );
}

/** A neutral dotted field with a sentence: no axes or traces that could pass for data. */
function EmptyInstrument({ panelId }: { panelId: QecWorkbenchPanelId }): ReactElement {
  const copy = EMPTY_COPY[panelId] ?? DEFAULT_EMPTY;
  const Icon = PANEL_ICONS[panelId] ?? Activity;
  return (
    <div className="qec-instrument__empty">
      <Icon aria-hidden="true" size={ICON_SIZE.lg} strokeWidth={ICON_STROKE} />
      <strong>{copy.title}</strong>
      <span>{copy.body}</span>
      {CIRCUIT_PANELS.has(panelId) && <OpenCircuitAction />}
    </div>
  );
}

function CircuitInstrument({ panelId }: { panelId: QecWorkbenchPanelId }): ReactElement {
  const hasCircuit = useQecStore((state) => state.snapshot !== null);
  if (!hasCircuit) return <EmptyInstrument panelId={panelId} />;
  if (panelId === 'timeline') return <QecTimelinePanel embedded />;
  if (panelId === 'lattice') return <CodeLatticePanel embedded />;
  return <DetectorGraphPanel embedded />;
}

function instrumentBody(panelId: QecWorkbenchPanelId): ReactNode {
  switch (panelId) {
    case 'campaign-center': return <QecAnalysisView embedded actionsInHeader />;
    case 'timeline':
    case 'lattice':
    case 'detector-graph': return <CircuitInstrument panelId={panelId} />;
    default: return <EmptyInstrument panelId={panelId} />;
  }
}

/** "7 ticks" / "8 detectors": the circuit fact each instrument is drawn from, shown beside its title. */
function useInstrumentContext(panelId: QecWorkbenchPanelId): string | null {
  const snapshot = useQecStore((state) => state.snapshot);
  if (!snapshot) return null;
  if (panelId === 'timeline') return `${snapshot.num_ticks} ticks`;
  if (panelId === 'detector-graph') return `${snapshot.num_detectors} detectors`;
  return null;
}

/** Every instrument header carries the same pair: a docs link and the pin. */
function InstrumentActions({ panelId, title }: { panelId: QecWorkbenchPanelId; title: string }): ReactElement {
  return (
    <>
      {panelId === 'campaign-center' && <QecCampaignActions embedded />}
      <a
        className="qec-instrument__help"
        href={instrumentDocsHref(panelId)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${title} docs (opens in new tab)`}
      >
        <HelpCircle aria-hidden="true" size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
      </a>
    </>
  );
}

interface CanvasInstrumentProps {
  panel: QecWorkbenchPanelDef;
  primary: boolean;
  rowSpan: number;
  empty: boolean;
  fullWidth: boolean;
}

function CanvasInstrument({ panel, primary, rowSpan, empty, fullWidth }: CanvasInstrumentProps): ReactElement {
  const Icon = PANEL_ICONS[panel.id] ?? Activity;
  const context = useInstrumentContext(panel.id);
  const style: CSSProperties | undefined = primary || fullWidth
    ? { ...(primary ? { gridRow: `span ${rowSpan}` } : {}), ...(fullWidth ? { gridColumn: '1 / -1' } : {}) }
    : undefined;
  return (
    <section
      className={`qec-instrument qec-instrument--${primary ? 'primary' : 'secondary'}`}
      aria-labelledby={`${panel.id}-instrument-heading`}
      data-panel={panel.id}
      data-empty={empty ? 'true' : undefined}
      data-circuit={CIRCUIT_PANELS.has(panel.id) ? 'true' : undefined}
      style={style}
    >
      <header>
        <span className="qec-instrument__icon"><Icon aria-hidden="true" size={ICON_SIZE.md} /></span>
        <div>
          <h2 id={`${panel.id}-instrument-heading`}>{panel.title}</h2>
          {context && <span className="qec-instrument__context qec-mono">{context}</span>}
        </div>
        <InstrumentActions panelId={panel.id} title={panel.title} />
        <QecPanelPinButton panel={panel} />
      </header>
      <div className="qec-instrument__body">{instrumentBody(panel.id)}</div>
    </section>
  );
}

export function InvestigationCanvas(props: InvestigationCanvasProps): ReactElement {
  const preset = useQecWorkbenchStore((state) => state.preset);
  const pinnedPanelIds = useQecWorkbenchStore((state) => state.pinnedPanelIds);
  const panels = orderCanvasPanels(preset, resolveQecPanels(preset, 'canvas', pinnedPanelIds));
  const hasCircuit = useQecStore((state) => state.snapshot !== null);
  const hasCampaignData = useQecCampaignStore((state) => Object.keys(state.rowsByStrongId).length > 0);
  const empties = panels.map((panel) => isInstrumentEmpty(panel.id, { hasCircuit, hasCampaignData }));
  // With nothing to draw every instrument is a short card: rows size to their content instead of stretching.
  const grid = canvasGrid(panels.length, empties.every(Boolean));
  const renderInstrument = (panel: QecWorkbenchPanelDef, index: number): ReactElement => (
    <CanvasInstrument
      key={panel.id}
      panel={panel}
      primary={index === 0}
      rowSpan={grid.primaryRowSpan}
      empty={empties[index]}
      fullWidth={grid.fullWidthIndex === index}
    />
  );
  return (
    <main className="qec-investigation" aria-label="QEC investigation canvas">
      <CanvasHeader {...props} />
      <div
        className="qec-investigation__panels"
        data-compact={grid.compact ? 'true' : undefined}
        data-railed={grid.railed ? 'true' : undefined}
        style={{ gridTemplateRows: grid.gridTemplateRows, alignContent: grid.compact || grid.railed ? 'start' : undefined }}
      >
        {grid.railed ? (
          <>
            {renderInstrument(panels[0], 0)}
            <div className="qec-investigation__rail">{panels.slice(1).map((panel, offset) => renderInstrument(panel, offset + 1))}</div>
          </>
        ) : panels.map(renderInstrument)}
      </div>
    </main>
  );
}
