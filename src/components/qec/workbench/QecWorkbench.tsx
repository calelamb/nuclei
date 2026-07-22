import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { usePlatform } from '../../../platform/PlatformProvider';
import type { PlatformBridge } from '../../../platform/bridge';
import {
  getQecWorkbenchStorageKey,
  loadQecWorkbenchState,
  saveQecWorkbenchState,
  type PersistedQecWorkbenchState,
} from '../../../services/qecWorkbenchPersistence';
import { useProjectStore } from '../../../stores/projectStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import {
  QEC_WORKBENCH_DEFAULTS,
  useQecWorkbenchStore,
} from '../../../stores/qecWorkbenchStore';
import { EMPTY_RESEARCH_SELECTION, useResearchSelectionStore } from '../../../stores/researchSelectionStore';
import { InvestigationCanvas } from './InvestigationCanvas';
import { QecResearchBar } from './QecResearchBar';
import { QecResearchInspector } from './QecResearchInspector';
import { QecSourcesPanel } from './QecSourcesPanel';
import { QecWorkbenchTray } from './QecWorkbenchTray';

type WorkbenchStyle = CSSProperties & Record<
  '--qec-source-width' | '--qec-inspector-width' | '--qec-tray-height',
  string
>;

const PERSIST_DEBOUNCE_MS = 250;
const READ_ERROR = 'Could not restore QEC workspace context. The default workspace is still available.';
const WRITE_ERROR = 'Could not save QEC workspace context. Your current workspace remains open.';

function currentPersistenceSnapshot(): PersistedQecWorkbenchState {
  const workbench = useQecWorkbenchStore.getState();
  const selection = useResearchSelectionStore.getState().present;
  return {
    schema: 1,
    preset: workbench.preset,
    pinnedPanelIds: [...workbench.pinnedPanelIds],
    sourceWidth: workbench.sourceWidth,
    inspectorWidth: workbench.inspectorWidth,
    trayHeight: workbench.trayHeight,
    trayCollapsed: workbench.trayCollapsed,
    selection: { ...selection, scope: selection.scope.map((ref) => ({ ...ref })) },
  };
}

function hydrateContext(state: PersistedQecWorkbenchState): void {
  useQecWorkbenchStore.getState().hydrate({
    preset: state.preset,
    pinnedPanelIds: state.pinnedPanelIds,
    sourceWidth: state.sourceWidth,
    inspectorWidth: state.inspectorWidth,
    trayHeight: state.trayHeight,
    trayCollapsed: state.trayCollapsed,
  });
  useResearchSelectionStore.getState().restore(state.selection);
}

function layoutChanged(current: ReturnType<typeof useQecWorkbenchStore.getState>, previous: ReturnType<typeof useQecWorkbenchStore.getState>): boolean {
  return current.preset !== previous.preset ||
    current.pinnedPanelIds !== previous.pinnedPanelIds ||
    current.sourceWidth !== previous.sourceWidth ||
    current.inspectorWidth !== previous.inspectorWidth ||
    current.trayHeight !== previous.trayHeight ||
    current.trayCollapsed !== previous.trayCollapsed;
}

function startPersistenceSession(
  platform: PlatformBridge,
  projectRoot: string,
  studyId: string,
): () => void {
  let disposed = false;
  let hydrated = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = async (): Promise<void> => {
    try {
      await saveQecWorkbenchState(platform, projectRoot, studyId, currentPersistenceSnapshot());
      if (!disposed) useQecWorkbenchStore.getState().setPersistenceError(null);
    } catch {
      if (!disposed) useQecWorkbenchStore.getState().setPersistenceError(WRITE_ERROR);
    }
  };
  const schedule = (): void => {
    if (!hydrated) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void save(); }, PERSIST_DEBOUNCE_MS);
  };
  const stopWorkbench = useQecWorkbenchStore.subscribe((state, previous) => {
    if (layoutChanged(state, previous)) schedule();
  });
  const stopSelection = useResearchSelectionStore.subscribe((state, previous) => {
    if (state.present !== previous.present) schedule();
  });
  hydrateContext({ schema: 1, ...QEC_WORKBENCH_DEFAULTS, selection: EMPTY_RESEARCH_SELECTION });
  useQecWorkbenchStore.getState().setPersistenceError(null);
  void platform.getStoredValue<unknown>(getQecWorkbenchStorageKey(projectRoot, studyId))
    .then((stored) => { if (!disposed) hydrateContext(loadQecWorkbenchState(stored)); })
    .catch(() => { if (!disposed) useQecWorkbenchStore.getState().setPersistenceError(READ_ERROR); })
    .finally(() => { if (!disposed) hydrated = true; });
  return () => {
    disposed = true;
    stopWorkbench();
    stopSelection();
    if (timer) clearTimeout(timer);
  };
}

function useQecWorkbenchPersistence(): void {
  const platform = usePlatform();
  const projectRoot = useProjectStore((state) => state.projectRoot);
  const studyId = useQecStudyUiStore((state) => state.activeStudyId);
  useEffect(() => {
    if (!projectRoot || !studyId) return undefined;
    return startPersistenceSession(platform, projectRoot, studyId);
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
  const persistenceError = useQecWorkbenchStore((state) => state.persistenceError);
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
        {persistenceError && <p className="qec-persistence-error" role="alert">{persistenceError}</p>}
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
