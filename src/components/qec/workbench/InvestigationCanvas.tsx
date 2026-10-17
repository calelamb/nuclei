import { Activity, ChartSpline, Clock3, Grid3x3, HelpCircle, Link2, PanelRightClose, PanelRightOpen, Share2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactElement, ReactNode, RefObject } from 'react';
import { resolveQecPanels, type QecWorkbenchPanelDef, type QecWorkbenchPanelId } from '../../../layout/qecPanelRegistry';
import { useQecStore } from '../../../stores/qecStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { ICON_SIZE, ICON_STROKE } from '../../../styles/tokens';
import { Button, IconButton } from '../../ui';
import { useQecStudyStore } from '../../../services/qecStudyStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { useOpenSource } from './useOpenSource';
import { CodeLatticePanel } from '../CodeLatticePanel';
import { DetectorGraphPanel } from '../DetectorGraphPanel';
import { QecAnalysisView } from '../QecAnalysisView';
import { QecCampaignActions } from '../QecCampaignActions';
import { QecTimelinePanel } from '../QecTimelinePanel';
import { QEC_RESEARCH_INSPECTOR_ID } from './QecResearchInspector';
import { QecPanelPinButton } from './QecPanelPinButton';
import { orderCanvasPanels } from './orderCanvasPanels';

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
        <div className="qec-instrument-state" role="status" title="Selecting something in one instrument selects it in the others">
          <Link2 aria-hidden="true" size={ICON_SIZE.sm} /><span>Selections linked</span>
        </div>
        <IconButton
          ref={toggleRef}
          variant="secondary"
          aria-label={label}
          title={label}
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

function circuitHint(study: unknown, count: number): string {
  if (study === null) return 'Create a Study to attach a .stim circuit.';
  return count > 1 ? 'Double-click a .stim file under Referenced files to open it.' : 'This Study references no .stim circuit.';
}

/** One click to the circuit when the active Study names exactly one; otherwise say where the files are. */
function OpenCircuitAction(): ReactElement {
  const studies = useQecStudyStore((state) => state.studies);
  const activeStudyId = useQecStudyUiStore((state) => state.activeStudyId);
  const { open, error } = useOpenSource();
  const study = studies.find((entry) => entry.study.id === activeStudyId)?.study ?? null;
  const circuits = study?.sources.filter((source) => source.kind === 'stim') ?? [];
  if (circuits.length !== 1) {
    return <span className="qec-instrument__hint">{circuitHint(study, circuits.length)}</span>;
  }
  const circuit = circuits[0];
  return (
    <span className="qec-open-circuit">
      <Button size="sm" variant="primary" onClick={() => { void open(circuit); }}>{`Open ${circuit.path.split('/').pop()}`}</Button>
      {error && <span className="qec-instrument__hint" role="alert">{error}</span>}
    </span>
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

const CIRCUIT_DOCS = 'https://getnuclei.dev/docs/research/qec-studio/';

/** "7 ticks" / "8 detectors": the circuit fact each instrument is drawn from, shown beside its title. */
function useInstrumentContext(panelId: QecWorkbenchPanelId): string | null {
  const snapshot = useQecStore((state) => state.snapshot);
  if (!snapshot) return null;
  if (panelId === 'timeline') return `${snapshot.num_ticks} ticks`;
  if (panelId === 'detector-graph') return `${snapshot.num_detectors} detectors`;
  return null;
}

function InstrumentActions({ panelId }: { panelId: QecWorkbenchPanelId }): ReactElement | null {
  if (panelId === 'campaign-center') return <QecCampaignActions embedded />;
  if (!CIRCUIT_PANELS.has(panelId)) return null;
  return (
    <a
      className="qec-instrument__help"
      href={CIRCUIT_DOCS}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open documentation in a new tab"
      title="Documentation"
    >
      <HelpCircle aria-hidden="true" size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
    </a>
  );
}

function CanvasInstrument({ panel, primary, rowSpan }: { panel: QecWorkbenchPanelDef; primary: boolean; rowSpan: number }): ReactElement {
  const Icon = PANEL_ICONS[panel.id] ?? Activity;
  const context = useInstrumentContext(panel.id);
  const hasCircuit = useQecStore((state) => state.snapshot !== null);
  const empty = CIRCUIT_PANELS.has(panel.id) && !hasCircuit;
  const style: CSSProperties | undefined = primary ? { gridRow: `span ${rowSpan}` } : undefined;
  return (
    <section
      className={`qec-instrument qec-instrument--${primary ? 'primary' : 'secondary'}`}
      aria-labelledby={`${panel.id}-instrument-heading`}
      data-panel={panel.id}
      data-empty={empty ? 'true' : undefined}
      style={style}
    >
      <header>
        <span className="qec-instrument__icon"><Icon aria-hidden="true" size={ICON_SIZE.md} /></span>
        <div>
          <h2 id={`${panel.id}-instrument-heading`}>{panel.title}</h2>
          {context && <span className="qec-instrument__context qec-mono">{context}</span>}
        </div>
        <InstrumentActions panelId={panel.id} />
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
  const rows = Math.max(1, panels.length - 1);
  // With no circuit every instrument is a short card: let rows size to their content instead of stretching.
  const hasCircuit = useQecStore((state) => state.snapshot !== null);
  const compact = !hasCircuit && panels.every((panel) => CIRCUIT_PANELS.has(panel.id));
  const rowSize = compact ? 'max-content' : 'minmax(150px, 1fr)';
  return (
    <main className="qec-investigation" aria-label="QEC investigation canvas">
      <CanvasHeader {...props} />
      <div className="qec-investigation__panels" style={{ gridTemplateRows: `repeat(${rows}, ${rowSize})`, alignContent: compact ? 'start' : undefined }}>
        {panels.map((panel, index) => <CanvasInstrument key={panel.id} panel={panel} primary={index === 0} rowSpan={rows} />)}
      </div>
    </main>
  );
}
