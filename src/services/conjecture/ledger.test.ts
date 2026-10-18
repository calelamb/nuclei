import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '../../types/conjecture';
import { platformJoin } from '../discovery/platformFs';
import { createMemoryFs } from '../discovery/testkit';
import { fixtureConjecture, fixtureResult } from './fixtures';
import { emptyLedger, ledgerPaths, loadLedger, renderLedgerMarkdown, saveLedger, upsertEntry } from './ledger';

const NOW = '2026-10-18T15:00:00.000Z';
const paths = ledgerPaths(platformJoin, '/proj', 'w-state.discovery.yaml', 'run-1');
const entry = (id: string, verdict: 'supported' | 'refuted' | 'inconclusive' | null, tested = NOW): LedgerEntry => ({
  id,
  conjecture: fixtureConjecture({ id }),
  proposer: { model: 'claude-opus-5-5', prompt_sha256: 'ab'.repeat(32), usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, proposed_at: NOW, digest_disclosure: 'Digest shows 12 of 12.' },
  outcome: verdict ? 'complete' : 'failed',
  result: verdict ? fixtureResult(verdict) : null,
  error: verdict ? null : 'kernel disconnected',
  seed: 42,
  tested_at: tested,
});

describe('conjecture ledger', () => {
  it('uses the addendum paths', () => {
    expect(paths.json).toBe('/proj/experiments/w-state/discovery/run-1/conjectures.json');
    expect(paths.md).toBe('/proj/experiments/w-state/discovery/run-1/conjectures.md');
  });

  it('round-trips through the fs and keeps refuted and failed entries', async () => {
    const fs = createMemoryFs();
    let ledger = emptyLedger('run-1', NOW);
    ledger = upsertEntry(ledger, entry('a', 'supported', '2026-10-18T15:01:00.000Z'), NOW);
    ledger = upsertEntry(ledger, entry('b', 'refuted', '2026-10-18T15:02:00.000Z'), NOW);
    ledger = upsertEntry(ledger, entry('c', null, '2026-10-18T15:03:00.000Z'), NOW);
    expect(await saveLedger(fs, paths, ledger)).toEqual({ ok: true });
    const loaded = await loadLedger(fs, paths, 'run-1', NOW);
    expect(loaded.ok && loaded.existed).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.ledger.entries.map((e) => e.id)).toEqual(['c', 'b', 'a']);
    expect(loaded.ledger.entries[1].result?.counterexamples).toHaveLength(1);
    expect(loaded.ledger).toEqual(ledger);
  });

  it('upserts by id without mutating the input', () => {
    const base = upsertEntry(emptyLedger('run-1', NOW), entry('a', 'inconclusive'), NOW);
    const next = upsertEntry(base, entry('a', 'refuted'), NOW);
    expect(base.entries[0].result?.verdict).toBe('inconclusive');
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].result?.verdict).toBe('refuted');
  });

  it('writes markdown with a header, the kernel ledger text, proposer metadata and honest wording', async () => {
    const fs = createMemoryFs();
    const ledger = upsertEntry(upsertEntry(emptyLedger('run-1', NOW), entry('a', 'supported'), NOW), entry('b', 'refuted', '2026-10-18T15:05:00.000Z'), NOW);
    await saveLedger(fs, paths, ledger);
    const md = fs.files.get(paths.md)!;
    expect(md).toContain('# Conjecture ledger, run run-1');
    expect(md).toContain('2 conjectures: 1 supported, 1 refuted, 0 inconclusive');
    expect(md).toContain('Kernel evidence table goes here.');
    expect(md).toContain('prompt sha256');
    expect(md).toContain('evidence, not proof');
    expect(md).not.toMatch(/\bproven\b/);
    expect(renderLedgerMarkdown(ledger)).toBe(md);
  });

  it('treats a missing file as empty and refuses to overwrite a corrupt one', async () => {
    const empty = await loadLedger(createMemoryFs(), paths, 'run-1', NOW);
    expect(empty).toMatchObject({ ok: true, existed: false });
    const bad = await loadLedger(createMemoryFs({ [paths.json]: '{nope' }), paths, 'run-1', NOW);
    expect(bad.ok).toBe(false);
    const wrong = await loadLedger(createMemoryFs({ [paths.json]: '{"schema":2}' }), paths, 'run-1', NOW);
    expect(wrong.ok).toBe(false);
  });

  it('reports write failures', async () => {
    const fs = createMemoryFs();
    fs.writeFile = async () => { throw new Error('disk full'); };
    const res = await saveLedger(fs, paths, emptyLedger('run-1', NOW));
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.error).toContain('disk full');
  });
});
