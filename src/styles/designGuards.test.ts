import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
// Trees owned by other in-flight lanes; remove an entry once it migrates.
const PENDING_MIGRATION = ['components/experiments/', 'components/layout/StatusBar.tsx'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(tsx?|css)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

const files = walk(SRC)
  .map((p) => ({ rel: relative(SRC, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }))
  .filter((f) => !PENDING_MIGRATION.some((m) => f.rel.startsWith(m)));

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
});
