import type { Page } from '@playwright/test';

/**
 * Seeds three completed theta-sweep runs into the experiment stores and answers
 * the plugin-fs `result.json` reads with measurements, so the Compare view can
 * draw its chart in the browser fixture (there is no Tauri backend here).
 */
export async function seedCompareRuns(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const store = await import('/src/services/experimentStore.ts');
    const ui = await import('/src/stores/experimentUiStore.ts');
    const fileName = 'theta-sweep.experiment.yaml';
    const spec = {
      schema: 1, name: 'theta-sweep', entry: 'run.py', language: 'python',
      backend: { provider: 'simulator', target: 'statevector' }, shots: 2048, seed: 42,
      sweep: { theta: { values: [0, 0.4, 0.8] } },
    };
    const runs = [0, 1, 2].map((i) => ({
      dir: `20261015-14211${i}-a45${i}`,
      manifest: {
        schema: 1, experiment: 'theta-sweep', point_index: i, params: { theta: i * 0.4 }, seed: 42, seed_honored: true,
        backend: { provider: 'simulator', target: 'statevector' }, shots: 2048, language: 'python', entry: 'run.py',
        code_sha256: 'deadbeefcafebabe'.repeat(4), git: null, versions: { nuclei: '0.6.0' },
        started_at: `2026-10-15T14:21:1${i}Z`, duration_ms: 400 + i * 13, status: 'complete', error: null,
      },
      metrics: { energy: -1.1 + i * 0.01 },
    }));
    store.useExperimentStore.setState({
      reload: async () => {}, scanRuns: async () => {}, startWatching: async () => {}, stopWatching: () => {},
      experiments: [{ fileName, path: `x/experiments/${fileName}`, spec }],
      validationErrors: [],
      runsByExperiment: { [fileName]: runs },
    } as never);
    ui.useExperimentUiStore.setState({ selectedExperimentFileName: fileName } as never);
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer;
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd: string, args: { path: string }) => {
        if (cmd === 'plugin:fs|read_text_file' && args.path.endsWith('result.json')) {
          const k = Number(args.path.match(/a45(\d)/)?.[1] ?? 0);
          return encode({ measurements: { '00': 900 - k * 80, '01': 40, '10': 30, '11': 1078 + k * 80 } });
        }
        throw new Error(`mock invoke: ${cmd}`);
      },
    };
  });
}
