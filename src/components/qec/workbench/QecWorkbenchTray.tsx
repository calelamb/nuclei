import { ChevronDown, ChevronUp, CircleDot, ListChecks, Radio } from 'lucide-react';
import { type ReactElement } from 'react';
import { QEC_PANEL_REGISTRY } from '../../../layout/qecPanelRegistry';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';

interface TrayHeaderProps { expanded: boolean; onToggle(): void; }

function TrayHeader({ expanded, onToggle }: TrayHeaderProps): ReactElement {
  const preset = useQecWorkbenchStore((state) => state.preset);
  const panels = QEC_PANEL_REGISTRY.filter((panel) => panel.zone === 'tray' && panel.presets.includes(preset));
  return (
    <header className="qec-tray__header">
      <div className="qec-tray__tabs" aria-label="Operational instruments">
        {panels.map((panel) => <span className="qec-tray__active-instrument" key={panel.id}><ListChecks aria-hidden="true" size={15} />{panel.title}</span>)}
        <span><Radio aria-hidden="true" size={14} /> Streams</span><span>Logs</span><span>Comparisons</span>
      </div>
      <button type="button" className="qec-tray__toggle" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} jobs and streams`} onClick={onToggle}>
        {expanded ? <ChevronDown aria-hidden="true" size={17} /> : <ChevronUp aria-hidden="true" size={17} />}
      </button>
    </header>
  );
}

function TrayContent(): ReactElement {
  return (
    <div className="qec-tray__content">
      <div className="qec-tray__empty"><CircleDot aria-hidden="true" size={18} /><div><strong>No active jobs</strong><span>Campaign, import, and stream lifecycle will remain visible here.</span></div></div>
      <dl className="qec-tray__summary">
        <div><dt>Queued</dt><dd className="qec-mono">0</dd></div>
        <div><dt>Running</dt><dd className="qec-mono">0</dd></div>
        <div><dt>Streams</dt><dd className="qec-mono">0</dd></div>
      </dl>
    </div>
  );
}

export function QecWorkbenchTray(): ReactElement {
  const collapsed = useQecWorkbenchStore((state) => state.trayCollapsed);
  const toggleCollapsed = useQecWorkbenchStore((state) => state.toggleTrayCollapsed);
  const expanded = !collapsed;
  return (
    <section className={`qec-tray qec-tray--${expanded ? 'expanded' : 'collapsed'}`} aria-label="QEC jobs and streams">
      <TrayHeader expanded={expanded} onToggle={toggleCollapsed} />
      {expanded && <TrayContent />}
    </section>
  );
}
