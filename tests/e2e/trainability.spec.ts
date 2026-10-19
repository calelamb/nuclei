import { expect, test, type Page } from '@playwright/test';
import {
  inspectionFixture,
  lintDiagnosticsFixture,
  lintSummaryFixture,
  provenanceFixture,
  resultsFixture,
  scalingFailedPointFixture,
} from '../../src/services/trainability/fixtures';

/**
 * PRD 14 — Trainability Lab against a stubbed kernel (WebSocket replacement).
 * The DEV-only `?labKernel=` override lets the web
 * build open a Lab session; the stub answers every trainability message with
 * the unit-test fixtures (spec §5.6 shapes).
 */
/** Session token the stub kernel expects in the authenticate frame (DEV `labKernelToken`). */
const E2E_KERNEL_TOKEN = 'e2e-lab-kernel-token';
const FIXTURE_URL = `/?e2eProject=lab-project&workspace=research&labKernel=ws://127.0.0.1:9777&labKernelToken=${E2E_KERNEL_TOKEN}`;

async function installStubKernel(page: Page, results: unknown = resultsFixture): Promise<void> {
  await page.addInitScript(
    (fixtures) => {
      const e2eToken = fixtures.token;
      type Listener = (event: Event | MessageEvent<string>) => void;
      class StubKernelSocket {
        readyState = 0;
        private authenticated = false;
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
          // Protocol v2: the first frame must carry the session token. Anything
          // else is refused with 4401, exactly like the real kernel.
          if (!this.authenticated) {
            const first = JSON.parse(serialized) as { type?: string; token?: string };
            if (first.type === 'authenticate' && first.token === e2eToken) {
              this.authenticated = true;
              setTimeout(
                () => this.emit('message', new MessageEvent('message', { data: JSON.stringify({ type: 'authenticated' }) })),
                0,
              );
            } else {
              this.readyState = 3;
              this.emit('close', Object.assign(new Event('close'), { code: 4401 }));
            }
            return;
          }
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
            reply({ type: 'trainability_partial', job_id, analysis: 'gradients', result: (fixtures.results as { gradients: unknown }).gradients });
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
    { token: E2E_KERNEL_TOKEN, inspection: inspectionFixture, lint: lintDiagnosticsFixture, summary: lintSummaryFixture, results, provenance: provenanceFixture },
  );
}

test('@trainability runs the analyses and shows verdicts', async ({ page }) => {
  await installStubKernel(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(FIXTURE_URL);
  await page.getByRole('button', { name: 'Trainability Lab' }).click();

  const lab = page.getByRole('region', { name: 'Trainability Lab', exact: true });
  // The Lab chunk compiles on first open in the dev server; allow for a cold start under load.
  await expect(lab).toBeVisible({ timeout: 15_000 });
  await expect(lab.getByText('n = 4', { exact: true })).toBeVisible();

  await lab.getByRole('button', { name: /Run analyses/ }).click();
  await expect(lab.getByText('BP risk: high', { exact: true })).toBeVisible();
  await expect(lab.getByRole('img', { name: 'Per-parameter gradient variance' })).toBeVisible();

  await lab.getByRole('tab', { name: 'Scaling' }).click();
  await expect(lab.getByText('Barren plateau', { exact: true })).toBeVisible();
  await lab.getByRole('tab', { name: 'Lie algebra' }).click();
  await expect(lab.getByRole('meter')).toBeVisible();
  await lab.getByRole('tab', { name: 'Landscape' }).click();
  await expect(lab.getByRole('img', { name: 'Loss landscape heatmap' })).toBeVisible();
  await expect(lab.getByRole('button', { name: /Export certificate/ })).toBeEnabled();
});

async function openLab(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(FIXTURE_URL);
  await page.getByRole('button', { name: 'Trainability Lab' }).click();
  const lab = page.getByRole('region', { name: 'Trainability Lab', exact: true });
  await expect(lab).toBeVisible({ timeout: 15_000 });
  return lab;
}

test('@trainability a failed scaling point and a null preferred model do not blank the app (UI-1)', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await installStubKernel(page, { ...resultsFixture, scaling: scalingFailedPointFixture });
  const lab = await openLab(page);

  await lab.getByRole('button', { name: /Run analyses/ }).click();
  await expect(lab.getByRole('img', { name: 'Per-parameter gradient variance' })).toBeVisible();
  await lab.getByRole('tab', { name: 'Scaling' }).click();

  await expect(lab.getByRole('region', { name: 'Failed points' })).toContainText('ppe_budget_exceeded');
  await expect(lab.getByText('No scaling model is preferred for this layer count.')).toBeVisible();
  await expect(lab.getByText('This panel hit an error')).toHaveCount(0);
  // The rest of the app is still there.
  await expect(page.getByRole('button', { name: 'Trainability Lab' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('@trainability tabs follow the ARIA tabs keyboard pattern', async ({ page }) => {
  await installStubKernel(page);
  const lab = await openLab(page);

  const gradients = lab.getByRole('tab', { name: 'Gradients' });
  await gradients.focus();
  await page.keyboard.press('ArrowRight');
  await expect(lab.getByRole('tab', { name: 'Scaling' })).toHaveAttribute('aria-selected', 'true');
  await expect(lab.getByRole('tab', { name: 'Scaling' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(lab.getByRole('tab', { name: 'Landscape' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(gradients).toHaveAttribute('aria-selected', 'true');
});

test('@trainability prefills the observable from the file and lets the user override it (UI-2)', async ({ page }) => {
  await installStubKernel(page);
  const lab = await openLab(page);

  const observable = lab.getByRole('textbox', { name: 'Observable' });
  await expect(observable).toHaveValue('preset:global_z');
  await expect(lab.getByText('from file', { exact: true })).toBeVisible();
  await lab.getByRole('button', { name: 'TFIM' }).click();
  await expect(observable).toHaveValue('preset:tfim');
  await expect(lab.getByText('from file', { exact: true })).toHaveCount(0);
});

test('@trainability interactive targets meet the size rule', async ({ page }) => {
  await installStubKernel(page);
  const lab = await openLab(page);
  const heights = await lab.evaluate((root) => {
    const h = (el: Element | null) => (el ? el.getBoundingClientRect().height : 0);
    return {
      run: h(Array.from(root.querySelectorAll('button')).find((b) => /Run analyses/.test(b.textContent ?? '')) ?? null),
      tab: h(root.querySelector('[role="tab"]')),
      preset: h(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'TFIM') ?? null),
    };
  });
  expect(heights.run).toBeGreaterThanOrEqual(32);
  expect(heights.tab).toBeGreaterThanOrEqual(28);
  expect(heights.preset).toBeGreaterThanOrEqual(28);
});
