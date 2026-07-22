import type { PlatformBridge } from '../platform/bridge';
import {
  QEC_WORKBENCH_DEFAULTS,
  type QecPersistenceIssue,
  type QecPersistenceOperation,
  type QecWorkbenchState,
  useQecWorkbenchStore,
} from '../stores/qecWorkbenchStore';
import {
  EMPTY_RESEARCH_SELECTION,
  type ResearchSelectionState,
  useResearchSelectionStore,
} from '../stores/researchSelectionStore';
import {
  getQecWorkbenchStorageKey,
  loadQecWorkbenchState,
  saveQecWorkbenchState,
  type PersistedQecWorkbenchState,
} from './qecWorkbenchPersistence';

const PERSIST_DEBOUNCE_MS = 250;
const READ_ERROR = 'Could not restore QEC workspace context.';
const READ_INSTRUCTION = 'Retry restore to recover the saved workspace.';
const WRITE_ERROR = 'Could not save QEC workspace context.';
const WRITE_INSTRUCTION = 'Retry save to preserve your current workspace.';

type DirtyKey = keyof Omit<PersistedQecWorkbenchState, 'schema'>;

interface WriteJob {
  revision: number;
  snapshot: PersistedQecWorkbenchState;
  issueToken: number | null;
}

interface SessionState {
  disposed: boolean;
  hydrated: boolean;
  internalHydration: boolean;
  dirtyKeys: readonly DirtyKey[];
  revision: number;
  issueCounter: number;
  timer: ReturnType<typeof setTimeout> | null;
  queued: WriteJob | null;
  writing: boolean;
  unsubscribers: readonly (() => void)[];
}

const INITIAL_SESSION_STATE: SessionState = {
  disposed: false,
  hydrated: false,
  internalHydration: false,
  dirtyKeys: [],
  revision: 0,
  issueCounter: 0,
  timer: null,
  queued: null,
  writing: false,
  unsubscribers: [],
};

function currentSnapshot(): PersistedQecWorkbenchState {
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

function hydrateLayout(state: PersistedQecWorkbenchState): void {
  useQecWorkbenchStore.getState().hydrate({
    preset: state.preset,
    pinnedPanelIds: state.pinnedPanelIds,
    sourceWidth: state.sourceWidth,
    inspectorWidth: state.inspectorWidth,
    trayHeight: state.trayHeight,
    trayCollapsed: state.trayCollapsed,
  });
}

function layoutChanges(current: QecWorkbenchState, previous: QecWorkbenchState): DirtyKey[] {
  const changed: DirtyKey[] = [];
  if (current.preset !== previous.preset) changed.push('preset');
  if (current.pinnedPanelIds !== previous.pinnedPanelIds) changed.push('pinnedPanelIds');
  if (current.sourceWidth !== previous.sourceWidth) changed.push('sourceWidth');
  if (current.inspectorWidth !== previous.inspectorWidth) changed.push('inspectorWidth');
  if (current.trayHeight !== previous.trayHeight) changed.push('trayHeight');
  if (current.trayCollapsed !== previous.trayCollapsed) changed.push('trayCollapsed');
  return changed;
}

function mergeLoadedState(
  loaded: PersistedQecWorkbenchState,
  local: PersistedQecWorkbenchState,
  dirtyKeys: readonly DirtyKey[],
): PersistedQecWorkbenchState {
  const retain = <K extends DirtyKey>(key: K): PersistedQecWorkbenchState[K] =>
    dirtyKeys.includes(key) ? local[key] : loaded[key];
  return {
    schema: 1,
    preset: retain('preset'),
    pinnedPanelIds: retain('pinnedPanelIds'),
    sourceWidth: retain('sourceWidth'),
    inspectorWidth: retain('inspectorWidth'),
    trayHeight: retain('trayHeight'),
    trayCollapsed: retain('trayCollapsed'),
    selection: retain('selection'),
  };
}

class QecWorkbenchPersistenceSession {
  private state: SessionState = INITIAL_SESSION_STATE;
  private readonly scopeKey: string;
  private readonly platform: PlatformBridge;
  private readonly projectRoot: string;
  private readonly studyId: string;

  constructor(
    platform: PlatformBridge,
    projectRoot: string,
    studyId: string,
  ) {
    this.platform = platform;
    this.projectRoot = projectRoot;
    this.studyId = studyId;
    this.scopeKey = getQecWorkbenchStorageKey(projectRoot, studyId);
  }

  private update(partial: Partial<SessionState>): void {
    this.state = { ...this.state, ...partial };
  }

  start(): () => void {
    const stopWorkbench = useQecWorkbenchStore.subscribe((current, previous) => {
      this.recordChanges(layoutChanges(current, previous));
    });
    const stopSelection = useResearchSelectionStore.subscribe((current, previous) => {
      this.recordSelectionChange(current, previous);
    });
    this.update({ internalHydration: true, unsubscribers: [stopWorkbench, stopSelection] });
    hydrateLayout({ schema: 1, ...QEC_WORKBENCH_DEFAULTS, selection: EMPTY_RESEARCH_SELECTION });
    useResearchSelectionStore.getState().restore(EMPTY_RESEARCH_SELECTION);
    useQecWorkbenchStore.getState().setPersistenceIssue(null);
    this.update({ internalHydration: false });
    void this.read(null);
    return () => this.dispose();
  }

  private recordSelectionChange(
    current: ResearchSelectionState,
    previous: ResearchSelectionState,
  ): void {
    if (current.present !== previous.present) this.recordChanges(['selection']);
  }

  private recordChanges(keys: readonly DirtyKey[]): void {
    if (this.state.disposed || this.state.internalHydration || keys.length === 0) return;
    const dirtyKeys = [...new Set([...this.state.dirtyKeys, ...keys])];
    this.update({ dirtyKeys, revision: this.state.revision + 1 });
    if (this.state.hydrated) this.scheduleSave();
  }

  private hydrateLoaded(loaded: PersistedQecWorkbenchState): void {
    const dirtyKeys = this.state.dirtyKeys;
    const merged = mergeLoadedState(loaded, currentSnapshot(), dirtyKeys);
    this.update({ internalHydration: true });
    hydrateLayout(merged);
    if (!dirtyKeys.includes('selection')) {
      useResearchSelectionStore.getState().restore(merged.selection);
    }
    this.update({ internalHydration: false, hydrated: true, dirtyKeys: [] });
    if (dirtyKeys.length > 0) this.scheduleSave();
  }

  private async read(issueToken: number | null): Promise<void> {
    if (issueToken !== null) this.updateIssue(issueToken, true);
    try {
      const stored = await this.platform.getStoredValue<unknown>(this.scopeKey);
      if (this.state.disposed) return;
      this.hydrateLoaded(loadQecWorkbenchState(stored));
      if (issueToken !== null) this.clearIssue(issueToken, 'read');
    } catch {
      if (!this.state.disposed) this.publishReadIssue(issueToken);
    }
  }

  private scheduleSave(): void {
    if (this.state.timer) clearTimeout(this.state.timer);
    const timer = setTimeout(() => {
      this.update({ timer: null });
      this.enqueueLatest(this.currentWriteIssueToken());
    }, PERSIST_DEBOUNCE_MS);
    this.update({ timer });
  }

  private enqueueLatest(issueToken: number | null): void {
    const queued: WriteJob = {
      revision: this.state.revision,
      snapshot: currentSnapshot(),
      issueToken,
    };
    this.update({ queued });
    this.drainWrites();
  }

  private drainWrites(): void {
    const job = this.state.queued;
    if (this.state.disposed || this.state.writing || !job) return;
    this.update({ queued: null, writing: true });
    void this.write(job);
  }

  private async write(job: WriteJob): Promise<void> {
    try {
      await saveQecWorkbenchState(this.platform, this.projectRoot, this.studyId, job.snapshot);
      if (!this.state.disposed && job.revision === this.state.revision) {
        this.clearIssue(job.issueToken, 'write');
      }
    } catch {
      const isLatest = job.revision === this.state.revision && !this.state.queued && !this.state.timer;
      if (!this.state.disposed && isLatest) this.publishWriteIssue(job.issueToken);
    } finally {
      if (!this.state.disposed) {
        this.update({ writing: false });
        this.drainWrites();
      }
    }
  }

  private nextIssue(
    operation: QecPersistenceOperation,
    message: string,
    instruction: string,
    retry: (token: number) => void,
  ): QecPersistenceIssue {
    const token = this.state.issueCounter + 1;
    this.update({ issueCounter: token });
    return {
      scopeKey: this.scopeKey,
      token,
      operation,
      message,
      instruction,
      retrying: false,
      retry: () => retry(token),
    };
  }

  private publishReadIssue(existingToken: number | null): void {
    if (existingToken !== null) return this.updateIssue(existingToken, false);
    const issue = this.nextIssue('read', READ_ERROR, READ_INSTRUCTION, (token) => {
      void this.retryRead(token);
    });
    useQecWorkbenchStore.getState().setPersistenceIssue(issue);
  }

  private publishWriteIssue(existingToken: number | null): void {
    if (existingToken !== null) return this.updateIssue(existingToken, false);
    const issue = this.nextIssue('write', WRITE_ERROR, WRITE_INSTRUCTION, (token) => {
      this.retryWrite(token);
    });
    useQecWorkbenchStore.getState().setPersistenceIssue(issue);
  }

  private currentIssue(): QecPersistenceIssue | null {
    const issue = useQecWorkbenchStore.getState().persistenceIssue;
    return issue?.scopeKey === this.scopeKey ? issue : null;
  }

  private currentWriteIssueToken(): number | null {
    const issue = this.currentIssue();
    return issue?.operation === 'write' ? issue.token : null;
  }

  private updateIssue(token: number, retrying: boolean): void {
    const issue = this.currentIssue();
    if (!issue || issue.token !== token) return;
    useQecWorkbenchStore.getState().setPersistenceIssue({ ...issue, retrying });
  }

  private clearIssue(token: number | null, operation: QecPersistenceOperation): void {
    if (token === null) return;
    const issue = this.currentIssue();
    if (issue?.token === token && issue.operation === operation) {
      useQecWorkbenchStore.getState().setPersistenceIssue(null);
    }
  }

  private async retryRead(token: number): Promise<void> {
    const issue = this.currentIssue();
    if (this.state.disposed || issue?.operation !== 'read' || issue.token !== token || issue.retrying) return;
    await this.read(token);
  }

  private retryWrite(token: number): void {
    const issue = this.currentIssue();
    if (this.state.disposed || issue?.operation !== 'write' || issue.token !== token || issue.retrying) return;
    this.updateIssue(token, true);
    if (this.state.timer) clearTimeout(this.state.timer);
    this.update({ timer: null });
    this.enqueueLatest(token);
  }

  private dispose(): void {
    const issue = this.currentIssue();
    this.update({ disposed: true });
    this.state.unsubscribers.forEach((unsubscribe) => unsubscribe());
    if (this.state.timer) clearTimeout(this.state.timer);
    if (issue) useQecWorkbenchStore.getState().setPersistenceIssue(null);
  }
}

export function startQecWorkbenchPersistenceSession(
  platform: PlatformBridge,
  projectRoot: string,
  studyId: string,
): () => void {
  return new QecWorkbenchPersistenceSession(platform, projectRoot, studyId).start();
}
