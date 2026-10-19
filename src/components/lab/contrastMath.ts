/**
 * WCAG contrast math and a tiny CSS custom-property reader. Used by the
 * design-token unit test (labContrast.test.ts); it has no runtime callers.
 */

export type Rgb = [number, number, number];
export interface ColorWithAlpha {
  rgb: Rgb;
  alpha: number;
}

/** Parse the first top-level `selector { ... }` rule whose selector list contains `selector`. */
export function ruleBody(css: string, selector: string): string {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const wanted = normalize(selector);
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = ruleRe.exec(css); match; match = ruleRe.exec(css)) {
    const selectors = normalize(match[1].replace(/\/\*[\s\S]*?\*\//g, '')).split(/\s*,\s*/);
    if (normalize(match[1].replace(/\/\*[\s\S]*?\*\//g, '')) === wanted || selectors.includes(wanted)) return match[2];
  }
  throw new Error(`No CSS rule for selector: ${selector}`);
}

export function parseDeclarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const cleaned = body.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const part of cleaned.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim().replace(/\s+/g, ' ');
    if (name) out[name] = value;
  }
  return out;
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Resolve a token to a color. Understands hex, CSS custom-property aliases and the
 * Lab's "soft" fills, `color-mix(in srgb, the token N%, transparent)` (a color
 * with alpha N%).
 */
export function resolveColor(tokens: Record<string, string>, name: string, depth = 0): ColorWithAlpha {
  const value = tokens[name];
  if (value === undefined) throw new Error(`Unknown token ${name}`);
  if (depth > 10) throw new Error(`Token cycle at ${name}`);
  const text = value.trim();
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text)) return { rgb: hexToRgb(text), alpha: 1 };
  const alias = /^var\((--[\w-]+)\)$/.exec(text);
  if (alias) return resolveColor(tokens, alias[1], depth + 1);
  const mix = /^color-mix\(in srgb, var\((--[\w-]+)\) (\d+(?:\.\d+)?)%, transparent\)$/.exec(text);
  if (mix) {
    const inner = resolveColor(tokens, mix[1], depth + 1);
    return { rgb: inner.rgb, alpha: inner.alpha * (Number(mix[2]) / 100) };
  }
  throw new Error(`Unsupported color value for ${name}: ${text}`);
}

/** Composite `top` (with alpha) over an opaque `bottom`. */
export function composite(top: ColorWithAlpha, bottom: ColorWithAlpha): ColorWithAlpha {
  const a = top.alpha;
  return {
    rgb: top.rgb.map((c, i) => c * a + bottom.rgb[i] * (1 - a)) as Rgb,
    alpha: 1,
  };
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
