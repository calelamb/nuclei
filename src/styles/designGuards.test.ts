import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(tsx?|css)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

const files = walk(SRC)
  .map((p) => ({ rel: relative(SRC, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }));


function offenders(test: (f: { rel: string; text: string }) => boolean): string[] {
  return files.filter(test).map((f) => f.rel);
}

describe('design guards', () => {
  it('has no inline outline:none that would hide the shared focus ring', () => {
    expect(offenders((f) => /outline:\s*['"]none['"]/.test(f.text))).toEqual([]);
  });

  it('never loads fonts from a CDN (desktop CSP blocks them)', () => {
    expect(offenders((f) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(f.text))).toEqual([]);
  });

  it('has no references to fonts that are not shipped (Fira Code, Inter, JetBrains Mono)', () => {
    expect(offenders((f) => !f.rel.startsWith('index.css') && /Fira Code|JetBrains Mono|\bInter\b,|'Inter'/.test(f.text))).toEqual([]);
  });

  it('has no unshipped font weights (650/750/800)', () => {
    expect(offenders((f) => /font-?[wW]eight['"]?:\s*(650|750|800)\b/.test(f.text))).toEqual([]);
  });

  it('has no hard-coded onboarding gradient end colour', () => {
    expect(offenders((f) => /#080E18/i.test(f.text))).toEqual([]);
  });

  it('does not paint accent buttons with panel-coloured text (fails AA in light theme); use <Button variant="primary">', () => {
    expect(offenders((f) => /background:\s*colors\.accent,\s*color:\s*colors\.bgPanel/.test(f.text))).toEqual([]);
  });

  it('keeps JSX icon sizes on the 12/14/16/20 scale', () => {
    expect(offenders((f) => /<[A-Za-z.]*(Icon|Icon\w*)\s[^>]*size=\{(9|10|11|13|15|17|18)\}/.test(f.text) || /<(Icon|MIcon|stat\.icon)\s[^>]*size=\{(9|10|11|13|15)\}/.test(f.text))).toEqual([]);
  });

  it('keeps the research trees (experiments, qec) on the 11px minimum type size and CSS hover states', () => {
    const research = (f: { rel: string }) => /^components\/(experiments|qec)\//.test(f.rel);
    expect(offenders((f) => research(f) && /fontSize:\s*(?:[1-9]|10)(?:\.5)?\b(?!\s*[%a-z])/.test(f.text) && !/<svg/.test(f.text))).toEqual([]);
    expect(offenders((f) => research(f) && /currentTarget\.style\./.test(f.text))).toEqual([]);
  });

  it('has no purple (Dirac) colours in the research trees', () => {
    expect(offenders((f) => /^components\/(experiments|qec)\//.test(f.rel) && /colors\.dirac\b/.test(f.text))).toEqual([]);
  });

  it('uses accentText (not the raw teal fill colour) for text outside the trees other lanes still own', () => {
    // Raw accent teal fails AA as small text on white; fills and borders may still use it.
    const pending = /^components\/(learning|challenges|community|experiments|markdown|qec)\/|^components\/hardware\/(HardwarePanel|LaunchPortal)\.tsx$/;
    const rawAccentText = /(?<![-\w])color:\s*(?:colors\.accent\b(?!Text|Light)|var\(--color-accent-quantum\))/;
    expect(offenders((f) => !pending.test(f.rel) && rawAccentText.test(f.text))).toEqual([]);
  });

  it('draws modal backdrops with the scrim token, not a hard-coded black', () => {
    const modalFiles = ['components/onboarding/KeyboardShortcuts.tsx', 'components/commandPalette/CommandPalette.tsx', 'components/ui/Dialog.tsx'];
    expect(offenders((f) => modalFiles.includes(f.rel) && /background:\s*['"]rgba\(0,\s*0,\s*0/.test(f.text))).toEqual([]);
  });
});
