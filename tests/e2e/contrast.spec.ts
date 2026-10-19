import { expect, test } from '@playwright/test';

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
