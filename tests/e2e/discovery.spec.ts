import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_EVALUATOR } from '../../src/services/discovery/fixtures';
import {
  FIXTURE_SCHEMA_REPLY,
  fixtureConjecture,
  fixtureEvidenceItem,
  fixtureResult,
} from '../../src/services/conjecture/fixtures';
import type { DiscoveryEvaluatorInfo } from '../../src/types/discovery';

/**
 * PRD 14 — Discovery Engine against a stubbed kernel (WebSocket replacement).
 * The DEV-only `?labKernel=` override lets the web build open a Lab session.
 * The stub answers `discovery_evaluators`, `discovery_mutate` (AST baseline:
 * appends a comment line) and `discovery_evaluate` (fitness grows with program
 * length; every seventh program is rejected by a guardrail). With no API key in
 * the e2e browser, the hybrid mutator falls back to AST and says so.
 */
const FIXTURE_URL = '/?e2eProject=lab-project&workspace=research&labKernel=ws://127.0.0.1:9778';

/** Catalogue entry for the Frontier evaluator (descriptor keys match the kernel). */
const FRONTIER_EVALUATOR: DiscoveryEvaluatorInfo = {
  kind: 'trainability_frontier',
  version: '1.0.0',
  title: 'Trainability frontier',
  description: 'Gradient-variance scaling against resistance to Pauli propagation.',
  task: 'quantum_circuit',
  entry_signature: 'build(n_qubits: int, n_layers: int) -> QuantumCircuit',
  objectives: [
    { key: 'beta', label: 'beta', direction: 'minimize' },
    { key: 'estimation_hardness', label: 'Estimation hardness', direction: 'maximize' },
  ],
  descriptors: [
    { key: 'log2_dla_dimension', label: 'log2 DLA dimension', min: 0, max: 16, default_bins: 8 },
    { key: 'two_qubit_gates_per_layer', label: 'Two-qubit gates per layer', min: 0, max: 64, default_bins: 8 },
  ],
  config_schema: {},
  default_config: {},
};

async function installStubKernel(page: Page): Promise<void> {
  await page.addInitScript(
    ({ evaluator, frontier, conjectureSchema, conjectureEvidence, conjectureResult }) => {
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
            job_id?: string; evaluator?: { kind: string };
          };
          const reply = (frame: unknown) =>
            setTimeout(() => this.emit('message', new MessageEvent('message', { data: JSON.stringify(frame) })), 0);
          if (m.type === 'discovery_evaluators') reply({ type: 'discovery_evaluators_result', evaluators: [evaluator, frontier] });
          if (m.type === 'discovery_conjecture_schema') reply(conjectureSchema);
          if (m.type === 'discovery_conjecture_test') {
            // Held-out test stub: one evidence row per circuit, then a supported verdict.
            const job_id = m.job_id;
            reply({ type: 'discovery_conjecture_started', job_id });
            conjectureEvidence.forEach((item, i) => {
              reply({ type: 'discovery_conjecture_progress', job_id, fraction: (i + 1) / conjectureEvidence.length, message: `circuit ${i + 1}`, circuit_index: i });
              reply({ type: 'discovery_conjecture_evidence', job_id, item });
            });
            reply({ type: 'discovery_conjecture_result', job_id, status: 'complete', result: conjectureResult });
          }
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
          if (m.type === 'discovery_evaluate' && m.evaluator?.kind === 'trainability_frontier') {
            // Frontier stub: every candidate scores, spread over distinct archive cells with structural features.
            const idx = Number(m.candidate_id.replace(/\D/g, ''));
            const beta = 0.05 + (idx % 6) * 0.07;
            reply({
              type: 'discovery_evaluation',
              run_id: m.run_id,
              candidate_id: m.candidate_id,
              evaluation: {
                candidate_id: m.candidate_id, run_id: m.run_id, status: 'scored', fitness: 1 + idx * 0.1,
                objectives: {
                  beta: { value: beta, ci95: [beta - 0.02, beta + 0.03], direction: 'minimize', label: 'beta' },
                  estimation_hardness: { value: 3 + (idx % 3), direction: 'maximize', label: 'Estimation hardness' },
                },
                descriptors: { log2_dla_dimension: (idx * 3) % 16, two_qubit_gates_per_layer: (idx * 7) % 64 },
                metrics: {
                  features: {
                    n_qubits: 16, n_params: 32 + idx, parametric_gates: 32 + idx, params_per_qubit: 2, two_qubit_gates: 30,
                    two_qubit_depth: 2, rotation_axes: idx % 2 ? 'YZ' : 'XY', rotation_axis_counts: { X: 0, Y: 16, Z: 16 },
                    entangler: 'cz', entangler_pattern: ['brick', 'ladder', 'ring'][idx % 3], distinct_bonds: 15,
                    connectivity_fraction: 0.12, n_layers: 2 + (idx % 5), two_qubit_gates_per_layer: 15,
                  },
                },
                guardrails: [], rejection: null, failure: null, stdout: '', stderr: '',
                timings_ms: { sandbox: 5, score: 5, total: 10 },
                evaluator: { kind: 'trainability_frontier', version: '1.0.0', fingerprint: 'ef56'.repeat(16) },
                seed: m.seed, stage: m.stage ?? 'full', program_key: `f-${idx}-${m.program.length}`, cache_hit: false, isolation: 'sandbox-exec',
              },
            });
          }
          if (m.type === 'discovery_evaluate' && m.evaluator?.kind !== 'trainability_frontier') {
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
    {
      evaluator: FIXTURE_EVALUATOR,
      frontier: FRONTIER_EVALUATOR,
      conjectureSchema: FIXTURE_SCHEMA_REPLY,
      conjectureEvidence: Array.from({ length: 8 }, (_, i) => fixtureEvidenceItem(i, 'meets')),
      conjectureResult: fixtureResult('supported'),
    },
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

/** The stubbed Anthropic API proposes one valid conjecture (the Opus proposer, forced tool). */
async function installStubConjectureProposer(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('nuclei-dirac-api-key', 'sk-ant-e2e-stub'));
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'claude-opus-5-5',
        usage: { input_tokens: 400, output_tokens: 120 },
        content: [{ type: 'tool_use', id: 'toolu_cj', name: 'propose_conjectures', input: { conjectures: [fixtureConjecture()] } }],
      }),
    });
  });
}

test('@discovery conjecture engine proposes, tests on held-out circuits and writes a ledger', async ({ page }) => {
  await installStubKernel(page);
  await installStubConjectureProposer(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(FIXTURE_URL);
  await page.getByRole('button', { name: 'Discovery Engine' }).click();
  await page.getByRole('region', { name: 'Discovery Engine sidebar' }).getByRole('button', { name: /New discovery/ }).click();

  const form = page.getByRole('form', { name: 'New discovery' });
  await form.getByRole('radio', { name: /Trainability frontier/ }).click();
  await form.getByRole('textbox', { name: 'Name' }).fill('cj e2e');
  const evaluations = form.getByLabel('Max evaluations');
  await evaluations.fill('24');
  await evaluations.blur();
  await form.getByRole('tab', { name: 'AST only (no API key)' }).click();
  await form.getByRole('button', { name: 'Create discovery' }).click();

  const lab = page.getByRole('region', { name: 'Discovery Engine', exact: true });
  await lab.getByRole('button', { name: 'Start run' }).click();
  await expect(lab.getByRole('region', { name: 'Run header' }).getByText('Completed')).toBeVisible({ timeout: 60_000 });

  await lab.getByRole('tab', { name: /^Conjectures/ }).click();
  const tab = lab.getByRole('region', { name: 'Conjectures', exact: true });
  await tab.getByRole('button', { name: 'Propose conjectures' }).click();

  const card = tab.getByRole('group', { name: /^Conjecture cj-/ }).or(tab.getByLabel(/^Conjecture cj-/)).first();
  await expect(card).toContainText('Brick-pattern CZ circuits');
  await card.getByRole('button', { name: 'Accept' }).click();
  await card.getByRole('button', { name: 'Test', exact: true }).click();

  const verdict = card.getByRole('region', { name: 'Verdict: supported' });
  await expect(verdict).toBeVisible({ timeout: 30_000 });
  await expect(verdict).toContainText(/8 held-out circuits/);
  await expect(verdict).not.toContainText(/proven/i);
  await expect(tab.getByRole('button', { name: 'Test again' })).toBeVisible();

  // The result lands in the run's ledger (conjectures.json / .md), refuted or not.
  const ledger = tab.getByRole('table', { name: 'Conjecture ledger' });
  await expect(ledger).toContainText('Brick-pattern CZ circuits');
  await expect(tab.getByRole('button', { name: 'Open ledger (.md)' })).toBeEnabled();
});
