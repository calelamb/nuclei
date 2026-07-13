import type { KernelMessage, KernelResponse } from '../types/quantum';
import type { QecCampaignStatsRow, QecCampaignTask, QecGenerateNoise } from '../types/qec';
import {
  CAMPAIGN_TASK_WARN_THRESHOLD,
  resolveRounds,
  type CampaignManifest,
  type QecCampaignSpec,
} from '../types/experiment';
import {
  generatorArgsFor,
  noiseDictFor,
  resolveNoiseModel,
  type NoiseModelDef,
} from '../types/noiseModel';
import { paramValues } from '../types/experiment';
import type { RunnerDeps, RunnerKernelSession } from './experimentRunner';
import { timestampSlug, versionsFrom } from './experimentRunIo';

/**
 * PRD 10 Phase C — campaign orchestration for `type: qec_campaign`.
 *
 * Responsibilities (the kernel's campaign engine does the sampling):
 *  1. Materialize sinter tasks from the spec's `generate:` or `entry:`
 *     source — every circuit comes from `qec_generate` or the
 *     `nuclei_circuits(noise)` contract, never invented here.
 *  2. Write the campaign run directory upfront (manifest, status
 *     `running`) so a crash mid-campaign leaves an honest record.
 *  3. Stream `qec_campaign_progress` out to the caller, and on
 *     `qec_campaign_result` write sinter's native `stats.csv` byte-for-byte
 *     plus the finalized manifest.
 *
 * Resume: pass a previous run's stats.csv text via `resume` — completed
 * tasks are never re-sampled (kernel-tested); the manifest records the
 * resumed-from directory.
 */

// ---------------------------------------------------------------------------
// Message correlation (kernel is serial per connection)
// ---------------------------------------------------------------------------

function collectGenerated(
  session: RunnerKernelSession,
  message: Extract<KernelMessage, { type: 'qec_generate' }>,
): Promise<{ circuitText: string | null; error: string | null }> {
  return new Promise((resolve, reject) => {
    const unsubscribe = session.subscribe((msg: KernelResponse) => {
      if (msg.type === 'qec_generated') {
        unsubscribe();
        resolve({ circuitText: msg.circuit_text, error: null });
      } else if (msg.type === 'error') {
        unsubscribe();
        resolve({ circuitText: null, error: msg.message });
      }
    });
    Promise.resolve(session.send(message)).catch((e) => {
      unsubscribe();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

function collectMaterialized(
  session: RunnerKernelSession,
  entryCode: string,
  noise: Record<string, number>,
): Promise<{ circuits: Record<string, string> | null; error: string | null }> {
  return new Promise((resolve, reject) => {
    const unsubscribe = session.subscribe((msg: KernelResponse) => {
      if (msg.type === 'qec_circuits') {
        unsubscribe();
        resolve({ circuits: msg.circuits, error: null });
      } else if (msg.type === 'error') {
        unsubscribe();
        resolve({ circuits: null, error: msg.message });
      }
    });
    Promise.resolve(session.send({ type: 'qec_materialize', code: entryCode, noise })).catch((e) => {
      unsubscribe();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

// ---------------------------------------------------------------------------
// Task materialization
// ---------------------------------------------------------------------------

export class CampaignMaterializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignMaterializeError';
  }
}

export interface MaterializeContext {
  projectRoot: string;
  /** Models discovered from the project's noise/*.noise.yaml files. */
  projectNoiseModels?: readonly NoiseModelDef[];
}

/**
 * Expand the campaign spec into concrete sinter tasks:
 * labels × noise points × decoders, with every circuit's provenance in
 * `json_metadata` (label, p, noise model, decoder — the workbench and
 * threshold panels group by these).
 */
export async function materializeCampaignTasks(
  spec: QecCampaignSpec,
  ctx: MaterializeContext,
  deps: Pick<RunnerDeps, 'session' | 'join' | 'readEntry'>,
): Promise<QecCampaignTask[]> {
  const model = resolveNoiseModel(spec.noise.model, ctx.projectNoiseModels ?? []);
  if (!model) {
    throw new CampaignMaterializeError(
      `noise model "${spec.noise.model}" is neither a built-in nor a project noise/*.noise.yaml model`,
    );
  }
  const points = paramValues(spec.noise.p, 'noise.p');
  const tasks: QecCampaignTask[] = [];

  if ('generate' in spec.source) {
    const { code, distances, rounds } = spec.source.generate;
    for (const p of points) {
      const args: QecGenerateNoise | null = generatorArgsFor(model, p);
      if (args === null) {
        throw new CampaignMaterializeError(
          `noise model "${model.name}" cannot be expressed through stim's generator arguments — use a Python entry: source, where nuclei_circuits(noise) applies it exactly`,
        );
      }
      for (const d of distances) {
        const { circuitText, error } = await collectGenerated(deps.session, {
          type: 'qec_generate',
          code,
          distance: d,
          rounds: resolveRounds(rounds, d),
          noise: args,
        });
        if (error !== null || circuitText === null) {
          throw new CampaignMaterializeError(
            `qec_generate failed for ${code} d=${d} p=${p}: ${error ?? 'no circuit returned'}`,
          );
        }
        for (const decoder of spec.decoders) {
          tasks.push({
            circuit_text: circuitText,
            decoder,
            json_metadata: {
              label: `${code} d=${d}`,
              code,
              d,
              rounds: resolveRounds(rounds, d),
              p,
              noise_model: model.name,
              decoder,
            },
          });
        }
      }
    }
    return tasks;
  }

  const entryPath = deps.join(ctx.projectRoot, spec.source.entry);
  const entryCode = await deps.readEntry(entryPath);
  for (const p of points) {
    const { circuits, error } = await collectMaterialized(
      deps.session,
      entryCode,
      noiseDictFor(model, p),
    );
    if (error !== null || circuits === null) {
      throw new CampaignMaterializeError(
        `nuclei_circuits(noise) failed at p=${p}: ${error ?? 'no circuits returned'}`,
      );
    }
    for (const [label, circuitText] of Object.entries(circuits)) {
      for (const decoder of spec.decoders) {
        tasks.push({
          circuit_text: circuitText,
          decoder,
          json_metadata: { label, p, noise_model: model.name, decoder },
        });
      }
    }
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// Campaign run
// ---------------------------------------------------------------------------

export interface CampaignProgressEvent {
  tasksComplete: number;
  tasksTotal: number;
  changedRows: QecCampaignStatsRow[];
  statusMessage: string;
}

export interface RunCampaignOptions {
  /** Cooperative cancel — polled once a second; triggers qec_campaign_cancel. */
  signal?: { readonly aborted: boolean };
  onProgress?: (progress: CampaignProgressEvent) => void;
  /** Called when the grid exceeds CAMPAIGN_TASK_WARN_THRESHOLD (PRD 10 D3:
   * warn, don't cap). Return false to abort before anything runs. */
  confirmLargeCampaign?: (taskCount: number) => Promise<boolean>;
  /** Previous run's stats.csv text + directory name — resume support. */
  resume?: { statsCsv: string; fromDir: string };
}

export interface CampaignRunSummary {
  campaignId: string;
  runDir: string | null;
  tasksTotal: number;
  status: 'complete' | 'failed' | 'cancelled-before-start';
  partial: boolean;
  sampledShots: number;
  error: string | null;
}

export interface CampaignRunContext extends MaterializeContext {
  /** Experiment yaml filename (locates the runs directory). */
  experimentFileName: string;
  /** Raw yaml text — hashed for generate-source manifests. */
  experimentYamlText: string;
}

function runsDirFor(deps: RunnerDeps, ctx: CampaignRunContext): string {
  const base = ctx.experimentFileName
    .replace(/^.*[\\/]/, '')
    .replace(/\.experiment\.yaml$/i, '')
    .replace(/\.ya?ml$/i, '');
  return deps.join(ctx.projectRoot, 'experiments', base, 'runs');
}

export async function runQecCampaign(
  spec: QecCampaignSpec,
  ctx: CampaignRunContext,
  deps: RunnerDeps,
  opts: RunCampaignOptions = {},
): Promise<CampaignRunSummary> {
  const tasks = await materializeCampaignTasks(spec, ctx, deps);

  if (tasks.length > CAMPAIGN_TASK_WARN_THRESHOLD && opts.confirmLargeCampaign) {
    const proceed = await opts.confirmLargeCampaign(tasks.length);
    if (!proceed) {
      return {
        campaignId: '',
        runDir: null,
        tasksTotal: tasks.length,
        status: 'cancelled-before-start',
        partial: false,
        sampledShots: 0,
        error: null,
      };
    }
  }

  const startedAt = deps.clock.now();
  const startMs = startedAt.getTime();

  // Manifest provenance: the entry file's code for entry sources, the yaml
  // itself for generate sources (that text fully determines the circuits).
  const provenance =
    'entry' in spec.source
      ? await deps.readEntry(deps.join(ctx.projectRoot, spec.source.entry))
      : ctx.experimentYamlText;
  const codeSha = await deps.hash(provenance);
  const git = await deps.gitInfo(ctx.projectRoot);
  const env = await deps.environment();
  const points = paramValues(spec.noise.p, 'noise.p');

  const manifest: CampaignManifest = {
    schema: 1,
    type: 'qec_campaign',
    experiment: spec.name,
    source: spec.source,
    noise_model: spec.noise.model,
    noise_points: points,
    decoders: spec.decoders,
    tasks_total: tasks.length,
    collect: spec.collect,
    workers: spec.workers,
    code_sha256: codeSha,
    git,
    versions: versionsFrom(env, deps.appVersion),
    started_at: startedAt.toISOString(),
    duration_ms: 0,
    status: 'running',
    partial: false,
    sampled_shots: 0,
    resumed_from: opts.resume?.fromDir ?? null,
    error: null,
  };

  // Run directory upfront (PRD 10 D4): a crash mid-campaign must leave an
  // honest `running` manifest that relaunch marks stale/resumable.
  const manifestJson = JSON.stringify(manifest, null, 2);
  const dirHash = (await deps.hash(manifestJson)).slice(0, 4);
  const campaignId = `${timestampSlug(startedAt)}-${dirHash}`;
  const runsDir = runsDirFor(deps, ctx);
  const runDir = deps.join(runsDir, campaignId);
  await deps.fs.mkdir(runDir, { recursive: true });
  await deps.fs.writeFile(deps.join(runDir, 'manifest.json'), manifestJson);

  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return new Promise<CampaignRunSummary>((resolve, reject) => {
    let settled = false;
    let cancelSent = false;

    const finish = async (result: {
      partial: boolean;
      sampled_shots: number;
      csv: string;
      error?: string;
    }) => {
      const finalManifest: CampaignManifest = {
        ...manifest,
        duration_ms: Math.max(0, deps.clock.now().getTime() - startMs),
        status: result.error !== undefined ? 'failed' : 'complete',
        partial: result.partial,
        sampled_shots: result.sampled_shots,
        error: result.error ?? null,
      };
      await deps.fs.writeFile(deps.join(runDir, 'stats.csv'), result.csv);
      await deps.fs.writeFile(
        deps.join(runDir, 'manifest.json'),
        JSON.stringify(finalManifest, null, 2),
      );
      resolve({
        campaignId,
        runDir: campaignId,
        tasksTotal: tasks.length,
        status: finalManifest.status === 'complete' ? 'complete' : 'failed',
        partial: result.partial,
        sampledShots: result.sampled_shots,
        error: result.error ?? null,
      });
    };

    const unsubscribe = deps.session.subscribe((msg: KernelResponse) => {
      if (settled) return;
      if (msg.type === 'qec_campaign_progress' && msg.campaign_id === campaignId) {
        opts.onProgress?.({
          tasksComplete: msg.tasks_complete,
          tasksTotal: msg.tasks_total,
          changedRows: msg.tasks,
          statusMessage: msg.status_message,
        });
      } else if (msg.type === 'qec_campaign_result' && msg.campaign_id === campaignId) {
        settled = true;
        unsubscribe();
        finish({
          partial: msg.partial,
          sampled_shots: msg.sampled_shots,
          csv: msg.csv,
          error: msg.error,
        }).catch(reject);
      } else if (msg.type === 'error') {
        // Start rejected (already running / invalid / missing dependency).
        settled = true;
        unsubscribe();
        finish({ partial: false, sampled_shots: 0, csv: '', error: msg.message }).catch(reject);
      }
    });

    const watchCancel = async () => {
      while (!settled) {
        if (opts.signal?.aborted && !cancelSent) {
          cancelSent = true;
          await deps.session.send({ type: 'qec_campaign_cancel', campaign_id: campaignId });
        }
        await wait(1000);
      }
    };

    Promise.resolve(
      deps.session.send({
        type: 'qec_campaign_start',
        campaign_id: campaignId,
        tasks,
        collect: spec.collect,
        workers: spec.workers,
        existing_stats_csv: opts.resume?.statsCsv,
      }),
    )
      .then(() => {
        void watchCancel();
      })
      .catch((e) => {
        settled = true;
        unsubscribe();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}
