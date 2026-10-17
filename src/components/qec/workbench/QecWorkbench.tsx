import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { usePlatform } from '../../../platform/PlatformProvider';
import { startQecWorkbenchPersistenceSession } from '../../../services/qecWorkbenchPersistenceSession';
import { useProjectStore } from '../../../stores/projectStore';
import { useQecStudyStore } from '../../../services/qecStudyStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { QEC_WORKBENCH_DIMENSIONS, useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { InvestigationCanvas } from './InvestigationCanvas';
import { QecResearchBar } from './QecResearchBar';
import { QecResearchInspector } from './QecResearchInspector';
import { QecSourcesPanel } from './QecSourcesPanel';
import { QecWorkbenchTray } from './QecWorkbenchTray';
import { QecWorkbenchResizeHandle } from './QecWorkbenchResizeHandle';
import { useQecTrayIdle } from './useQecTrayIdle';
import { Button } from '../../ui';

type WorkbenchStyle = CSSProperties & Record<
  '--qec-source-width' | '--qec-inspector-width' | '--qec-tray-height',
  string
>;

function useQecWorkbenchPersistence(): void {
  const platform = usePlatform();
  const projectRoot = useProjectStore((state) => state.projectRoot);
  const studyId = useQecStudyUiStore((state) => state.activeStudyId);
  const studyPreset = useQecStudyStore((state) =>
    state.projectRoot === projectRoot
      ? state.studies.find((entry) => entry.study.id === studyId)?.study.preset
      : undefined);
  useEffect(() => {
    if (!projectRoot || !studyId || !studyPreset) return undefined;
    return startQecWorkbenchPersistenceSession(platform, projectRoot, studyId, studyPreset);
  }, [platform, projectRoot, studyId, studyPreset]);
}

/** Below this width the inspector is an overlay drawer, so it starts closed. */
const DRAWER_QUERY = '(max-width: 1179px)';

function startsOpen(): boolean {
  try {
    return !(typeof window.matchMedia === 'function' && window.matchMedia(DRAWER_QUERY).matches);
  } catch {
    return true;
  }
}

function useInspectorDrawer() {
  const [open, setOpen] = useState(startsOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  const toggle = useCallback(() => open ? close() : setOpen(true), [close, open]);
  // Resizing into the drawer band must not leave an overlay parked over the canvas.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(DRAWER_QUERY);
    if (typeof query.addEventListener !== 'function') return undefined;
    const onChange = (event: MediaQueryListEvent): void => { if (event.matches) setOpen(false); };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return { close, open, toggle, triggerRef };
}

export function QecWorkbench(): ReactElement {
  useQecWorkbenchPersistence();
  const preset = useQecWorkbenchStore((state) => state.preset);
  const sourceWidth = useQecWorkbenchStore((state) => state.sourceWidth);
  const inspectorWidth = useQecWorkbenchStore((state) => state.inspectorWidth);
  const trayHeight = useQecWorkbenchStore((state) => state.trayHeight);
  const trayCollapsed = useQecWorkbenchStore((state) => state.trayCollapsed);
  const setSourceWidth = useQecWorkbenchStore((state) => state.setSourceWidth);
  const setInspectorWidth = useQecWorkbenchStore((state) => state.setInspectorWidth);
  const setTrayHeight = useQecWorkbenchStore((state) => state.setTrayHeight);
  const persistenceIssue = useQecWorkbenchStore((state) => state.persistenceIssue);
  const drawer = useInspectorDrawer();
  const trayIdle = useQecTrayIdle() && !trayCollapsed;
  const style: WorkbenchStyle = {
    '--qec-source-width': `${sourceWidth}px`,
    '--qec-inspector-width': `${inspectorWidth}px`,
    '--qec-tray-height': `${trayHeight}px`,
  };
  return (
    <section className={`qec-workbench qec-workbench--${preset} qec-workbench--inspector-${drawer.open ? 'open' : 'closed'} qec-workbench--tray-${trayCollapsed ? 'collapsed' : 'open'}${trayIdle ? ' qec-workbench--tray-idle' : ''}`} aria-label="QEC Workbench" style={style}>
      <div className="qec-workbench__header">
        <QecResearchBar />
        {persistenceIssue && (
          <div className="qec-persistence-error" role="alert">
            <span>{persistenceIssue.message} {persistenceIssue.instruction}</span>
            <Button size="sm" loading={persistenceIssue.retrying} onClick={persistenceIssue.retry}>
              {persistenceIssue.operation === 'read' ? 'Retry restore' : 'Retry save'}
            </Button>
          </div>
        )}
      </div>
      <div className="qec-workbench__body">
        <QecSourcesPanel />
        <QecWorkbenchResizeHandle
          label="Resize sources panel"
          orientation="vertical"
          value={sourceWidth}
          min={QEC_WORKBENCH_DIMENSIONS.source.min}
          max={QEC_WORKBENCH_DIMENSIONS.source.max}
          direction={1}
          onChange={setSourceWidth}
        />
        <InvestigationCanvas inspectorOpen={drawer.open} onToggleInspector={drawer.toggle} toggleRef={drawer.triggerRef} />
        {drawer.open && <QecWorkbenchResizeHandle
          label="Resize research inspector"
          orientation="vertical"
          value={inspectorWidth}
          min={QEC_WORKBENCH_DIMENSIONS.inspector.min}
          max={QEC_WORKBENCH_DIMENSIONS.inspector.max}
          direction={-1}
          onChange={setInspectorWidth}
        />}
        <QecResearchInspector open={drawer.open} onClose={drawer.close} />
      </div>
      {!trayCollapsed && !trayIdle && <QecWorkbenchResizeHandle
        label="Resize jobs tray"
        orientation="horizontal"
        value={trayHeight}
        min={QEC_WORKBENCH_DIMENSIONS.tray.min}
        max={QEC_WORKBENCH_DIMENSIONS.tray.max}
        direction={-1}
        onChange={setTrayHeight}
      />}
      <QecWorkbenchTray />
    </section>
  );
}
