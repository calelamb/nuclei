import { expect, test, type Page } from '@playwright/test';
import {
  inspectionFixture,
  lintDiagnosticsFixture,
  lintSummaryFixture,
  provenanceFixture,
  resultsFixture,
} from '../../src/services/trainability/fixtures';

/**
 * PRD 14 — Trainability Lab against a stubbed kernel (WebSocket replacement).
 * DRAFT: not yet run in CI. The DEV-only `?labKernel=` override lets the web
 * build open a Lab session; the stub answers every trainability message with
 * the unit-test fixtures (spec §5.6 shapes).
 */
const FIXTURE_URL = '/?e2eProject=lab-project&workspace=research&labKernel=ws://127.0.0.1:9777';

async function installStubKernel(page: Page): Promise<void> {
  await page.addInitScript(
    (fixtures) => {
      type Listener = (event: Event | MessageEvent<string>) => void;
      class StubKernelSocket {
        readyState = 0;
        private readonly listeners = new Map<string, Listener[]>();
        constructor() {
          queueMicrotask(() => {
            this.readyState = 1;
            this.emit('open', new Event('open'));
          });
        }
        addEventListener(type: string, listener: Listener): void {
          this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
        }
        removeEventListener(): void {}
        close(): void {
          this.readyState = 3;
          this.emit('close', new Event('close'));
        }
        send(serialized: string): void {
          const message = JSON.parse(serialized) as { type: string; job_id?: string };
          const reply = (frame: unknown) =>
            setTimeout(() => this.emit('message', new MessageEvent('message', { data: JSON.stringify(frame) })), 0);
          if (message.type === 'trainability_inspect') reply({ type: 'trainability_inspected', ...fixtures.inspection });
          if (message.type === 'trainability_lint') {
            reply({ type: 'trainability_lint_result', diagnostics: fixtures.lint, summary: fixtures.summary });
          }
          if (message.type === 'trainability_start') {
            const job_id = message.job_id;
            reply({ type: 'trainability_started', job_id });
            reply({ type: 'trainability_progress', job_id, analysis: 'gradients', fraction: 0.5, message: 'sampling' });
            reply({ type: 'trainability_partial', job_id, analysis: 'gradients', result: fixtures.results.gradients });
            reply({
              type: 'trainability_result',
              job_id,
              status: 'complete',
              results: fixtures.results,
              errors: {},
              elapsed_ms: 1200,
              provenance: fixtures.provenance,
            });
          }
        }
        private emit(type: string, event: Event | MessageEvent<string>): void {
          for (const listener of this.listeners.get(type) ?? []) listener(event);
        }
      }
      Object.defineProperty(window, 'WebSocket', { configurable: true, value: StubKernelSocket });
    },
    { inspection: inspectionFixture, lint: lintDiagnosticsFixture, summary: lintSummaryFixture, results: resultsFixture, provenance: provenanceFixture },
  );
}

test('@trainability runs the analyses and shows verdicts', async ({ page }) => {
  await installStubKernel(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(FIXTURE_URL);
  await page.getByRole('button', { name: 'Trainability Lab' }).click();

  const lab = page.getByRole('region', { name: 'Trainability Lab', exact: true });
  await expect(lab).toBeVisible();
  await expect(lab.getByText('n = 4')).toBeVisible();

  await lab.getByRole('button', { name: /Run analyses/ }).click();
  await expect(lab.getByText('BP risk: high')).toBeVisible();
  await expect(lab.getByRole('img', { name: 'Per-parameter gradient variance' })).toBeVisible();

  await lab.getByRole('tab', { name: 'Scaling' }).click();
  await expect(lab.getByText('Barren plateau')).toBeVisible();
  await lab.getByRole('tab', { name: 'Lie algebra' }).click();
  await expect(lab.getByRole('meter')).toBeVisible();
  await lab.getByRole('tab', { name: 'Landscape' }).click();
  await expect(lab.getByRole('img', { name: 'Loss landscape heatmap' })).toBeVisible();
  await expect(lab.getByRole('button', { name: /Export certificate/ })).toBeEnabled();
});
