import type { QecCampaignSpec } from '../types/experiment';
import { campaignTaskCount } from '../types/experiment';
import type { QecSnapshot, QecCampaignStatsRow } from '../types/qec';
import type { CircuitSnapshot } from '../types/quantum';
import type { NoiseModelDef } from '../types/noiseModel';
import { toStatsPoint, lambdaFit } from '../types/qecStats';

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
      .map((r) => toStatsPoint(r))
      .sort(
        (a, b) =>
          (a.distance ?? 0) - (b.distance ?? 0) ||
          (a.noise ?? 0) - (b.noise ?? 0) ||
          a.decoder.localeCompare(b.decoder),
      );
    const shown = points.slice(0, QEC_CONTEXT_ROW_CAP);
    const header = `### Campaign results (${shown.length} of ${points.length} rows)`;
    const lines = shown.map((p) => {
      const d = p.distance ?? '·';
      const noise = p.noise !== null ? p.noise.toPrecision(3) : '·';
      const ler = p.rate.p.toExponential(2);
      return `- ${p.label} d=${d} p=${noise} ${p.decoder}: LER ${ler} (${p.errors}/${p.shots})`;
    });
    parts.push([header, ...lines].join('\n'));

    // Λ per decoder (error suppression between successive distances).
    const fits = lambdaFit(rows).filter((f) => f.lambda !== null);
    if (fits.length > 0) {
      const lam = fits.map((f) => `${f.decoder} Λ=${f.lambda!.toFixed(2)}`).join(', ');
      parts.push(`### Error suppression\n- ${lam} (>1 means adding distance suppresses errors)`);
    }
  }

  return parts.join('\n\n');
}
