import { ChevronDown, ChevronUp, CircleDot, ListChecks, Radio } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { QEC_PANEL_REGISTRY } from '../../../layout/qecPanelRegistry';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';

export function QecWorkbenchTray(): ReactElement {
  const [expanded, setExpanded] = useState(true);
  const preset = useQecWorkbenchStore((state) => state.preset);
  const trayPanels = QEC_PANEL_REGISTRY.filter(
    (panel) => panel.zone === 'tray' && panel.presets.includes(preset),
  );

  return (
    <section
      className={`qec-tray qec-tray--${expanded ? 'expanded' : 'collapsed'}`}
      aria-label="QEC jobs and streams"
    >
      <header className="qec-tray__header">
        <div className="qec-tray__tabs" aria-label="Operational instruments">
          {trayPanels.map((panel) => (
            <span className="qec-tray__active-instrument" key={panel.id}>
              <ListChecks aria-hidden="true" size={15} />
              {panel.title}
            </span>
          ))}
          <span><Radio aria-hidden="true" size={14} /> Streams</span>
          <span>Logs</span>
          <span>Comparisons</span>
        </div>
        <button
          type="button"
          className="qec-tray__toggle"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} jobs and streams`}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded
            ? <ChevronDown aria-hidden="true" size={17} />
            : <ChevronUp aria-hidden="true" size={17} />}
        </button>
      </header>
      {expanded && (
        <div className="qec-tray__content">
          <div className="qec-tray__empty">
            <CircleDot aria-hidden="true" size={18} />
            <div>
              <strong>No active jobs</strong>
              <span>Campaign, import, and stream lifecycle will remain visible here.</span>
            </div>
          </div>
          <dl className="qec-tray__summary">
            <div><dt>Queued</dt><dd className="qec-mono">0</dd></div>
            <div><dt>Running</dt><dd className="qec-mono">0</dd></div>
            <div><dt>Streams</dt><dd className="qec-mono">0</dd></div>
          </dl>
        </div>
      )}
    </section>
  );
}
