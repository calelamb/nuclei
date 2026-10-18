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

import type { LedgerEntry, LedgerFile } from '../../types/conjecture';
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

function usageLine(entry: LedgerEntry): string {
  const p = entry.proposer;
  if (!p) return 'Proposer: edited or imported by hand.';
  const u = p.usage;
  return `Proposer: ${p.model}, prompt sha256 ${p.prompt_sha256}, ${u.input_tokens} in / ${u.output_tokens} out tokens. ${p.digest_disclosure}`;
}

function entryMarkdown(entry: LedgerEntry): string {
  const verdict = entry.result?.verdict ?? 'failed';
  const lines = [`## ${entry.id}: ${verdict}`, '', `> ${entry.conjecture.statement}`, ''];
  if (entry.result) {
    lines.push(entry.result.ledger_markdown?.trim() || entry.result.summary, '');
    lines.push(`Fingerprint: \`${entry.result.fingerprint}\`. Elapsed: ${Math.round(entry.result.elapsed_ms)} ms. Counterexamples: ${entry.result.counterexamples.length}.`);
  } else {
    lines.push(`The test did not finish: ${entry.error ?? 'unknown error'}.`);
  }
  lines.push(`Seed ${entry.seed}, tested ${entry.tested_at}.`, usageLine(entry), '');
  lines.push('```json', JSON.stringify(entry.conjecture, null, 2), '```', '');
  return lines.join('\n');
}

export function renderLedgerMarkdown(ledger: LedgerFile): string {
  const count = (v: string) => ledger.entries.filter((e) => e.result?.verdict === v).length;
  const header = [
    `# Conjecture ledger, run ${ledger.run_id}`,
    '',
    `${ledger.entries.length} conjectures: ${count('supported')} supported, ${count('refuted')} refuted, ${count('inconclusive')} inconclusive, ${ledger.entries.filter((e) => !e.result).length} failed to run.`,
    '',
    '"Supported" means supported on the listed held-out circuits up to the stated n. It is evidence, not proof. Refuted and inconclusive results are kept on purpose.',
    '',
  ];
  return `${[...header, ...ledger.entries.map(entryMarkdown)].join('\n').trimEnd()}\n`;
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
