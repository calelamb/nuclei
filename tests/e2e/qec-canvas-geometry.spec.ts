import { expect, test, type Page } from '@playwright/test';

const FIXTURE_URL = '/?e2eProject=qec-project&workspace=research';
const CSV_FIXTURE = 'src/components/qec/__fixtures__/campaign_stats.csv';
const PRESETS = ['Build', 'Analyze', 'Observe'] as const;
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1100, height: 800 },
  { width: 900, height: 700 },
  { width: 1512, height: 982 },
  { width: 1150, height: 800 },
  { width: 1137, height: 800 },
];
/** Rects closer than this still count as touching, not overlapping. */
const TOLERANCE_PX = 0.5;
/** An empty card is a short card: never the 676-876px field the audit found. */
const MAX_EMPTY_CARD_HEIGHT = 400;

interface Box { id: string; x: number; y: number; w: number; h: number; empty: boolean; clipped: number }

async function installEngineStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Listener = (event: Event | MessageEvent<string>) => void;
    class Stub {
      private readonly listeners = new Map<string, Listener[]>();
      constructor() { queueMicrotask(() => this.emit('open', new Event('open'))); }
      addEventListener(type: string, listener: Listener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
      send(serialized: string): void {
        const frame = JSON.parse(serialized) as { type?: string; requestId?: string };
        if (frame.type === 'authenticate') queueMicrotask(() => this.message({ type: 'authenticated' }));
        else if (frame.type === 'session_list') queueMicrotask(() => this.message({ type: 'session_list_result', requestId: frame.requestId, sessions: [], nextCursor: null }));
      }
      close(): void { this.emit('close', new Event('close')); }
      private message(frame: unknown): void { this.emit('message', new MessageEvent('message', { data: JSON.stringify(frame) })); }
      private emit(type: string, event: Event | MessageEvent<string>): void { for (const l of this.listeners.get(type) ?? []) l(event); }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: Stub });
    Object.defineProperty(window, '__NUCLEI_E2E_QEC_INVOKE__', {
      configurable: true,
      value: async (command: string): Promise<unknown> => command === 'qec_data_start' ? { url: 'ws://127.0.0.1:9743', token: '0'.repeat(64) } : null,
    });
  });
}

async function instrumentBoxes(page: Page): Promise<Box[]> {
  return page.$$eval('.qec-instrument', (nodes) => nodes.map((node) => {
    const el = node as HTMLElement;
    const r = el.getBoundingClientRect();
    return {
      id: el.dataset.panel ?? '', x: r.x, y: r.y, w: r.width, h: r.height, empty: el.dataset.empty === 'true',
      // Content taller than its card is cut off by the card's overflow: hidden.
      clipped: Math.max(0, el.scrollHeight - el.clientHeight),
    };
  }));
}

function overlaps(boxes: readonly Box[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (overlapX > TOLERANCE_PX && overlapY > TOLERANCE_PX) found.push(`${a.id} x ${b.id} (${overlapX.toFixed(1)} x ${overlapY.toFixed(1)})`);
    }
  }
  return found;
}

/** Narrow windows turn the inspector into a drawer that covers the canvas toggle, so close it from its own header. */
async function setInspector(page: Page, open: boolean): Promise<void> {
  const inspector = page.getByRole('complementary', { name: 'Research inspector' });
  const isOpen = await inspector.isVisible();
  if (isOpen === open) return;
  if (open) {
    await page.getByRole('main', { name: 'QEC investigation canvas' }).getByRole('button', { name: /Show research inspector/i }).click();
  } else {
    await inspector.getByRole('button', { name: 'Close research inspector' }).click();
  }
  await expect(inspector).toBeVisible({ visible: open });
}

for (const viewport of VIEWPORTS) {
  test(`@qec canvas cards never overlap or stretch into empty fields at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installEngineStub(page);
    await page.goto(FIXTURE_URL);
    await page.getByRole('button', { name: 'QEC Workbench' }).click();
    await expect(page.getByRole('region', { name: 'QEC Workbench' })).toBeVisible();

    for (const preset of PRESETS) {
      await page.getByRole('radio', { name: preset }).click();
      for (const inspectorOpen of [true, false]) {
        await setInspector(page, inspectorOpen);
        const boxes = await instrumentBoxes(page);
        const label = `${preset}, inspector ${inspectorOpen ? 'open' : 'closed'}`;
        expect(boxes.length, label).toBeGreaterThan(0);
        expect(overlaps(boxes), label).toEqual([]);
        for (const box of boxes.filter((b) => b.empty)) {
          expect(box.h, `${label}: ${box.id}`).toBeLessThanOrEqual(MAX_EMPTY_CARD_HEIGHT);
          expect(box.clipped, `${label}: ${box.id} content is clipped`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
}

test('@qec canvas cards stay clear of each other once a campaign CSV is loaded', async ({ page }) => {
  await installEngineStub(page);
  await page.goto(FIXTURE_URL);
  await page.getByRole('button', { name: 'QEC Workbench' }).click();
  await page.getByRole('radio', { name: 'Analyze' }).click();
  await page.setInputFiles('input[type=file]', CSV_FIXTURE);
  await expect(page.getByLabel('CSV column mapping')).toBeVisible();
  for (const inspectorOpen of [true, false]) {
    await setInspector(page, inspectorOpen);
    expect(overlaps(await instrumentBoxes(page)), `inspector ${inspectorOpen ? 'open' : 'closed'}`).toEqual([]);
  }
});

async function loadSurfaceCircuit(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const fixture = (await import('/src/components/qec/__fixtures__/surface_d3.json')).default;
    const { useQecStore } = await import('/src/stores/qecStore.ts');
    const { useCircuitStore } = await import('/src/stores/circuitStore.ts');
    useQecStore.setState({ snapshot: fixture.qec, circuitText: '# stim', decodeSample: null, decodePending: false });
    useCircuitStore.setState({ snapshot: fixture.snapshot });
  });
}

/** Share of a card's height below its last piece of content (header excluded). */
async function emptyShare(page: Page, panel: string): Promise<number> {
  return page.$eval(`.qec-instrument[data-panel="${panel}"]`, (node) => {
    const card = node as HTMLElement;
    const box = card.getBoundingClientRect();
    let bottom = box.top;
    card.querySelectorAll('.qec-instrument__body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.width > 0) bottom = Math.max(bottom, r.bottom);
    });
    return Math.max(0, box.bottom - Math.min(bottom, box.bottom)) / box.height;
  });
}

/** Scrollers whose content is wider than the card must be keyboard-reachable and fade their edge. */
async function silentlyClippedScrollers(page: Page): Promise<string[]> {
  return page.$$eval('.qec-instrument__body *', (nodes) => nodes.flatMap((node) => {
    const el = node as HTMLElement;
    const style = getComputedStyle(el);
    const scrolls = style.overflowX === 'auto' || style.overflowX === 'scroll';
    if (!scrolls || el.scrollWidth <= el.clientWidth + 1) return [];
    const reachable = el.tabIndex >= 0 && el.hasAttribute('data-more-right');
    return reachable ? [] : [`${el.tagName.toLowerCase()}.${el.className}`];
  }));
}

const DATA_VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1100, height: 800 }, { width: 1920, height: 1080 }];

for (const viewport of DATA_VIEWPORTS) {
  for (const preset of ['Analyze', 'Build'] as const) {
    test(`@qec ${preset} with data never stretches the leading card or clips a scroller silently at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await installEngineStub(page);
      await page.goto(FIXTURE_URL);
      await page.getByRole('button', { name: 'QEC Workbench' }).click();
      await page.getByRole('radio', { name: 'Analyze' }).click();
      await loadSurfaceCircuit(page);
      await page.setInputFiles('input[type=file]', CSV_FIXTURE);
      await expect(page.getByLabel('CSV column mapping')).toBeVisible();
      await page.getByRole('radio', { name: preset }).click();
      await setInspector(page, false);
      const boxes = await instrumentBoxes(page);
      const leading = boxes[0];
      expect(leading.h, `${preset}: leading card height`).toBeLessThanOrEqual(viewport.height);
      expect(await emptyShare(page, leading.id), `${preset}: empty share of ${leading.id}`).toBeLessThan(0.25);
      expect(overlaps(boxes)).toEqual([]);
      for (const box of boxes) expect(box.clipped, `${preset}: ${box.id} is cut off by its own card`).toBeLessThanOrEqual(1);
      // A side rail is never narrower than its figures need.
      for (const box of boxes.slice(1).filter((b) => b.x > leading.x + leading.w - 1)) {
        expect(box.w, `${preset}: rail card ${box.id} width`).toBeGreaterThanOrEqual(340);
      }
      expect(await silentlyClippedScrollers(page)).toEqual([]);
    });
  }
}

test('@qec at 900px the sources fold to a rail so the canvas keeps the width and card titles stay on one line', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await installEngineStub(page);
  await page.goto(FIXTURE_URL);
  await page.getByRole('button', { name: 'QEC Workbench' }).click();
  await page.getByRole('radio', { name: 'Analyze' }).click();
  await page.setInputFiles('input[type=file]', CSV_FIXTURE);
  await expect(page.getByLabel('CSV column mapping')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show sources' })).toBeVisible();
  const { canvas, body } = await page.evaluate(() => ({
    canvas: document.querySelector('.qec-investigation')?.getBoundingClientRect().width ?? 0,
    body: document.querySelector('.qec-workbench__body')?.getBoundingClientRect().width ?? 1,
  }));
  expect(canvas / body, 'canvas share of the workbench').toBeGreaterThan(0.85);
  const titleHeights = await page.$$eval('.qec-instrument h2', (nodes) => nodes.map((n) => n.getBoundingClientRect().height));
  for (const height of titleHeights) expect(height, 'card title is one line').toBeLessThan(24);
  await page.getByRole('button', { name: 'Show sources' }).click();
  await expect(page.getByRole('heading', { name: 'Sources / Data' })).toBeVisible();
});

/** Figures are sized on purpose: the detector graph keeps a drawable canvas, the lattice stops growing, nodes are pixel-sized. */
const FIGURE_VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1100, height: 800 }, { width: 900, height: 700 }];
const MIN_DETECTOR_CANVAS_HEIGHT = 280;
const MAX_LATTICE_CARD_HEIGHT = 520;
const MAX_LATTICE_NODE_PX = 24;
const MIN_COLUMN_WIDTH = 300;

for (const viewport of FIGURE_VIEWPORTS) {
  test(`@qec detector graph keeps its floor and the lattice stays capped with pixel nodes at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installEngineStub(page);
    await page.goto(FIXTURE_URL);
    await page.getByRole('button', { name: 'QEC Workbench' }).click();
    await page.getByRole('radio', { name: 'Build' }).click();
    await loadSurfaceCircuit(page);
    await setInspector(page, false);
    const canvas = page.locator('.qec-instrument[data-panel="detector-graph"] canvas').first();
    await canvas.scrollIntoViewIfNeeded();
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox?.height ?? 0, 'detector canvas height').toBeGreaterThanOrEqual(MIN_DETECTOR_CANVAS_HEIGHT - 1);
    const lattice = page.locator('.qec-instrument[data-panel="lattice"]');
    const latticeBox = await lattice.boundingBox();
    expect(latticeBox?.height ?? 0, 'lattice card height').toBeLessThanOrEqual(MAX_LATTICE_CARD_HEIGHT);
    const nodeSizes = await lattice.locator('[data-lattice-node]').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().width));
    expect(nodeSizes.length).toBeGreaterThan(0);
    for (const size of nodeSizes) expect(size, 'lattice node size in px').toBeLessThanOrEqual(MAX_LATTICE_NODE_PX);
  });
}

test('@qec no empty-canvas column drops under 300px at 900x700', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await installEngineStub(page);
  await page.goto(FIXTURE_URL);
  await page.getByRole('button', { name: 'QEC Workbench' }).click();
  for (const preset of ['Analyze', 'Build'] as const) {
    await page.getByRole('radio', { name: preset }).click();
    await setInspector(page, false);
    for (const box of await instrumentBoxes(page)) {
      expect(box.w, `${preset}: ${box.id} width`).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
    }
  }
});
