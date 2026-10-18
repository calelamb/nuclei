import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_EVALUATOR } from '../../src/services/discovery/fixtures';

/**
 * PRD 14 — Discovery Engine against a stubbed kernel (WebSocket replacement).
 * The DEV-only `?labKernel=` override lets the web build open a Lab session.
 * The stub answers `discovery_evaluators`, `discovery_mutate` (AST baseline:
 * appends a comment line) and `discovery_evaluate` (fitness grows with program
 * length; every seventh program is rejected by a guardrail). With no API key in
 * the e2e browser, the hybrid mutator falls back to AST and says so.
 */
const FIXTURE_URL = '/?e2eProject=lab-project&workspace=research&labKernel=ws://127.0.0.1:9778';

async function installStubKernel(page: Page): Promise<void> {
  await page.addInitScript(
    (evaluator) => {
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
          const m = JSON.parse(serialized) as {
            type: string; run_id: string; candidate_id: string; program: string; count: number; seed: number; stage?: string;
          };
          const reply = (frame: unknown) =>
            setTimeout(() => this.emit('message', new MessageEvent('message', { data: JSON.stringify(frame) })), 0);
          if (m.type === 'discovery_evaluators') reply({ type: 'discovery_evaluators_result', evaluators: [evaluator] });
          if (m.type === 'discovery_mutate') {
            const mutations = Array.from({ length: m.count }, (_, i) => ({
              program: `${m.program}\n# mutation ${m.seed}-${i}`,
              operators: ['perturb_constant'],
              description: 'stub mutation',
            }));
            reply({ type: 'discovery_mutations', mutations });
          }
          if (m.type === 'discovery_cancel') reply({ type: 'discovery_cancelled', run_id: m.run_id, candidate_id: null, cancelled: 0 });
          if (m.type === 'discovery_audit_cancel') reply({ type: 'discovery_audit_cancelled', run_id: m.run_id, candidate_id: null, cancelled: 0 });
          if (m.type === 'discovery_audit') {
            // Red Queen stub: the audit rejects candidate c-0002 and agrees with every other score.
            const exploit = m.candidate_id === 'c-0002';
            reply({ type: 'discovery_audit_accepted', run_id: m.run_id, candidate_id: m.candidate_id, queue_position: 0 });
            reply({
              type: 'discovery_audit_result',
              run_id: m.run_id,
              candidate_id: m.candidate_id,
              audit: {
                verdict: exploit ? 'exploit' : 'consistent',
                evaluator_fitness: 1.5,
                audit_fitness: exploit ? 0.3 : 1.5,
                gap: exploit ? 1.2 : 0,
                checks: [
                  { id: 'reparse', label: 'Re-parse from scratch', status: 'pass', detail: null },
                  { id: 'determinism', label: 'Deterministic under a fresh seed', status: exploit ? 'fail' : 'pass', detail: exploit ? 'observable flipped under seed 99' : null },
                ],
                reasons: exploit ? ['determinism holds only under the evaluator seed'] : [],
                evaluator: { kind: 'state_synthesis', version: '1.2.0', fingerprint: 'ab12'.repeat(16) },
                audit_fingerprint: 'cd34'.repeat(16),
                seed: 99,
                isolation: 'sandbox-exec',
                timings_ms: { sandbox: 3, audit: 9, total: 12 },
                notes: null,
              },
            });
          }
          if (m.type === 'discovery_evaluate') {
            const n = String(m.program).split('\n').length;
            const rejected = n % 7 === 0;
            const gates = Math.max(1, 16 - (n % 12));
            reply({
              type: 'discovery_evaluation',
              run_id: m.run_id,
              candidate_id: m.candidate_id,
              evaluation: {
                candidate_id: m.candidate_id,
                run_id: m.run_id,
                status: rejected ? 'rejected' : 'scored',
                fitness: rejected ? null : n * 0.1,
                objectives: rejected
                  ? {}
                  : {
                      infidelity: { value: 0.05 / n, ci95: [0.03 / n, 0.08 / n], direction: 'minimize', label: 'Infidelity' },
                      two_qubit_gates: { value: gates, direction: 'minimize', label: 'Two-qubit gates' },
                    },
                descriptors: rejected ? {} : { two_qubit_gates: gates, depth: n % 30 },
                metrics: {},
                guardrails: [{ id: 'elementary_gates', label: 'Elementary gates only', status: rejected ? 'fail' : 'pass', detail: rejected ? 'Found a non-elementary gate' : null }],
                rejection: rejected ? { guardrail: 'elementary_gates', message: 'Found a non-elementary gate' } : null,
                failure: null,
                stdout: '',
                stderr: '',
                timings_ms: { sandbox: 5, score: 5, total: 10 },
                evaluator: { kind: 'state_synthesis', version: '1.2.0', fingerprint: 'ab12'.repeat(16) },
                seed: m.seed,
                stage: m.stage ?? 'full',
                program_key: `k-${n}-${m.program.length}`,
                cache_hit: false,
                isolation: 'sandbox-exec',
              },
            });
          }
        }
        private emit(type: string, event: Event | MessageEvent<string>): void {
          for (const listener of this.listeners.get(type) ?? []) listener(event);
        }
      }
      Object.defineProperty(window, 'WebSocket', { configurable: true, value: StubKernelSocket });
    },
    FIXTURE_EVALUATOR,
  );
}

test('@discovery runs a search, inspects the results and confirms the champion', async ({ page }) => {
  await installStubKernel(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(FIXTURE_URL);
  await page.getByRole('button', { name: 'Discovery Engine' }).click();

  const sidebar = page.getByRole('region', { name: 'Discovery Engine sidebar' });
  await sidebar.getByRole('button', { name: /w-state-synthesis/ }).click();

  const lab = page.getByRole('region', { name: 'Discovery Engine', exact: true });
  await expect(lab.getByText(/Islands × generations/)).toBeVisible();
  await lab.getByRole('button', { name: 'Start run' }).click();

  await expect(lab.getByRole('region', { name: 'Run header' })).toBeVisible();
  await expect(lab.getByRole('region', { name: 'Run header' }).getByText('Completed')).toBeVisible({ timeout: 60_000 });
  await expect(lab.getByRole('region', { name: 'Run notices' })).toContainText(/AST/);
  await expect(lab.getByRole('img', { name: 'Fitness trajectory' })).toBeVisible();

  await lab.getByRole('tab', { name: /^Lineage/ }).click();
  await expect(lab.getByRole('group', { name: 'Lineage tree' })).toBeVisible();
  await lab.getByRole('tab', { name: /^Archive/ }).click();
  await expect(lab.getByRole('status')).toContainText(/Coverage/);

  await lab.getByRole('tab', { name: /^Candidates/ }).click();
  await lab.getByRole('table', { name: 'Candidates' }).getByRole('row').nth(2).click();
  const drawer = page.getByRole('dialog', { name: /^Candidate c-/ });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  await lab.getByRole('tab', { name: /^Guardrails/ }).click();
  await expect(lab.getByTestId('exploits-found-lane')).toHaveAttribute('data-state', 'empty');
  await expect(lab.getByText('File reads are not blocked', { exact: true })).toBeVisible();

  await lab.getByRole('tab', { name: /^Overview/ }).click();
  await lab.getByRole('button', { name: /Confirm on fresh seeds/ }).click();
  await expect(lab.getByRole('region', { name: 'Confirmed on fresh seeds' })).toBeVisible({ timeout: 30_000 });
});

test('@discovery new discovery wizard offers the Frontier research instrument', async ({ page }) => {
  await installStubKernel(page);
  await page.goto(FIXTURE_URL);
  await page.getByRole('button', { name: 'Discovery Engine' }).click();
  await page.getByRole('region', { name: 'Discovery Engine sidebar' }).getByRole('button', { name: /New discovery/ }).click();

  const form = page.getByRole('form', { name: 'New discovery' });
  await expect(form.getByRole('radio')).toHaveCount(4);
  await form.getByRole('radio', { name: /Trainability frontier/ }).click();
  await expect(form.getByText(/not a proof of classical hardness/)).toBeVisible();
  await form.getByRole('textbox', { name: 'Name' }).fill('frontier e2e');
  await form.getByRole('button', { name: 'Create discovery' }).click();
  await expect(page.getByText(/Is every trainable ansatz classically simulable\?/).first()).toBeVisible();
});

/**
 * Red Queen: the stubbed Anthropic API proposes a harmless edit per call (no
 * network involved) and the stubbed kernel's audit rejects one candidate.
 */
async function installStubAnthropic(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('nuclei-dirac-api-key', 'sk-ant-e2e-stub'));
  let calls = 0;
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    calls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        usage: { input_tokens: 100, output_tokens: 20 },
        // The stub kernel's program_key includes the program length, so each call grows the comment to stay distinct.
        content: [
          {
            type: 'tool_use',
            id: `toolu_${calls}`,
            name: 'propose_program_edit',
            input: {
              rationale: 'Probe whether a trailing comment changes the evaluator score.',
              expected_effect: 'None under an honest evaluator.',
              edits: [{ search: 'qc.x(0)', replace: `qc.x(0)  # rq probe ${'x'.repeat(calls)}` }],
            },
          },
        ],
      }),
    });
  });
}

test('@discovery red queen mode surfaces an exploit and exports it as a regression fixture', async ({ page }) => {
  await installStubKernel(page);
  await installStubAnthropic(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(FIXTURE_URL);
  await page.getByRole('button', { name: 'Discovery Engine' }).click();
  await page.getByRole('region', { name: 'Discovery Engine sidebar' }).getByRole('button', { name: /New discovery/ }).click();

  const form = page.getByRole('form', { name: 'New discovery' });
  await form.getByRole('radio', { name: /W-state synthesis/ }).click();
  await form.getByRole('textbox', { name: 'Name' }).fill('rq e2e');
  const evaluations = form.getByLabel('Max evaluations');
  await evaluations.fill('10');
  await evaluations.blur();
  await form.getByRole('tab', { name: 'Red Queen (audit the evaluator)' }).click();
  await expect(form.getByText(/security testing of Nuclei/)).toBeVisible();
  await form.getByLabel('Audit when').selectOption('all');
  await form.getByRole('button', { name: 'Create discovery' }).click();

  const lab = page.getByRole('region', { name: 'Discovery Engine', exact: true });
  await expect(lab.getByText('Red Queen mode').first()).toBeVisible();
  await lab.getByRole('button', { name: 'Start run' }).click();

  const header = lab.getByRole('region', { name: 'Run header' });
  await expect(header.getByText('Red Queen', { exact: true })).toBeVisible();
  await expect(header.getByText('Completed')).toBeVisible({ timeout: 60_000 });
  await expect(lab.getByRole('group', { name: 'Run KPIs' }).getByText('Exploits')).toBeVisible();

  await lab.getByRole('tab', { name: /^Guardrails/ }).click();
  const lane = lab.getByTestId('exploits-found-lane');
  await expect(lane).toHaveAttribute('data-state', 'filled');
  const card = lane.getByRole('listitem', { name: 'Exploit c-0002' });
  await expect(card).toContainText('determinism holds only under the evaluator seed');
  await expect(card).toContainText('Deterministic under a fresh seed');
  await card.getByRole('button', { name: 'Export as regression fixture' }).click();
  await expect(card.getByText(/Wrote .*rq-.*-c-0002\.json/)).toBeVisible();

  await card.getByRole('button', { name: 'Open candidate c-0002' }).click();
  const drawer = page.getByRole('dialog', { name: 'Candidate c-0002' });
  await expect(drawer.getByRole('region', { name: 'Audit' })).toContainText('Exploit');
  await expect(drawer.getByRole('button', { name: 'Run audit' })).toBeVisible();
});
