import type { CSSProperties, ReactElement } from 'react';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { InvestigationCanvas } from './InvestigationCanvas';
import { QecResearchBar } from './QecResearchBar';
import { QecResearchInspector } from './QecResearchInspector';
import { QecSourcesPanel } from './QecSourcesPanel';
import { QecWorkbenchTray } from './QecWorkbenchTray';

type WorkbenchStyle = CSSProperties & {
  '--qec-source-width': string;
  '--qec-inspector-width': string;
  '--qec-tray-height': string;
};

export function QecWorkbench(): ReactElement {
  const preset = useQecWorkbenchStore((state) => state.preset);
  const sourceWidth = useQecWorkbenchStore((state) => state.sourceWidth);
  const inspectorWidth = useQecWorkbenchStore((state) => state.inspectorWidth);
  const trayHeight = useQecWorkbenchStore((state) => state.trayHeight);
  const style: WorkbenchStyle = {
    '--qec-source-width': `${sourceWidth}px`,
    '--qec-inspector-width': `${inspectorWidth}px`,
    '--qec-tray-height': `${trayHeight}px`,
  };

  return (
    <section
      className={`qec-workbench qec-workbench--${preset}`}
      aria-label="QEC Workbench"
      style={style}
    >
      <QecResearchBar />
      <div className="qec-workbench__body">
        <QecSourcesPanel />
        <InvestigationCanvas />
        <QecResearchInspector />
      </div>
      <QecWorkbenchTray />
    </section>
  );
}
