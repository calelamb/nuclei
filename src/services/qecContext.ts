import type { QecCampaignSpec } from '../types/experiment';
import { campaignTaskCount } from '../types/experiment';
import type { QecSnapshot, QecCampaignStatsRow } from '../types/qec';
import type { CircuitSnapshot } from '../types/quantum';
import type { NoiseModelDef } from '../types/noiseModel';
import { toStatsPoint } from '../types/qecStats';
import { lambdaEstimates, rowProblem, rowRate, type RateUnits } from '../lib/qecFit';
import { roundsFromMetadata } from '../lib/qecRounds';
import { lambdaSummary } from '../lib/qecLambdaText';

/**
 * PRD 10 Phase D8 — Dirac's QEC campaign context.
 *
 * A terse, research-tone block injected when a QEC campaign is the focus:
 * the campaign's source + noise model, the current stim circuit's detector
 * error model, a capped slice of campaign stats rows, and the fitted Λ. Pure
 * and testable; `useDirac` gathers the store state and calls this.
 */

/** Cap on stats rows injected — the full set can be hundreds; the model gets
 * a representative slice, and we say how many were dropped (never a silent cap). */
export const QEC_CONTEXT_ROW_CAP = 16;

export interface QecContextInput {
  campaignName: string;
  spec: QecCampaignSpec;
  noiseModel: NoiseModelDef | null;
  snapshot: QecSnapshot | null;
  circuit: CircuitSnapshot | null;
  rows: QecCampaignStatsRow[];
  running: boolean;
}

function firstSentence(text: string): string {
  const m = /^(.*?[.!?])(\s|$)/.exec(text.trim());
  return m ? m[1] : text.trim();
}

function sourceLine(spec: QecCampaignSpec): string {
  if ('generate' in spec.source) {
    const g = spec.source.generate;
    return `generate ${g.code}, distances [${g.distances.join(', ')}], rounds ${g.rounds}`;
  }
  return `entry ${spec.source.entry} (nuclei_circuits — labels emitted at runtime)`;
}

function gridLine(spec: QecCampaignSpec): string {
  const count = campaignTaskCount(spec);
  if (count === null) {
    return 'entry-source: task count known only after materialization';
  }
  return `${count} tasks (labels × noise points × decoders)`;
}

export function buildQecContext(input: QecContextInput): string {
  const { campaignName, spec, noiseModel, snapshot, circuit, rows, running } = input;
  const parts: string[] = [];

  parts.push(
    `## QEC Campaign: ${campaignName}${running ? ' (running)' : ''}\n` +
      `- Source: ${sourceLine(spec)}\n` +
      `- Noise: ${spec.noise.model}${noiseModel ? ` — ${firstSentence(noiseModel.description)}` : ''}\n` +
      `- Decoders: ${spec.decoders.join(', ')}\n` +
      `- Grid: ${gridLine(spec)}`,
  );

  // Detector error model for the current stim circuit.
  if (circuit && circuit.framework === 'stim') {
    parts.push(
      `### Current stim circuit\n- Qubits: ${circuit.qubit_count}, depth: ${circuit.depth}, gates: ${circuit.gates.length}`,
    );
  }
  if (snapshot) {
    if (snapshot.dem) {
      parts.push(
        `### Detector error model\n- Detectors: ${snapshot.num_detectors}, observables: ${snapshot.num_observables}\n` +
          `- Graph: ${snapshot.dem.edge_count} pairwise edges + ${snapshot.dem.boundary_edge_count} boundary edges`,
      );
    } else if (snapshot.dem_error) {
      parts.push(`### Detector error model\n- Unavailable: ${snapshot.dem_error}`);
    }
  }

  // Campaign stats — a capped, sorted slice.
  if (rows.length > 0) {
    const points = rows
      .map((r) => ({ pt: toStatsPoint(r), row: r }))
      .sort(
        (a, b) =>
          (a.pt.distance ?? 0) - (b.pt.distance ?? 0) ||
          (a.pt.noise ?? 0) - (b.pt.noise ?? 0) ||
          a.pt.decoder.localeCompare(b.pt.decoder),
      );
    const shown = points.slice(0, QEC_CONTEXT_ROW_CAP);
    const header = `### Campaign results (${shown.length} of ${points.length} rows)`;
    const lines = shown.map(({ pt: p, row }) => {
      const d = p.distance ?? '·';
      const noise = p.noise !== null ? p.noise.toPrecision(3) : '·';
      if (rowProblem(row) !== null) return `- ${p.label} d=${d} p=${noise} ${p.decoder}: LER unavailable (invalid or fully discarded row)`;
      const { fit, kept } = rowRate(row);
      return `- ${p.label} d=${d} p=${noise} ${p.decoder}: LER ${fit.best.toExponential(2)} (${row.errors}/${kept})`;
    });
    parts.push([header, '(LER = errors / (shots - discards), per shot)', ...lines].join('\n'));

    // Λ by log-linear regression of LER vs distance — same estimator and the same
    // default units as the panel (per round whenever rounds are known).
    const units: RateUnits = rows.some((r) => roundsFromMetadata(r.json_metadata) !== null) ? 'per_round' : 'per_shot';
    const unitText = units === 'per_round' ? 'per round' : 'per shot';
    const fits = lambdaEstimates(rows, { units });
    const lam =
      fits.length > 0
        ? fits
            .map((f) => {
              const { text, warnings } = lambdaSummary(f.estimate);
              const caveats = [
                ...warnings,
                ...(f.collidingDistances.length > 0 ? [`distinct tasks collide at d ${f.collidingDistances.join(',')}, fitted as replicates`] : []),
                ...(units === 'per_shot' && f.roundsVaryWithD ? ['rounds vary with d, confounding this per-shot Λ'] : []),
              ];
              const warn = caveats.length > 0 ? ` WARNING: ${caveats.join('; ')}` : '';
              return `${f.decoder} ${f.label} p=${f.noise}: ${text} (${unitText}); d ${f.estimate.distances.join(',')}${warn}`;
            })
            .join('\n- ')
        : 'Λ not estimated (needs >= 3 distances with logical errors at the same p within one experiment)';
    parts.push(`### Error suppression\n- ${lam}\n- Λ > 1 means adding distance suppresses errors; Λ <= 1 is above threshold, not missing data`);
  }

  return parts.join('\n\n');
}
