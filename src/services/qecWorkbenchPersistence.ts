import { z } from 'zod';
import { QEC_PANEL_REGISTRY, type QecWorkbenchPanelId } from '../layout/qecPanelRegistry';
import type { PlatformBridge } from '../platform/bridge';
import {
  QEC_WORKBENCH_DEFAULTS,
  QEC_WORKBENCH_DIMENSIONS,
  type QecWorkbenchPersistedState,
} from '../stores/qecWorkbenchStore';
import {
  EMPTY_RESEARCH_SELECTION,
  qecEntityRefSchema,
  selectionSourceSchema,
  timeWindowSchema,
} from '../stores/researchSelectionStore';
import type { ResearchSelection } from '../types/qecSelection';
import { qecWorkspacePresetSchema } from '../types/qecStudy';

export interface PersistedQecWorkbenchState extends QecWorkbenchPersistedState {
  schema: 1;
  selection: ResearchSelection;
}

const rootSchema = z.looseObject({ schema: z.literal(1) });
const finiteNumberSchema = z.number().finite();
const panelIdSchema = z.string().refine(
  (value) => QEC_PANEL_REGISTRY.some((panel) => panel.id === value),
);

interface WriteQueueEntry {
  tail: Promise<void>;
}

const writeQueues = new Map<string, WriteQueueEntry>();

function enqueueWrite(key: string, write: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(key)?.tail ?? Promise.resolve();
  const result = previous.then(write);
  const entry: WriteQueueEntry = {
    tail: result.then(() => undefined, () => undefined),
  };
  writeQueues.set(key, entry);
  void entry.tail.then(() => {
    if (writeQueues.get(key) === entry) writeQueues.delete(key);
  });
  return result;
}

/** Test seam confirming idle exact-key queues do not remain retained. */
export function getQecWorkbenchPersistenceWriteQueueSizeForTests(): number {
  return writeQueues.size;
}

function defaults(): PersistedQecWorkbenchState {
  return {
    schema: 1,
    ...QEC_WORKBENCH_DEFAULTS,
    pinnedPanelIds: Object.freeze([]),
    selection: { ...EMPTY_RESEARCH_SELECTION, scope: Object.freeze([]) },
  };
}

function parseExternal(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseDimension(
  value: unknown,
  range: { readonly min: number; readonly max: number },
  fallback: number,
): number {
  const parsed = finiteNumberSchema.safeParse(value);
  if (!parsed.success) return fallback;
  return Math.min(range.max, Math.max(range.min, parsed.data));
}

function parsePanelIds(value: unknown): readonly QecWorkbenchPanelId[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const ids = value.flatMap((entry) => {
    const parsed = panelIdSchema.safeParse(entry);
    return parsed.success ? [parsed.data as QecWorkbenchPanelId] : [];
  });
  return Object.freeze(ids.filter((id, index) => ids.indexOf(id) === index));
}

function parseEntity(value: unknown): ResearchSelection['primary'] {
  if (value === null) return null;
  const parsed = qecEntityRefSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseScope(value: unknown): ResearchSelection['scope'] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const refs = value.flatMap((entry) => {
    const parsed = qecEntityRefSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  const unique = refs.filter((ref, index) => refs.findIndex((candidate) =>
    candidate.kind === ref.kind && candidate.id === ref.id &&
    candidate.sessionId === ref.sessionId && candidate.datasetId === ref.datasetId) === index);
  return Object.freeze(unique);
}

function parseSelection(value: unknown): ResearchSelection {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const window = candidate.timeWindow === null
    ? null
    : timeWindowSchema.safeParse(candidate.timeWindow);
  const source = selectionSourceSchema.safeParse(candidate.source);
  return {
    primary: parseEntity(candidate.primary),
    scope: parseScope(candidate.scope),
    timeWindow: window === null ? null : window.success ? window.data : null,
    source: source.success ? source.data : 'user',
  };
}

/** Build the exact per-project, per-Study platform storage key. */
export function getQecWorkbenchStorageKey(projectRoot: string, studyId: string): string {
  return `qec-workbench:${projectRoot}:${studyId}`;
}

/** Parse untrusted persisted state without allowing one invalid section to erase valid siblings. */
export function loadQecWorkbenchState(serialized: unknown): PersistedQecWorkbenchState {
  const parsedRoot = rootSchema.safeParse(parseExternal(serialized));
  if (!parsedRoot.success) return defaults();
  const value = parsedRoot.data;
  const preset = qecWorkspacePresetSchema.safeParse(value.preset);
  return {
    schema: 1,
    preset: preset.success ? preset.data : QEC_WORKBENCH_DEFAULTS.preset,
    pinnedPanelIds: parsePanelIds(value.pinnedPanelIds),
    sourceWidth: parseDimension(value.sourceWidth, QEC_WORKBENCH_DIMENSIONS.source, QEC_WORKBENCH_DEFAULTS.sourceWidth),
    inspectorWidth: parseDimension(value.inspectorWidth, QEC_WORKBENCH_DIMENSIONS.inspector, QEC_WORKBENCH_DEFAULTS.inspectorWidth),
    trayHeight: parseDimension(value.trayHeight, QEC_WORKBENCH_DIMENSIONS.tray, QEC_WORKBENCH_DEFAULTS.trayHeight),
    trayCollapsed: z.boolean().safeParse(value.trayCollapsed).data ?? false,
    selection: parseSelection(value.selection),
  };
}

function persistenceSnapshot(state: PersistedQecWorkbenchState): PersistedQecWorkbenchState {
  const normalized = loadQecWorkbenchState(state);
  return {
    ...normalized,
    pinnedPanelIds: [...normalized.pinnedPanelIds],
    selection: {
      ...normalized.selection,
      primary: normalized.selection.primary ? { ...normalized.selection.primary } : null,
      scope: normalized.selection.scope.map((ref) => ({ ...ref })),
      timeWindow: normalized.selection.timeWindow ? { ...normalized.selection.timeWindow } : null,
    },
  };
}

/** Persist a defensive schema-1 snapshot. Platform failures intentionally propagate to the shell. */
export async function saveQecWorkbenchState(
  platform: PlatformBridge,
  projectRoot: string,
  studyId: string,
  state: PersistedQecWorkbenchState,
): Promise<void> {
  const key = getQecWorkbenchStorageKey(projectRoot, studyId);
  const snapshot = persistenceSnapshot(state);
  await enqueueWrite(key, () => platform.setStoredValue(key, snapshot));
}
