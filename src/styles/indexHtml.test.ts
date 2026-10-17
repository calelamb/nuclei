import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

describe('index.html', () => {
  it('injects the Vercel insights script only on the production host', () => {
    const before = html.slice(0, html.indexOf('var va'));
    const guardLine = before.split('\n').filter((l) => l.includes('if (')).pop() ?? '';
    expect(guardLine).toContain('getnuclei');
    expect(guardLine).toContain('__TAURI_INTERNALS__');
  });
});
