/** True in the Pyodide web build (BUILD_TARGET=web). Wrapped so tests can mock it. */
export function isWebBuild(): boolean {
  return __BUILD_TARGET__ === 'web';
}
