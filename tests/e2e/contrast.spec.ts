import { expect, test } from '@playwright/test';
import { seedCompareRuns } from './support/r12Experiments';

const FIXTURE_URL = '/?e2eProject=qec-project&workspace=research';
const VARIANTS = ['primary', 'danger', 'dirac'] as const;
const THEMES = ['dark', 'light'] as const;
const MIN_TEXT_CONTRAST = 4.5;

interface Sample { bg: string; fg: string; brightness: number }

/** Mounts a real .nuclei-btn of each variant, hovers it, and reads the painted colours. */
async function hoverSamples(page: import('@playwright/test').Page, theme: string): Promise<Record<string, Sample>> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
    const host = document.createElement('div');
    host.id = 'contrast-host';
    host.style.cssText = 'position:fixed;left:20px;top:20px;display:flex;gap:12px;z-index:99999';
    for (const v of ['primary', 'danger', 'dirac']) {
      const b = document.createElement('button');
      b.className = `nuclei-btn nuclei-btn--${v}`;
      b.dataset.variant = v;
      b.textContent = 'Label';
      host.appendChild(b);
    }
    document.body.appendChild(host);
  }, theme);
  const out: Record<string, Sample> = {};
  for (const v of VARIANTS) {
    const btn = page.locator(`#contrast-host [data-variant="${v}"]`);
    await btn.hover();
    await page.waitForTimeout(250); // let the colour transition settle
    out[v] = await btn.evaluate((el) => {
      const cs = getComputedStyle(el);
      const m = /brightness\(([\d.]+)\)/.exec(cs.filter);
      return { bg: cs.backgroundColor, fg: cs.color, brightness: m ? Number(m[1]) : 1 };
    });
  }
  await page.evaluate(() => document.getElementById('contrast-host')?.remove());
  return out;
}

function parse(rgb: string): [number, number, number] {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(rgb);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  // color-mix() computes to color(srgb r g b) with 0..1 channels.
  const c = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(rgb);
  if (!c) throw new Error(`unparseable colour ${rgb}`);
  return [Number(c[1]) * 255, Number(c[2]) * 255, Number(c[3]) * 255];
}
function luminance([r, g, b]: [number, number, number]): number {
  const c = [r, g, b].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(s: Sample): number {
  const bg = parse(s.bg).map((v) => Math.min(255, v * s.brightness)) as [number, number, number];
  const [hi, lo] = [luminance(bg), luminance(parse(s.fg))].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

test.describe('button hover states keep AA text contrast', () => {
  for (const theme of THEMES) {
    test(`${theme}: primary, danger and dirac hover are at least ${MIN_TEXT_CONTRAST}:1`, async ({ page }) => {
      await page.goto(FIXTURE_URL);
      await expect(page.locator('.monaco-editor')).toBeVisible();
      const samples = await hoverSamples(page, theme);
      for (const v of VARIANTS) {
        expect(contrast(samples[v]), `${theme} ${v} hover`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }
    });
  }
});

/** Resolved colour of `el` composited over its opaque ancestors' background, as [r,g,b]. */
const CARD_TEXT_SCRIPT = () => {
  const card = document.querySelector<HTMLElement>('.launch-grid button[data-provider="ibm"]');
  if (!card) return null;
  const channels = (css: string) => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(css) ?? /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(css);
    if (!m) return null;
    const scale = css.startsWith('color(') ? 255 : 1;
    return [Number(m[1]) * scale, Number(m[2]) * scale, Number(m[3]) * scale];
  };
  const pick = (el: Element | null) => ({
    fg: channels(getComputedStyle(el as Element).color),
    opacity: Number(getComputedStyle(el as Element).opacity),
  });
  return {
    bg: channels(getComputedStyle(card).backgroundColor),
    ariaDisabled: card.getAttribute('aria-disabled'),
    cursor: getComputedStyle(card).cursor,
    name: pick(card.querySelector('.launch-grid__name')),
    tagline: pick(card.querySelector('.launch-grid__name')?.nextElementSibling ?? null),
  };
};

test.describe('Launch cards stay AA-legible', () => {
  for (const theme of THEMES) {
    test(`${theme}: a desktop-only card is activatable and its name and tagline are at least ${MIN_TEXT_CONTRAST}:1`, async ({ page }) => {
      await page.goto(FIXTURE_URL);
      await expect(page.locator('.monaco-editor')).toBeVisible();
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await page.getByRole('button', { name: /^Launch/ }).first().click();
      await expect(page.locator('.launch-grid button[data-provider="ibm"]')).toBeVisible();
      const sample = await page.evaluate(CARD_TEXT_SCRIPT);
      expect(sample).not.toBeNull();
      if (!sample?.bg || !sample.name.fg || !sample.tagline.fg) throw new Error('unreadable card colours');
      expect(sample.ariaDisabled, 'activatable cards are not aria-disabled').toBeNull();
      expect(sample.cursor).toBe('pointer');
      expect(sample.name.opacity).toBe(1);
      expect(sample.tagline.opacity).toBe(1);
      const bg = sample.bg as [number, number, number];
      for (const [label, fg] of [['name', sample.name.fg], ['tagline', sample.tagline.fg]] as const) {
        const [hi, lo] = [luminance(bg), luminance(fg as [number, number, number])].sort((a, b) => b - a);
        expect((hi + 0.05) / (lo + 0.05), `${theme} ${label}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }
    });
  }
});

/**
 * Painted colours, not parsed ones: color-mix() washes and color(srgb ...) values are
 * resolved by the browser itself (fill a 1px canvas, read the pixel), then each
 * translucent ancestor background is composited over the one beneath it.
 */
const PAINTED_CONTRAST_SCRIPT = (selector: string) => {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const paint = (css: string): [number, number, number, number] => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const chain: string[] = [];
  for (let n: HTMLElement | null = el; n; n = n.parentElement) chain.push(getComputedStyle(n).backgroundColor);
  let under: [number, number, number] = [255, 255, 255];
  for (const css of chain.reverse()) {
    const [r, g, b, a] = paint(css);
    under = [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a)];
  }
  const [fr, fg, fb] = paint(getComputedStyle(el).color);
  const lum = (c: number[]) => {
    const f = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const [hi, lo] = [lum(under), lum([fr, fg, fb])].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
};

test.describe('Danger text on danger washes stays AA (design-r10-01)', () => {
  for (const theme of THEMES) {
    test(`${theme}: a wrong quiz answer and its feedback are at least ${MIN_TEXT_CONTRAST}:1`, async ({ page }) => {
      await page.goto('/?e2eProject=qec-project');
      await page.getByRole('button', { name: /learn/i }).first().click();
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await page.getByText('Quantum Computing Fundamentals').first().click();
      const option = page.locator('.quiz__option').first();
      await option.scrollIntoViewIfNeeded();
      await option.click();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300); // let the colour transition settle
      for (const selector of ['.quiz__option[data-state="wrong"]', '.quiz__feedback--wrong']) {
        const ratio = await page.evaluate(PAINTED_CONTRAST_SCRIPT, selector);
        expect(ratio, `${theme} ${selector}`).not.toBeNull();
        expect(ratio as number, `${theme} ${selector}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }
    });
  }
});

test.describe('Danger text on the engine-failed band and demo error stays AA (design-r11-01)', () => {
  for (const theme of THEMES) {
    test(`${theme}: the Python-didn't-start title and the demo error are at least ${MIN_TEXT_CONTRAST}:1`, async ({ page }) => {
      await page.goto('/?e2eProject=qec-project');
      await page.getByRole('button', { name: /learn/i }).first().click();
      await page.getByText('Quantum Computing Fundamentals').first().click(); // loads the lesson stylesheets
      await expect(page.locator('.quiz__option').first()).toBeVisible();
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
        const host = document.createElement('div');
        host.innerHTML = '<div class="lesson-engine-failed"><span class="lesson-engine-failed__title">Python did not start</span></div>'
          + '<div class="demo__error">Traceback</div>';
        document.body.appendChild(host);
      }, theme);
      for (const selector of ['.lesson-engine-failed__title', '.demo__error']) {
        // The stylesheet must really be applied, or the default black-on-white would pass vacuously.
        const washed = await page.evaluate((sel) => {
          const wash = document.querySelector(sel)?.closest('.lesson-engine-failed, .demo__error') ?? null;
          return wash !== null && getComputedStyle(wash).backgroundColor !== 'rgba(0, 0, 0, 0)';
        }, selector);
        expect(washed, `${theme} ${selector} has its stylesheet`).toBe(true);
        const ratio = await page.evaluate(PAINTED_CONTRAST_SCRIPT, selector);
        expect(ratio, `${theme} ${selector}`).not.toBeNull();
        expect(ratio as number, `${theme} ${selector}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }
    });
  }
});

test.describe('Accent badge stays AA on every surface in light (design-r11-02)', () => {
  test('light: the accent badge on raised, overlay and sunken surfaces', async ({ page }) => {
    await page.goto('/?e2eProject=qec-project');
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
      for (const surface of ['base', 'raised', 'overlay', 'sunken']) {
        const host = document.createElement('div');
        host.style.background = `var(--color-surface-${surface})`;
        host.innerHTML = `<span id="badge-${surface}" class="nuclei-badge nuclei-badge--accent">Qiskit</span>`;
        document.body.appendChild(host);
      }
    });
    for (const surface of ['base', 'raised', 'overlay', 'sunken']) {
      const ratio = await page.evaluate(PAINTED_CONTRAST_SCRIPT, `#badge-${surface}`);
      expect(ratio as number, surface).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });
});

test.describe('Compare chart tooltip stays AA (design-r12-01)', () => {
  for (const theme of THEMES) {
    test(`${theme}: tooltip rows use neutral text on the tooltip surface, at least ${MIN_TEXT_CONTRAST}:1, with a colour swatch`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(FIXTURE_URL);
      await expect(page.locator('.monaco-editor')).toBeVisible();
      await seedCompareRuns(page);
      await page.getByRole('button', { name: /Experiments/i }).first().click();
      const boxes = page.locator('.nuclei-runs-row input[type=checkbox]');
      for (const i of [0, 1, 2]) await boxes.nth(i).check();
      await page.getByRole('button', { name: /Compare \(3\)/ }).click();
      await page.locator('.recharts-bar-rectangle path').first().hover({ force: true });
      await expect(page.locator('.nuclei-chart-tooltip')).toBeVisible();
      await expect(page.locator('.nuclei-chart-tooltip [data-swatch]')).toHaveCount(3);
      for (const row of [2, 3, 4]) {
        const selector = `.nuclei-chart-tooltip > div:nth-child(${row}) > span:last-child`;
        const ratio = await page.evaluate(PAINTED_CONTRAST_SCRIPT, selector);
        expect(ratio, `${theme} tooltip row ${row - 1}`).not.toBeNull();
        expect(ratio as number, `${theme} tooltip row ${row - 1}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }
    });
  }
});
