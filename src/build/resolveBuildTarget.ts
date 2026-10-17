/**
 * Decides whether a Vite invocation targets the browser (Pyodide) build.
 *
 * `vite build` reads BUILD_TARGET, but `vite preview` re-evaluates the config
 * in a fresh process: running `npx vite preview --outDir dist-web` without
 * BUILD_TARGET=web resolved base "/" while the built HTML references /try/…
 * assets, producing a blank page. Previewing the web output dir therefore
 * counts as the web target; an explicit BUILD_TARGET always wins.
 */
export const WEB_OUT_DIR = 'dist-web';

function previewsWebOutDir(argv: readonly string[]): boolean {
  if (!argv.includes('preview')) return false;
  return argv.some((arg, i) => {
    const value = arg.startsWith('--outDir=') ? arg.slice('--outDir='.length) : argv[i - 1] === '--outDir' ? arg : null;
    return value !== null && value.replace(/\/+$/, '').split('/').pop() === WEB_OUT_DIR;
  });
}

export function isWebBuildTarget(env: Readonly<Record<string, string | undefined>>, argv: readonly string[]): boolean {
  if (env.BUILD_TARGET !== undefined && env.BUILD_TARGET !== '') return env.BUILD_TARGET === 'web';
  return previewsWebOutDir(argv);
}
