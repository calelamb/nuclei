import { describe, expect, it } from 'vitest';
import { transform } from 'lightningcss';
import { prefixedBeforePlain } from './cssDeclarationOrder';

const SOURCE = '.scrim { background: x; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }';
const minify = (css: string) => transform({
  filename: 'a.css', code: Buffer.from(css), minify: true,
  targets: { chrome: 111 << 16, safari: (16 << 16) | (4 << 8) },
}).code.toString();

describe('prefixedBeforePlain (research-r-14)', () => {
  it('puts the -webkit- declaration ahead of the plain one', () => {
    expect(prefixedBeforePlain(SOURCE)).toBe('.scrim { background: x; -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }');
  });
  it('leaves correctly ordered or lone declarations alone', () => {
    const ok = '.a { -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); }';
    expect(prefixedBeforePlain(ok)).toBe(ok);
    expect(prefixedBeforePlain('.a { backdrop-filter: blur(2px); }')).toBe('.a { backdrop-filter: blur(2px); }');
  });
  it('keeps the unprefixed declaration through minification, which the original order did not', () => {
    expect(minify(SOURCE)).not.toMatch(/(^|[;{])backdrop-filter/);
    expect(minify(prefixedBeforePlain(SOURCE))).toMatch(/[;{]backdrop-filter:blur\(4px\)/);
  });
});
