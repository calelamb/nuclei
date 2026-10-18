/**
 * The conjecture ledger (addendum §G.4):
 *
 *   experiments/<name>/discovery/<runId>/conjectures.json
 *   experiments/<name>/discovery/<runId>/conjectures.md
 *
 * Refuted and inconclusive conjectures are kept: a negative result is a
 * result. I/O goes through the injected `DiscoveryFs` (same pattern as
 * `services/discovery/platformFs.ts`). Updates are immutable.
 */

import type { Counterexample, EvidenceRow, LedgerEntry, LedgerFile } from '../../types/conjecture';
import { normalizeEvidence } from './evidence';
import { runPaths, toJson, type DiscoveryFs, type JoinFn } from '../discovery/records';

export interface LedgerPaths {
  dir: string;
  json: string;
  md: string;
}

export function ledgerPaths(join: JoinFn, projectRoot: string, definitionFile: string, runId: string): LedgerPaths {
  const dir = runPaths(join, projectRoot, definitionFile, runId).runDir;
  return { dir, json: join(dir, 'conjectures.json'), md: join(dir, 'conjectures.md') };
}

export const emptyLedger = (runId: string, now: string): LedgerFile => ({ schema: 1, run_id: runId, updated_at: now, entries: [] });

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function validEntry(e: unknown): e is LedgerEntry {
  return isObject(e) && typeof e.id === 'string' && isObject(e.conjecture) && (e.outcome === 'complete' || e.outcome === 'failed');
}

/** Insert or replace by id, newest first. */
export function upsertEntry(ledger: LedgerFile, entry: LedgerEntry, now: string): LedgerFile {
  const rest = ledger.entries.filter((e) => e.id !== entry.id);
  return { ...ledger, updated_at: now, entries: [entry, ...rest].sort((a, b) => b.tested_at.localeCompare(a.tested_at)) };
}

export type LoadLedgerResult = { ok: true; ledger: LedgerFile; existed: boolean } | { ok: false; error: string };

export async function loadLedger(fs: DiscoveryFs, paths: LedgerPaths, runId: string, now: string): Promise<LoadLedgerResult> {
  let text: string | null;
  try {
    text = await fs.readFile(paths.json);
  } catch (e) {
    return { ok: false, error: `Could not read the conjecture ledger: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (text === null) return { ok: true, ledger: emptyLedger(runId, now), existed: false };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'conjectures.json is not valid JSON. It was left untouched; fix or remove it to continue.' };
  }
  if (!isObject(raw) || raw.schema !== 1 || !Array.isArray(raw.entries)) {
    return { ok: false, error: 'conjectures.json has an unrecognised format. It was left untouched.' };
  }
  const entries = raw.entries.filter(validEntry);
  return { ok: true, existed: true, ledger: { schema: 1, run_id: typeof raw.run_id === 'string' ? raw.run_id : runId, updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : now, entries } };
}

const num = (v: unknown): string => (v === null || v === undefined ? 'n/a' : typeof v === 'number' ? String(Number(v.toPrecision(3))) : String(v));

function observedText(quantity: unknown): string {
  const obs = (quantity as { observed?: unknown } | null | undefined)?.observed;
  if (Array.isArray(obs)) return `[${num(obs[0])}, ${obs[1] === null || obs[1] === undefined ? 'inf' : num(obs[1])}]`;
  return num(obs);
}

function usageLine(entry: LedgerEntry): string {
  const p = entry.proposer;
  if (!p) return 'Proposer: edited or imported by hand.';
  const u = p.usage;
  return `Proposer: ${p.model}, prompt sha256 \`${p.prompt_sha256}\`, ${u.input_tokens} in / ${u.output_tokens} out tokens. ${p.digest_disclosure}`;
}

function evidenceTable(rows: EvidenceRow[]): string[] {
  return [
    '| Circuit | Layers | Pattern | Observed | Outcome |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.variantId ?? `#${r.circuitIndex + 1}`} | ${num(r.features.n_layers)} | ${String(r.features.entangler_pattern ?? 'n/a')} | ${r.observed === null ? 'n/a' : Array.isArray(r.observed) ? `[${num(r.observed[0])}, ${r.observed[1] === null ? 'inf' : num(r.observed[1])}]` : num(r.observed)} | ${r.outcome} |`),
  ];
}

function counterexampleLines(cx: Counterexample): string[] {
  const fp = cx.family_params;
  const axes = Array.isArray(fp.axis_order_per_layer) ? fp.axis_order_per_layer.join(',') : num(fp.axis_order_per_layer);
  const gates = Array.isArray((cx.ir as { gates?: unknown[] } | null)?.gates) ? (cx.ir as { gates: unknown[] }).gates.length : 0;
  return [
    `### Counterexample ${cx.variant_id ?? ''}`.trimEnd(), '',
    `- Observed: ${observedText(cx.quantity)}`,
    `- Family parameters: layers ${num(fp.layers)}, axis order ${axes}, brick start ${num(fp.brick_start)}`,
    `- Regenerate with seed ${cx.regenerate.seed}, variant ${cx.regenerate.variant}`,
    `- IR: ${gates} gates on ${cx.ir_n_qubits ?? 'n/a'} qubits (in \`conjectures.json\`)`, '',
  ];
}

function entryMarkdown(entry: LedgerEntry): string[] {
  const c = entry.conjecture;
  const r = entry.result;
  const verdict = entry.outcome === 'failed' ? 'failed' : (r?.verdict ?? 'failed');
  const lines = [`## ${entry.id}: ${verdict}`, '', `> ${c.statement}`, '', `- Prediction: \`${c.prediction.quantity} ${c.prediction.op} ${c.prediction.value}\``];
  if (r) {
    lines.push(
      `- Qubit range tested: ${c.n_range[0]} to ${r.n_max_tested} (${r.n_values.join(', ')})`,
      `- Circuits: ${r.n_circuits_tested} tested of ${c.circuits} requested (meets ${r.tally.meets}, violates ${r.tally.violates}, indeterminate ${r.tally.indeterminate})`,
    );
  }
  lines.push(`- Seed: ${entry.seed}`, `- Tested: ${entry.tested_at}`, '');
  if (entry.error) lines.push(`The test did not finish: ${entry.error}.`, '');
  if (r) {
    lines.push(r.summary, '');
    if (r.partial) lines.push('This is a partial result: the test stopped before every circuit finished.', '');
    const rows = r.evidence.map((e, i) => normalizeEvidence(e, i));
    if (rows.length > 0) lines.push('### Evidence', '', ...evidenceTable(rows), '');
    for (const cx of r.counterexamples) lines.push(...counterexampleLines(cx));
    lines.push(`Evaluator fingerprint: ${r.fingerprint ? `\`${r.fingerprint.slice(0, 16)}\`` : 'not reported'}. Elapsed: ${Math.round(r.timings.elapsed_ms)} ms.`, '');
  }
  lines.push(usageLine(entry), '', '```json', JSON.stringify(c, null, 2), '```', '');
  return lines;
}

const verdictOf = (e: LedgerEntry): string => (e.outcome === 'failed' ? 'failed' : (e.result?.verdict ?? 'failed'));

export function renderLedgerMarkdown(ledger: LedgerFile): string {
  const count = (v: string) => ledger.entries.filter((e) => verdictOf(e) === v).length;
  const header = [
    '# Conjecture ledger',
    '',
    `Run: ${ledger.run_id}`,
    '',
    'Supported means the prediction held on held-out circuits within their 95% intervals. It is evidence, not a guarantee. Refuted and inconclusive conjectures are kept.',
    '',
    `${ledger.entries.length} conjectures: ${count('supported')} supported, ${count('refuted')} refuted, ${count('inconclusive')} inconclusive, ${count('failed')} failed to run.`,
    '',
    '| Conjecture | Verdict | Circuits | Max n |',
    '|---|---|---|---|',
    ...ledger.entries.map((e) => `| ${e.id} | ${verdictOf(e)} | ${e.result?.n_circuits_tested ?? 0} | ${e.result?.n_max_tested ?? 'n/a'} |`),
    '',
  ];
  return `${[...header, ...ledger.entries.flatMap(entryMarkdown)].join('\n').trimEnd()}\n`;
}

export async function saveLedger(fs: DiscoveryFs, paths: LedgerPaths, ledger: LedgerFile): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fs.mkdir(paths.dir, { recursive: true });
    await fs.writeFile(paths.json, toJson(ledger));
    await fs.writeFile(paths.md, renderLedgerMarkdown(ledger));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Could not write the conjecture ledger: ${e instanceof Error ? e.message : String(e)}` };
  }
}
