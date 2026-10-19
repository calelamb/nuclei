import type { Plugin } from 'vite';

/**
 * lightningcss (Vite's CSS minifier) treats a vendor-prefixed declaration that follows its unprefixed twin as the
 * one to keep and drops the unprefixed one: `backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);`
 * minified to the -webkit- spelling alone, which Chromium and Firefox ignore (dialog scrims lost their blur in
 * production). Writing the prefixed declaration first is the order it handles correctly, so normalise the source.
 */
const PREFIXED_AFTER_PLAIN =
  /(?<![-\w])(backdrop-filter\s*:\s*[^;}]+;)(\s*)(-webkit-backdrop-filter\s*:\s*[^;}]+;)/g;

export function prefixedBeforePlain(css: string): string {
  return css.replace(PREFIXED_AFTER_PLAIN, '$3$2$1');
}

export function cssDeclarationOrder(): Plugin {
  return {
    name: 'nuclei:css-declaration-order',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.css(\?|$)/.test(id)) return null;
      const next = prefixedBeforePlain(code);
      return next === code ? null : { code: next, map: null };
    },
  };
}
