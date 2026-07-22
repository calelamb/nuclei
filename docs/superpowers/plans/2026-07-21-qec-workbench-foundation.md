# QEC Workbench Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a light-first four-zone QEC workspace where researchers create/open Studies, switch Build/Analyze/Observe presets, and carry a persistent linked Research Selection over existing QEC sources.

**Architecture:** Add QEC-specific light tokens, versioned Study and selection schemas, focused Zustand stores, and a separate QEC panel registry. Integrate the workbench as a Research activity view without unmounting Monaco, preserving existing experiments and QEC panels for later synchronized upgrades.

**Tech Stack:** React 19, TypeScript 5.9, Zustand 5, Zod 4, YAML 2, CSS custom properties, Vitest/Testing Library, Playwright.

## Global Constraints

- Inherit every constraint in `docs/superpowers/plans/2026-07-21-qec-unified-workbench-program.md`.
- This plan owns `QecStudy`, `QecEntityRef`, `ResearchSelection`, `QecWorkspacePreset`, and workbench shell public names.
- Do not add data-engine concepts or fake hardware sessions in this plan; P2 owns canonical sessions.
- Existing QEC panels continue to render from current stores until P3 migrates them to bounded queries.
- QEC workbench visual acceptance is light-only; do not add dark QEC palette branches.

---

### Task 1: Establish QEC light visual tokens

**Files:**
- Create: `src/styles/qecTokens.ts`
- Create: `src/components/qec/workbench/qecWorkbench.css`
- Create: `src/styles/qecTokens.test.ts`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: Existing CSS tokens from `src/styles/tokens.css`.
- Produces: `QEC_LIGHT_TOKENS`, `QecLightToken`, and `.qec-workbench` CSS variables used by every later QEC component.

- [ ] **Step 1: Write the failing token contract test**

```ts
import { describe, expect, it } from 'vitest';
import { QEC_LIGHT_TOKENS } from './qecTokens';

describe('QEC light tokens', () => {
  it('uses white/light-blue surfaces and no dark navy values', () => {
    expect(QEC_LIGHT_TOKENS.canvas).toBe('#FFFFFF');
    expect(QEC_LIGHT_TOKENS.selection).toBe('#E0F2FE');
    expect(Object.values(QEC_LIGHT_TOKENS)).not.toContain('#0F1B2D');
  });
});
```

- [ ] **Step 2: Run the test and observe the missing module failure**

Run: `npm test -- src/styles/qecTokens.test.ts`

Expected: FAIL because `./qecTokens` does not exist.

- [ ] **Step 3: Add the immutable token object and scoped CSS**

```ts
export const QEC_LIGHT_TOKENS = Object.freeze({
  canvas: '#FFFFFF',
  raised: '#F8FAFC',
  recessed: '#F1F5F9',
  border: '#E2E8F0',
  text: '#1A1A2E',
  textMuted: '#64748B',
  quantum: '#0891B2',
  interactive: '#00B4D8',
  analytical: '#2563EB',
  field: '#F0F9FF',
  selection: '#E0F2FE',
  selectionStrong: '#BAE6FD',
} as const);

export type QecLightToken = keyof typeof QEC_LIGHT_TOKENS;
```

```css
.qec-workbench {
  --qec-canvas: #ffffff;
  --qec-raised: #f8fafc;
  --qec-recessed: #f1f5f9;
  --qec-border: #e2e8f0;
  --qec-text: #1a1a2e;
  --qec-text-muted: #64748b;
  --qec-quantum: #0891b2;
  --qec-interactive: #00b4d8;
  --qec-analytical: #2563eb;
  --qec-field: #f0f9ff;
  --qec-selection: #e0f2fe;
  --qec-selection-strong: #bae6fd;
  color: var(--qec-text);
  background: var(--qec-canvas);
}
```

Import `./components/qec/workbench/qecWorkbench.css'` from `src/main.tsx` directly after `tokens.css`.

- [ ] **Step 4: Run focused verification**

Run: `npm test -- src/styles/qecTokens.test.ts src/styles/tokens.test.ts && npm run build`

Expected: both token suites PASS and TypeScript/Vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/styles/qecTokens.ts src/styles/qecTokens.test.ts src/components/qec/workbench/qecWorkbench.css src/main.tsx
git commit -m "feat: add light QEC workbench tokens"
```

### Task 2: Define and parse Study manifests

**Files:**
- Create: `src/types/qecStudy.ts`
- Create: `src/types/qecStudy.test.ts`
- Create: `src/services/qecStudyFs.ts`
- Create: `src/services/qecStudyFs.test.ts`

**Interfaces:**
- Consumes: `yaml` and Zod.
- Produces: `QecStudy`, `QecStudySource`, `QecWorkspacePreset`, `parseQecStudyYaml(text)`, `serializeQecStudy(study)`, and injectable `QecStudyFs`.

- [ ] **Step 1: Write failing schema tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseQecStudyYaml } from './qecStudy';

describe('parseQecStudyYaml', () => {
  it('parses a minimal schema-1 Study', () => {
    const result = parseQecStudyYaml(`schema: 1\nid: surface-memory\nname: Surface Memory\nquestion: Does d=7 suppress errors?\npreset: build\nsources: []\n`);
    expect(result).toEqual({
      ok: true,
      study: expect.objectContaining({ id: 'surface-memory', preset: 'build' }),
    });
  });

  it('rejects a source path that escapes the project', () => {
    const result = parseQecStudyYaml(`schema: 1\nid: bad\nname: Bad\nquestion: Bad\npreset: analyze\nsources:\n  - id: source\n    kind: stim\n    path: ../../outside.stim\n`);
    expect(result).toEqual({ ok: false, errors: expect.arrayContaining([expect.stringContaining('path')]) });
  });
});
```

- [ ] **Step 2: Run the tests and observe failure**

Run: `npm test -- src/types/qecStudy.test.ts`

Expected: FAIL because the parser is undefined.

- [ ] **Step 3: Implement the versioned schema and serializer**

```ts
import { parse, stringify } from 'yaml';
import { z } from 'zod';

export const qecWorkspacePresetSchema = z.enum(['build', 'analyze', 'observe']);
export type QecWorkspacePreset = z.infer<typeof qecWorkspacePresetSchema>;

const projectPath = z.string().min(1).refine(
  (value) => !value.startsWith('/') && !value.split(/[\\/]/).includes('..'),
  'path must stay inside the project',
);

const qecStudySourceSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['stim', 'python', 'dem', 'experiment', 'noise', 'session']),
  path: projectPath,
});

export type QecStudySource = z.infer<typeof qecStudySourceSchema>;

const qecStudySchema = z.strictObject({
  schema: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  question: z.string().min(1),
  preset: qecWorkspacePresetSchema,
  tags: z.array(z.string()).default([]),
  sources: z.array(qecStudySourceSchema),
});

export type QecStudy = z.infer<typeof qecStudySchema>;
export type QecStudyParse = { ok: true; study: QecStudy } | { ok: false; errors: string[] };

export function parseQecStudyYaml(text: string): QecStudyParse {
  try {
    const result = qecStudySchema.safeParse(parse(text));
    return result.success
      ? { ok: true, study: result.data }
      : { ok: false, errors: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) };
  } catch (error: unknown) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export function serializeQecStudy(study: QecStudy): string {
  return stringify(qecStudySchema.parse(study), { lineWidth: 100 });
}
```

Define `QecStudyFs` with `readTextFile`, `writeTextFile`, `readDir`, `mkdir`, `exists`, `join`, and `watch`; implement `createTauriQecStudyFs()` by following `src/services/experimentFs.ts` without importing Tauri APIs into tests.

- [ ] **Step 4: Verify round-trip and filesystem adapter tests**

Run: `npm test -- src/types/qecStudy.test.ts src/services/qecStudyFs.test.ts`

Expected: PASS, including parse→serialize→parse identity and project-relative path rejection.

- [ ] **Step 5: Commit**

```bash
git add src/types/qecStudy.ts src/types/qecStudy.test.ts src/services/qecStudyFs.ts src/services/qecStudyFs.test.ts
git commit -m "feat: add QEC Study manifests"
```

### Task 3: Add Study discovery and lifecycle state

**Files:**
- Create: `src/services/qecStudyStore.ts`
- Create: `src/services/qecStudyStore.test.ts`
- Create: `src/stores/qecStudyUiStore.ts`
- Create: `src/stores/qecStudyUiStore.test.ts`

**Interfaces:**
- Consumes: `QecStudy`, `QecStudyFs`, and project root.
- Produces: `useQecStudyStore`, `useQecStudyUiStore`, `reloadStudies(projectRoot, fs)`, `createStudy(projectRoot, draft, fs)`, and active Study selection.

- [ ] **Step 1: Write failing store tests**

```ts
it('discovers valid Studies and reports malformed files without crashing', async () => {
  const fs = memoryStudyFs({
    '/p/studies/good.qec-study.yaml': GOOD_STUDY,
    '/p/studies/bad.qec-study.yaml': 'schema: nope',
  });
  await useQecStudyStore.getState().reload('/p', fs);
  expect(useQecStudyStore.getState().studies).toHaveLength(1);
  expect(useQecStudyStore.getState().validationErrors[0].fileName).toBe('bad.qec-study.yaml');
});
```

- [ ] **Step 2: Run and observe the missing store failure**

Run: `npm test -- src/services/qecStudyStore.test.ts src/stores/qecStudyUiStore.test.ts`

Expected: FAIL because stores do not exist.

- [ ] **Step 3: Implement immutable discovery/create/select stores**

Use this public state shape:

```ts
export interface DiscoveredQecStudy {
  fileName: string;
  path: string;
  study: QecStudy;
}

interface QecStudyState {
  studies: readonly DiscoveredQecStudy[];
  validationErrors: readonly { fileName: string; errors: readonly string[] }[];
  loading: boolean;
  reload(projectRoot: string, fs: QecStudyFs): Promise<void>;
  create(projectRoot: string, study: QecStudy, fs: QecStudyFs): Promise<string>;
}
```

The UI store contains `activeStudyId`, `setActiveStudy(id)`, and `clearActiveStudy()`; selecting a missing ID must result in `null`, not stale state.

- [ ] **Step 4: Verify discovery, no-overwrite, watcher, and immutable update cases**

Run: `npm test -- src/services/qecStudyStore.test.ts src/stores/qecStudyUiStore.test.ts`

Expected: PASS with malformed-file, duplicate-create, project-switch, and watcher cleanup cases.

- [ ] **Step 5: Commit**

```bash
git add src/services/qecStudyStore.ts src/services/qecStudyStore.test.ts src/stores/qecStudyUiStore.ts src/stores/qecStudyUiStore.test.ts
git commit -m "feat: discover and select QEC Studies"
```

### Task 4: Implement the shared Research Selection trail

**Files:**
- Create: `src/types/qecSelection.ts`
- Create: `src/stores/researchSelectionStore.ts`
- Create: `src/stores/researchSelectionStore.test.ts`

**Interfaces:**
- Consumes: stable entity IDs from existing QEC fixtures.
- Produces: `QecEntityKind`, `QecEntityRef`, `ResearchSelection`, `useResearchSelectionStore`, `selectPrimary`, `refineScope`, `setTimeWindow`, `back`, `forward`, and `clear`.

- [ ] **Step 1: Write failing immutable-history tests**

```ts
it('navigates a detector-to-tick refinement without mutating prior history', () => {
  const store = useResearchSelectionStore.getState();
  store.selectPrimary({ kind: 'detector', id: 'D42', sessionId: 's1' }, 'panel');
  const before = useResearchSelectionStore.getState().present;
  store.refineScope({ kind: 'tick', id: '31', sessionId: 's1' }, 'panel');
  expect(before.scope).toEqual([]);
  expect(useResearchSelectionStore.getState().present.scope).toEqual([
    { kind: 'tick', id: '31', sessionId: 's1' },
  ]);
  useResearchSelectionStore.getState().back();
  expect(useResearchSelectionStore.getState().present).toEqual(before);
});
```

- [ ] **Step 2: Run and observe failure**

Run: `npm test -- src/stores/researchSelectionStore.test.ts`

Expected: FAIL because the store is missing.

- [ ] **Step 3: Implement frozen public types and bounded history**

```ts
export const EMPTY_RESEARCH_SELECTION: ResearchSelection = {
  primary: null,
  scope: [],
  timeWindow: null,
  source: 'user',
};

interface ResearchSelectionState {
  past: readonly ResearchSelection[];
  present: ResearchSelection;
  future: readonly ResearchSelection[];
  selectPrimary(ref: QecEntityRef, source: ResearchSelection['source']): void;
  refineScope(ref: QecEntityRef, source: ResearchSelection['source']): void;
  setTimeWindow(window: ResearchSelection['timeWindow'], source: ResearchSelection['source']): void;
  back(): void;
  forward(): void;
  clear(): void;
}
```

Cap `past` at 100 entries. Reject refinements whose `sessionId` conflicts with the primary unless the refinement kind is `cohort` or `finding`.

- [ ] **Step 4: Verify history, dedupe, conflict, and clear cases**

Run: `npm test -- src/stores/researchSelectionStore.test.ts`

Expected: PASS with 100-entry cap and no mutation of earlier selections.

- [ ] **Step 5: Commit**

```bash
git add src/types/qecSelection.ts src/stores/researchSelectionStore.ts src/stores/researchSelectionStore.test.ts
git commit -m "feat: add linked QEC research selection"
```

### Task 5: Add the QEC panel registry and presets

**Files:**
- Create: `src/layout/qecPanelRegistry.ts`
- Create: `src/layout/qecPanelRegistry.test.ts`
- Create: `src/stores/qecWorkbenchStore.ts`
- Create: `src/stores/qecWorkbenchStore.test.ts`

**Interfaces:**
- Consumes: `QecWorkspacePreset`.
- Produces: `QecWorkbenchZone`, `QecWorkbenchPanelId`, `QEC_PANEL_REGISTRY`, `resolveQecPreset`, and persisted active preset/splits/pins.

- [ ] **Step 1: Write the preset contract test**

```ts
it.each([
  ['build', 'editor'],
  ['analyze', 'campaign-center'],
  ['observe', 'stream-health'],
] as const)('%s preset makes %s primary', (preset, primary) => {
  expect(resolveQecPreset(preset).primary).toContain(primary);
});
```

- [ ] **Step 2: Run and observe missing registry failure**

Run: `npm test -- src/layout/qecPanelRegistry.test.ts src/stores/qecWorkbenchStore.test.ts`

Expected: FAIL because registry/store do not exist.

- [ ] **Step 3: Implement declarative registry and immutable preset state**

```ts
export type QecWorkbenchZone = 'sources' | 'canvas' | 'inspector' | 'tray';

export type QecWorkbenchPanelId =
  | 'editor'
  | 'timeline'
  | 'lattice'
  | 'detector-graph'
  | 'campaign-center'
  | 'failure-microscope'
  | 'stream-health'
  | 'calibration-timeline'
  | 'research-inspector'
  | 'jobs';

export interface QecWorkbenchPanelDef {
  id: QecWorkbenchPanelId;
  title: string;
  zone: QecWorkbenchZone;
  presets: readonly QecWorkspacePreset[];
  order: number;
}
```

`useQecWorkbenchStore` exposes `preset`, `setPreset`, `pinnedPanelIds`, `pinPanel`, `unpinPanel`, `sourceWidth`, `inspectorWidth`, and `trayHeight`; updates always return new arrays/objects.

- [ ] **Step 4: Verify registry uniqueness and persisted-state hydration**

Run: `npm test -- src/layout/qecPanelRegistry.test.ts src/stores/qecWorkbenchStore.test.ts`

Expected: PASS, including duplicate-ID rejection and invalid persisted preset fallback to `build`.

- [ ] **Step 5: Commit**

```bash
git add src/layout/qecPanelRegistry.ts src/layout/qecPanelRegistry.test.ts src/stores/qecWorkbenchStore.ts src/stores/qecWorkbenchStore.test.ts
git commit -m "feat: register QEC workbench presets"
```

### Task 6: Build the four-zone workbench shell

**Files:**
- Create: `src/components/qec/workbench/QecWorkbench.tsx`
- Create: `src/components/qec/workbench/QecResearchBar.tsx`
- Create: `src/components/qec/workbench/QecSourcesPanel.tsx`
- Create: `src/components/qec/workbench/InvestigationCanvas.tsx`
- Create: `src/components/qec/workbench/QecResearchInspector.tsx`
- Create: `src/components/qec/workbench/QecWorkbenchTray.tsx`
- Create: `src/components/qec/workbench/ResearchTrail.tsx`
- Create: `src/components/qec/workbench/QecWorkbench.test.tsx`

**Interfaces:**
- Consumes: Study/UI/workbench/selection stores and QEC panel registry.
- Produces: accessible four-zone layout and Build/Analyze/Observe switcher.

- [ ] **Step 1: Write the failing accessible shell test**

```tsx
it('renders four named regions and moves between presets', () => {
  render(<QecWorkbench />);
  expect(screen.getByRole('navigation', { name: 'QEC sources and data' })).toBeVisible();
  expect(screen.getByRole('main', { name: 'QEC investigation canvas' })).toBeVisible();
  expect(screen.getByRole('complementary', { name: 'Research inspector' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'QEC jobs and streams' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
  expect(useQecWorkbenchStore.getState().preset).toBe('analyze');
});
```

- [ ] **Step 2: Run and observe component failure**

Run: `npm test -- src/components/qec/workbench/QecWorkbench.test.tsx`

Expected: FAIL because `QecWorkbench` does not exist.

- [ ] **Step 3: Implement semantic shell and visual hierarchy**

Use this component structure:

```tsx
export function QecWorkbench() {
  const preset = useQecWorkbenchStore((state) => state.preset);
  return (
    <section className={`qec-workbench qec-workbench--${preset}`} aria-label="QEC Workbench">
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
```

CSS requirements: canvas `#fff`, sources/tray `var(--qec-recessed)`, 1px borders, no uniform card grid, inspector drawer below 1180px, tray collapsible below 900px, and visible `:focus-visible` rings using `var(--qec-analytical)`.

- [ ] **Step 4: Verify shell, preset, trail, and reduced-motion behavior**

Run: `npm test -- src/components/qec/workbench/QecWorkbench.test.tsx && npm run build`

Expected: PASS and no TypeScript/CSS import errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/qec/workbench
git commit -m "feat: build the QEC workbench shell"
```

### Task 7: Integrate QEC Workbench into Research navigation

**Files:**
- Modify: `src/layout/panelRegistry.ts`
- Modify: `src/layout/panelRegistry.test.ts`
- Modify: `src/components/layout/ActivityBar.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/PanelLayout.tsx`
- Create: `src/components/qec/workbench/QecStudySidebar.tsx`
- Create: `src/components/qec/workbench/QecStudySidebar.test.tsx`

**Interfaces:**
- Consumes: Existing `LeftPanelId`, lazy view loading, project root, and Study store.
- Produces: Research-only `qec` activity view and Study creation/selection sidebar.

- [ ] **Step 1: Extend the registry parity test first**

```ts
it('offers QEC Workbench only in Research mode', () => {
  expect(leftPanelsForMode('research', { developerViews: false })).toContain('qec');
  expect(leftPanelsForMode('learn', { developerViews: false })).not.toContain('qec');
});
```

- [ ] **Step 2: Run and observe the union/registry failure**

Run: `npm test -- src/layout/panelRegistry.test.ts src/components/layout/ActivityBar.test.tsx`

Expected: FAIL because `qec` is not a `LeftPanelId`.

- [ ] **Step 3: Add the view without unmounting Monaco**

Add `'qec'` to `LeftPanelId`, register `{ id: 'qec', label: 'QEC Workbench', modes: ['research'], order: 2 }`, render `QecStudySidebar` in `Sidebar`, and lazy-load `QecWorkbench` in `PanelLayout` using the same overlay/hidden-editor pattern as Experiments and Transpiler.

The takeover condition is exact:

```ts
const showQecWorkbench = workspaceMode === 'research' && activeView === 'qec';
const editorHidden = showTranspilerMain || showExperimentsMain || showQecWorkbench;
```

`QecStudySidebar` reloads `studies/`, shows validation cards, creates a minimal Study from name/question/preset, and selects it.

- [ ] **Step 4: Verify navigation, Monaco preservation, and no Learn regression**

Run: `npm test -- src/layout/panelRegistry.test.ts src/components/layout/ActivityBar.test.tsx src/components/qec/workbench/QecStudySidebar.test.tsx && npm run build`

Expected: PASS; Learn registry snapshot remains unchanged except type additions not visible in Learn.

- [ ] **Step 5: Commit**

```bash
git add src/layout/panelRegistry.ts src/layout/panelRegistry.test.ts src/components/layout/ActivityBar.tsx src/components/layout/Sidebar.tsx src/components/layout/PanelLayout.tsx src/components/qec/workbench/QecStudySidebar.tsx src/components/qec/workbench/QecStudySidebar.test.tsx
git commit -m "feat: add QEC Workbench navigation"
```

### Task 8: Persist preset/layout and restore research context

**Files:**
- Create: `src/services/qecWorkbenchPersistence.ts`
- Create: `src/services/qecWorkbenchPersistence.test.ts`
- Modify: `src/components/qec/workbench/QecWorkbench.tsx`
- Modify: `src/stores/qecWorkbenchStore.ts`
- Modify: `src/stores/researchSelectionStore.ts`

**Interfaces:**
- Consumes: Platform store values and active project/Study IDs.
- Produces: `loadQecWorkbenchState`, `saveQecWorkbenchState`, versioned persisted state, and safe fallback on corruption.

- [ ] **Step 1: Write failure-first persistence tests**

```ts
it('drops an invalid selection but preserves a valid preset', async () => {
  const persisted = { schema: 1, preset: 'analyze', selection: { primary: { kind: 'bogus', id: 'x' } } };
  const loaded = loadQecWorkbenchState(JSON.stringify(persisted));
  expect(loaded.preset).toBe('analyze');
  expect(loaded.selection.primary).toBeNull();
});
```

- [ ] **Step 2: Run and observe missing persistence failure**

Run: `npm test -- src/services/qecWorkbenchPersistence.test.ts`

Expected: FAIL because persistence functions are missing.

- [ ] **Step 3: Implement versioned Zod persistence**

Persist under `qec-workbench:<projectRoot>:<studyId>`. Include schema, preset, pinned IDs, splits, tray collapsed state, and Research Selection. Parse each section independently so one corrupt field does not discard valid neighbors.

```ts
export interface PersistedQecWorkbenchState {
  schema: 1;
  preset: QecWorkspacePreset;
  pinnedPanelIds: readonly QecWorkbenchPanelId[];
  selection: ResearchSelection;
}
```

- [ ] **Step 4: Verify project isolation and corrupted-state recovery**

Run: `npm test -- src/services/qecWorkbenchPersistence.test.ts src/stores/qecWorkbenchStore.test.ts src/stores/researchSelectionStore.test.ts`

Expected: PASS without unhandled storage exceptions.

- [ ] **Step 5: Commit**

```bash
git add src/services/qecWorkbenchPersistence.ts src/services/qecWorkbenchPersistence.test.ts src/components/qec/workbench/QecWorkbench.tsx src/stores/qecWorkbenchStore.ts src/stores/researchSelectionStore.ts
git commit -m "feat: persist QEC investigation context"
```

### Task 9: Add visual, accessibility, and responsive acceptance tests

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.ts`
- Create: `tests/e2e/qec-workbench.spec.ts`
- Create: `tests/e2e/fixtures/qec-project/studies/surface-memory.qec-study.yaml`
- Create: `tests/e2e/fixtures/qec-project/circuits/repetition.stim`

**Interfaces:**
- Consumes: Vite dev server and QEC activity view.
- Produces: Playwright light-theme screenshots and keyboard workflow.

- [ ] **Step 1: Install Playwright/coverage tooling and write the failing E2E test**

Run: `npm install --save-dev @playwright/test @vitest/coverage-v8 && npx playwright install chromium`

```ts
import { expect, test } from '@playwright/test';

test('@qec opens the light workbench and switches preset by keyboard', async ({ page }) => {
  await page.goto('/?e2eProject=qec-project&workspace=research');
  await page.getByRole('button', { name: 'QEC Workbench' }).click();
  await expect(page.getByRole('region', { name: 'QEC Workbench' })).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: 'Analyze' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Analyze' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveScreenshot('qec-workbench-analyze-1440.png');
});
```

- [ ] **Step 2: Run and observe fixture/bootstrap failure**

Run: `npx playwright test tests/e2e/qec-workbench.spec.ts --project=chromium`

Expected: FAIL until the E2E project bootstrap path is wired or the fixture is opened through existing test hooks.

- [ ] **Step 3: Add deterministic E2E bootstrap and viewport projects**

Configure Chromium viewports at 1024×768 and 1440×900. Add `test:coverage` (`vitest run --coverage`) and `test:e2e` (`playwright test`) scripts to `package.json`. Reuse existing web bridge test hooks; if none exist, add a development-only query bootstrap in `src/platform/webBridge.ts` that resolves only paths under `tests/e2e/fixtures` and is tree-shaken from production.

Add keyboard assertions for source→canvas→inspector→tray order, reduced-motion emulation, and Inspector drawer behavior at 1024px.

- [ ] **Step 4: Run plan-level verification**

Run:

```bash
npm test -- src/styles/qecTokens.test.ts src/types/qecStudy.test.ts src/services/qecStudyStore.test.ts src/stores/researchSelectionStore.test.ts src/layout/qecPanelRegistry.test.ts src/components/qec/workbench
npm run lint
npm run build
npx playwright test tests/e2e/qec-workbench.spec.ts --project=chromium
```

Expected: all PASS and approved screenshots show white/light-blue surfaces with no dark navy workbench regions.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json playwright.config.ts tests/e2e src/platform/webBridge.ts
git commit -m "test: cover QEC workbench visual flows"
```

### Task 10: Document the workbench foundation and close the wave

**Files:**
- Create: `docs-site/src/content/docs/research/qec-workbench.mdx`
- Modify: `docs-site/src/content/docs/research/navigating-the-workspace.mdx`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: final Study/preset/navigation behavior.
- Produces: public workflow documentation and Wave 1 verification record.

- [ ] **Step 1: Add docs assertions before prose**

Extend `kernel/tests/test_docs_examples.py` or the docs link checker to assert the new page exists and every internal `/docs/research/` link resolves.

- [ ] **Step 2: Run and observe missing-page failure**

Run: `cd kernel && pytest tests/test_docs_examples.py -q`

Expected: FAIL on missing `qec-workbench` page.

- [ ] **Step 3: Write the task-oriented docs**

Document: create a Study, reference existing experiments, switch presets, use the four zones, use the Research Trail, persistence boundaries, light-only QEC visual target, and how existing QEC files remain source-of-truth.

- [ ] **Step 4: Run the complete Wave 1 gate**

Run: `npm test && npm run lint && npm run build && npx playwright test --grep @qec && cd kernel && pytest tests/test_docs_examples.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs-site/src/content/docs/research/qec-workbench.mdx docs-site/src/content/docs/research/navigating-the-workspace.mdx CHANGELOG.md kernel/tests/test_docs_examples.py
git commit -m "docs: introduce the unified QEC workbench"
```
