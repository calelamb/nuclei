import { describe, it, expect, vi } from 'vitest';
import type { KernelMessage, KernelResponse } from '../types/quantum';
import { parseExperimentYaml, type QecCampaignSpec } from '../types/experiment';
import {
  CampaignMaterializeError,
  materializeCampaignTasks,
  runQecCampaign,
  type CampaignRunContext,
} from './qecCampaignRunner';
import type { RunnerDeps } from './experimentRunner';

/**
 * Mock kernel session: scripted responses per request type, delivered
 * asynchronously like the real WebSocket wrapper.
 */
class MockSession {
  handlers = new Set<(msg: KernelResponse) => void>();
  sent: KernelMessage[] = [];
  script: (msg: KernelMessage) => KernelResponse[] = () => [];

  send(message: KernelMessage): Promise<void> {
    this.sent.push(message);
    const responses = this.script(message);
    queueMicrotask(() => {
      for (const r of responses) this.emit(r);
    });
    return Promise.resolve();
  }

  subscribe(handler: (msg: KernelResponse) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(msg: KernelResponse): void {
    for (const h of [...this.handlers]) h(msg);
  }
}

const CAMPAIGN_YAML = `
schema: 2
type: qec_campaign
name: rep-memory
source:
  generate:
    code: repetition_code:memory
    distances: [3, 5]
    rounds: 3d
noise:
  model: uniform_depolarizing
  p: { values: [0.001, 0.002] }
decoders: [pymatching]
collect:
  max_shots: 1000
workers: auto
`;

function campaignSpec(yaml = CAMPAIGN_YAML): QecCampaignSpec {
  const parsed = parseExperimentYaml(yaml, 'rep-memory.experiment.yaml');
  if (!parsed.ok || parsed.spec.type !== 'qec_campaign') throw new Error('fixture yaml invalid');
  return parsed.spec;
}

function makeDeps(session: MockSession) {
  const files = new Map<string, string>();
  const deps: RunnerDeps = {
    session,
    fs: {
      mkdir: vi.fn(async () => {}),
      writeFile: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
    },
    clock: { now: () => new Date('2026-07-12T10:00:00.000Z') },
    join: (...parts: string[]) => parts.join('/'),
    hash: async (text: string) => {
      // Tiny deterministic "hash" for tests.
      let h = 0;
      for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
      return h.toString(16).padStart(8, '0');
    },
    gitInfo: async () => ({ commit: 'abc', dirty: false }),
    environment: async () => ({
      python: '3.12.0',
      platform: 'test',
      packages: { stim: '1.16.0', sinter: '1.16.0', pymatching: '2.4.0' } as never,
    }),
    readEntry: async () => 'def nuclei_circuits(noise):\n    ...\n',
    appVersion: '0.7.0-test',
    wait: async () => {},
  };
  return { deps, files };
}

const CTX: CampaignRunContext = {
  projectRoot: '/proj',
  experimentFileName: 'rep-memory.experiment.yaml',
  experimentYamlText: CAMPAIGN_YAML,
};

describe('materializeCampaignTasks', () => {
  it('generate source: labels x noise points x decoders, rounds resolved per distance', async () => {
    const session = new MockSession();
    session.script = (msg) =>
      msg.type === 'qec_generate'
        ? [{
            type: 'qec_generated',
            code: msg.code,
            distance: msg.distance,
            rounds: msg.rounds,
            circuit_text: `# circuit d=${msg.distance} rounds=${msg.rounds}`,
          }]
        : [];

    const tasks = await materializeCampaignTasks(campaignSpec(), CTX, {
      session,
      join: (...p) => p.join('/'),
      readEntry: async () => '',
    });

    // 2 distances x 2 points x 1 decoder.
    expect(tasks).toHaveLength(4);
    const generates = session.sent.filter((m) => m.type === 'qec_generate');
    expect(generates.map((g) => [g.distance, g.rounds])).toEqual([
      [3, 9], [5, 15], [3, 9], [5, 15],
    ]);
    // Noise arguments came from the model at each grid point's p.
    expect(generates[0].noise).toEqual({
      after_clifford_depolarization: 0.001,
      before_round_data_depolarization: 0.001,
      before_measure_flip_probability: 0.001,
      after_reset_flip_probability: 0.001,
    });
    expect(tasks[0].json_metadata).toEqual({
      label: 'repetition_code:memory d=3',
      code: 'repetition_code:memory',
      d: 3,
      rounds: 9,
      p: 0.001,
      noise_model: 'uniform_depolarizing',
      decoder: 'pymatching',
    });
  });

  it('entry source: circuits come from nuclei_circuits, labeled per point and decoder', async () => {
    const session = new MockSession();
    session.script = (msg) =>
      msg.type === 'qec_materialize'
        ? [{
            type: 'qec_circuits',
            circuits: { alpha: `# alpha p=${(msg.noise as Record<string, number>).p}`, beta: '# beta' },
          }]
        : [];

    const yaml = CAMPAIGN_YAML.replace(
      /source:[\s\S]*?rounds: 3d\n/,
      'source:\n  entry: make_circuits.py\n',
    );
    const tasks = await materializeCampaignTasks(campaignSpec(yaml), CTX, {
      session,
      join: (...p) => p.join('/'),
      readEntry: async (path) => {
        expect(path).toBe('/proj/make_circuits.py');
        return 'entry code';
      },
    });

    // 2 labels x 2 points x 1 decoder.
    expect(tasks).toHaveLength(4);
    expect(tasks.map((t) => (t.json_metadata as { label: string }).label)).toEqual([
      'alpha', 'beta', 'alpha', 'beta',
    ]);
    expect(tasks[0].circuit_text).toBe('# alpha p=0.001');
  });

  it('entry-only noise model with a generate source is a clear error', async () => {
    const session = new MockSession();
    const yaml = CAMPAIGN_YAML.replace('model: uniform_depolarizing', 'model: biased_z');
    await expect(
      materializeCampaignTasks(campaignSpec(yaml), CTX, {
        session,
        join: (...p) => p.join('/'),
        readEntry: async () => '',
      }),
    ).rejects.toThrow(/cannot be expressed through stim's generator arguments/);
  });

  it('unknown noise model names the failure', async () => {
    const session = new MockSession();
    const yaml = CAMPAIGN_YAML.replace('model: uniform_depolarizing', 'model: mystery');
    await expect(
      materializeCampaignTasks(campaignSpec(yaml), CTX, {
        session,
        join: (...p) => p.join('/'),
        readEntry: async () => '',
      }),
    ).rejects.toThrow(CampaignMaterializeError);
  });
});

describe('runQecCampaign', () => {
  function scriptedSession(resultExtras: Partial<Extract<KernelResponse, { type: 'qec_campaign_result' }>> = {}) {
    const session = new MockSession();
    session.script = (msg) => {
      if (msg.type === 'qec_generate') {
        return [{
          type: 'qec_generated',
          code: msg.code,
          distance: msg.distance,
          rounds: msg.rounds,
          circuit_text: `# d=${msg.distance}`,
        }];
      }
      if (msg.type === 'qec_campaign_start') {
        return [
          { type: 'qec_campaign_started', campaign_id: msg.campaign_id, tasks_total: msg.tasks.length, workers: 2 },
          {
            type: 'qec_campaign_progress',
            campaign_id: msg.campaign_id,
            tasks: [],
            tasks_complete: 1,
            tasks_total: msg.tasks.length,
            status_message: 'working',
          },
          {
            type: 'qec_campaign_result',
            campaign_id: msg.campaign_id,
            partial: false,
            sampled_shots: 4000,
            stats: [],
            csv: 'shots,errors\n1000,3\n',
            ...resultExtras,
          },
        ];
      }
      return [];
    };
    return session;
  }

  it('writes the run dir upfront, streams progress, finalizes manifest + sinter-native stats.csv', async () => {
    const session = scriptedSession();
    const { deps, files } = makeDeps(session);
    const progress: number[] = [];

    const summary = await runQecCampaign(campaignSpec(), CTX, deps, {
      onProgress: (p) => progress.push(p.tasksComplete),
    });

    expect(summary.status).toBe('complete');
    expect(summary.sampledShots).toBe(4000);
    expect(summary.tasksTotal).toBe(4);
    expect(progress).toEqual([1]);

    const paths = [...files.keys()];
    const manifestPath = paths.find((p) => p.endsWith('manifest.json'))!;
    const statsPath = paths.find((p) => p.endsWith('stats.csv'))!;
    expect(manifestPath).toContain('/proj/experiments/rep-memory/runs/20260712-100000-');
    // stats.csv is the kernel's csv byte-for-byte.
    expect(files.get(statsPath)).toBe('shots,errors\n1000,3\n');

    const manifest = JSON.parse(files.get(manifestPath)!);
    // PRD-09-convention completeness: reproducibility fields all present.
    expect(manifest).toMatchObject({
      schema: 1,
      type: 'qec_campaign',
      experiment: 'rep-memory',
      noise_model: 'uniform_depolarizing',
      noise_points: [0.001, 0.002],
      decoders: ['pymatching'],
      tasks_total: 4,
      collect: { max_shots: 1000 },
      workers: 'auto',
      git: { commit: 'abc', dirty: false },
      status: 'complete',
      partial: false,
      sampled_shots: 4000,
      resumed_from: null,
      error: null,
    });
    expect(manifest.code_sha256).toBeTruthy();
    expect(manifest.versions).toMatchObject({ nuclei: '0.7.0-test', stim: '1.16.0', sinter: '1.16.0' });
    expect(manifest.started_at).toBe('2026-07-12T10:00:00.000Z');
  });

  it('passes resume csv through and records resumed_from', async () => {
    const session = scriptedSession({ sampled_shots: 0 });
    const { deps, files } = makeDeps(session);

    const summary = await runQecCampaign(campaignSpec(), CTX, deps, {
      resume: { statsCsv: 'shots,errors\n1000,3\n', fromDir: '20260711-090000-aaaa' },
    });

    expect(summary.sampledShots).toBe(0);
    const start = session.sent.find((m) => m.type === 'qec_campaign_start')!;
    expect(start.existing_stats_csv).toBe('shots,errors\n1000,3\n');
    const manifestPath = [...files.keys()].find((p) => p.endsWith('manifest.json'))!;
    expect(JSON.parse(files.get(manifestPath)!).resumed_from).toBe('20260711-090000-aaaa');
  });

  it('a kernel error (already running / invalid) finalizes as failed with the message', async () => {
    const session = new MockSession();
    session.script = (msg) => {
      if (msg.type === 'qec_generate') {
        return [{ type: 'qec_generated', code: msg.code, distance: msg.distance, rounds: msg.rounds, circuit_text: '#' }];
      }
      if (msg.type === 'qec_campaign_start') {
        return [{ type: 'error', message: 'Campaign X is already running', code: 'campaign_already_running' }];
      }
      return [];
    };
    const { deps, files } = makeDeps(session);

    const summary = await runQecCampaign(campaignSpec(), CTX, deps, {});

    expect(summary.status).toBe('failed');
    expect(summary.error).toMatch(/already running/);
    const manifestPath = [...files.keys()].find((p) => p.endsWith('manifest.json'))!;
    expect(JSON.parse(files.get(manifestPath)!).status).toBe('failed');
  });

  it('confirmLargeCampaign gates grids above the warn threshold', async () => {
    const session = scriptedSession();
    const { deps } = makeDeps(session);
    // 2001 tasks: inflate decoders to cross the 2,000 threshold.
    const yaml = CAMPAIGN_YAML
      .replace('distances: [3, 5]', `distances: [${Array.from({ length: 251 }, (_, i) => 3 + 2 * i).join(', ')}]`)
      .replace('p: { values: [0.001, 0.002] }', 'p: { values: [0.001, 0.002, 0.003, 0.004] }')
      .replace('decoders: [pymatching]', 'decoders: [pymatching, fusion_blossom]');
    const confirm = vi.fn(async () => false);

    const summary = await runQecCampaign(campaignSpec(yaml), CTX, deps, {
      confirmLargeCampaign: confirm,
    });

    expect(confirm).toHaveBeenCalledWith(251 * 4 * 2);
    expect(summary.status).toBe('cancelled-before-start');
    // Declined before anything ran: no campaign start was sent.
    expect(session.sent.some((m) => m.type === 'qec_campaign_start')).toBe(false);
  });
});
