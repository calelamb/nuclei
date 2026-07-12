import { stringify } from 'yaml';
import type { ExperimentSpec, RunRecord } from '../types/experiment';

/**
 * PRD 09 Phase E (E4) — Dirac context injection for Research mode, minimal
 * (tone/context only — no tools, no autonomy; that's PRD 12).
 *
 * Pure and framework-free so the cap logic is exhaustively testable without
 * touching `useDirac`. `useDirac.buildContextBlock` calls this only in
 * Research mode with an active experiment (see that file), so Learn-mode
 * chat context is completely unaffected.
 */

/** Runs beyond this count fall back to metrics-only — full manifests for a
 * large sweep would blow the context budget for very little marginal help. */
export const EXPERIMENT_CONTEXT_FULL_RUN_CAP = 10;

export interface ExperimentContextInput {
  fileName: string;
  spec: ExperimentSpec;
}

function fullRunBlock(run: RunRecord): string {
  return `### ${run.dir}\n- manifest: ${JSON.stringify(run.manifest)}\n- metrics: ${JSON.stringify(run.metrics)}`;
}

function metricsOnlyLine(run: RunRecord): string {
  return `- ${run.dir}: ${JSON.stringify(run.metrics)}`;
}

/**
 * Build the Research-mode experiment context block: the active experiment's
 * YAML (re-serialized from its validated spec — the in-memory source of
 * truth) plus the selected runs, capped at `EXPERIMENT_CONTEXT_FULL_RUN_CAP`
 * full manifests before falling back to metrics-only for the rest of that
 * selection.
 */
export function buildExperimentContext(
  experiment: ExperimentContextInput,
  selectedRuns: readonly RunRecord[],
): string {
  const parts: string[] = [];
  const yamlText = stringify(experiment.spec).trimEnd();
  parts.push(`## Active Experiment (${experiment.fileName})\n\`\`\`yaml\n${yamlText}\n\`\`\``);

  if (selectedRuns.length > 0) {
    if (selectedRuns.length <= EXPERIMENT_CONTEXT_FULL_RUN_CAP) {
      const body = selectedRuns.map(fullRunBlock).join('\n\n');
      parts.push(`## Selected Runs (${selectedRuns.length}, full manifests)\n${body}`);
    } else {
      const body = selectedRuns.map(metricsOnlyLine).join('\n');
      parts.push(
        `## Selected Runs (${selectedRuns.length}, metrics only — exceeds the ` +
          `${EXPERIMENT_CONTEXT_FULL_RUN_CAP}-run full-manifest cap)\n${body}`,
      );
    }
  }

  return parts.join('\n\n');
}
