/** What the Research card promises must be true in the build the person is using. */
export function researchCardDescription(web: boolean): string {
  return web
    ? 'Analyse QEC data in your browser: drop a sinter CSV, fit Λ, compare decoders. Experiments and projects need the desktop app.'
    : 'A multi-file workspace for experiments, parameter sweeps, and reproducible runs, with Dirac as a terse collaborator.';
}
