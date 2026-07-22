import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { usePlatform } from '../../../platform/PlatformProvider';
import { startQecWorkbenchPersistenceSession } from '../../../services/qecWorkbenchPersistenceSession';
import { useProjectStore } from '../../../stores/projectStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { InvestigationCanvas } from './InvestigationCanvas';
import { QecResearchBar } from './QecResearchBar';
import { QecResearchInspector } from './QecResearchInspector';
import { QecSourcesPanel } from './QecSourcesPanel';
import { QecWorkbenchTray } from './QecWorkbenchTray';

type WorkbenchStyle = CSSProperties & Record<
  '--qec-source-width' | '--qec-inspector-width' | '--qec-tray-height',
  string
>;

function useQecWorkbenchPersistence(): void {
  const platform = usePlatform();
  const projectRoot = useProjectStore((state) => state.projectRoot);
  const studyId = useQecStudyUiStore((state) => state.activeStudyId);
  useEffect(() => {
    if (!projectRoot || !studyId) return undefined;
    return startQecWorkbenchPersistenceSession(platform, projectRoot, studyId);
  }, [platform, projectRoot, studyId]);
}

function useInspectorDrawer() {
  const [open, setOpen] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  const toggle = useCallback(() => open ? close() : setOpen(true), [close, open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, open]);
  return { close, open, toggle, triggerRef };
}

export function QecWorkbench(): ReactElement {
  useQecWorkbenchPersistence();
  const preset = useQecWorkbenchStore((state) => state.preset);
  const sourceWidth = useQecWorkbenchStore((state) => state.sourceWidth);
  const inspectorWidth = useQecWorkbenchStore((state) => state.inspectorWidth);
  const trayHeight = useQecWorkbenchStore((state) => state.trayHeight);
  const persistenceIssue = useQecWorkbenchStore((state) => state.persistenceIssue);
  const drawer = useInspectorDrawer();
  const style: WorkbenchStyle = {
    '--qec-source-width': `${sourceWidth}px`,
    '--qec-inspector-width': `${inspectorWidth}px`,
    '--qec-tray-height': `${trayHeight}px`,
  };
  return (
    <section className={`qec-workbench qec-workbench--${preset} qec-workbench--inspector-${drawer.open ? 'open' : 'closed'}`} aria-label="QEC Workbench" style={style}>
      <div className="qec-workbench__header">
        <QecResearchBar />
        {persistenceIssue && (
          <div className="qec-persistence-error" role="alert">
            <span>{persistenceIssue.message} {persistenceIssue.instruction}</span>
            <button
              type="button"
              disabled={persistenceIssue.retrying}
              aria-busy={persistenceIssue.retrying}
              onClick={persistenceIssue.retry}
            >
              {persistenceIssue.operation === 'read' ? 'Retry restore' : 'Retry save'}
            </button>
          </div>
        )}
      </div>
      <div className="qec-workbench__body">
        <QecSourcesPanel />
        <InvestigationCanvas inspectorOpen={drawer.open} onToggleInspector={drawer.toggle} toggleRef={drawer.triggerRef} />
        <QecResearchInspector open={drawer.open} onClose={drawer.close} />
      </div>
      <QecWorkbenchTray />
    </section>
  );
}
