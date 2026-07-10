import { describe, expect, it } from 'vitest';
import { hashContent } from './hash';
import { InMemoryWorkspace } from './workspace';

const FILE_PATH = 'main.py';
const INITIAL_CONTENT = 'print("hello")\n';

function makeWorkspace(): InMemoryWorkspace {
  return new InMemoryWorkspace([
    { path: FILE_PATH, framework: 'qiskit', content: INITIAL_CONTENT, dirty: false },
  ]);
}

describe('InMemoryWorkspace', () => {
  it('lists files and reports the active path', () => {
    const ws = makeWorkspace();
    expect(ws.listFiles()).toEqual([
      { path: FILE_PATH, framework: 'qiskit', content: INITIAL_CONTENT, dirty: false },
    ]);
    expect(ws.activePath()).toBe(FILE_PATH);
  });

  it('reads a known file and returns null for an unknown one', () => {
    const ws = makeWorkspace();
    expect(ws.readFile(FILE_PATH)?.content).toBe(INITIAL_CONTENT);
    expect(ws.readFile('missing.py')).toBeNull();
  });

  it('applyPatch creates a transaction and mutates the file', () => {
    const ws = makeWorkspace();
    const newContent = 'print("goodbye")\n';
    const result = ws.applyPatch(FILE_PATH, newContent);

    expect('conflict' in result).toBe(false);
    if ('conflict' in result) throw new Error('unexpected conflict');

    expect(result.path).toBe(FILE_PATH);
    expect(result.beforeContent).toBe(INITIAL_CONTENT);
    expect(result.afterContent).toBe(newContent);
    expect(result.beforeHash).toBe(hashContent(INITIAL_CONTENT));
    expect(result.afterHash).toBe(hashContent(newContent));
    expect(result.rolledBack).toBe(false);
    expect(typeof result.id).toBe('string');

    expect(ws.readFile(FILE_PATH)?.content).toBe(newContent);
    expect(ws.readFile(FILE_PATH)?.dirty).toBe(true);
  });

  it('applyPatch reports a conflict and does not mutate when expectedBeforeHash mismatches', () => {
    const ws = makeWorkspace();
    const result = ws.applyPatch(FILE_PATH, 'print("nope")\n', 'not-the-real-hash');

    expect(result).toEqual({ conflict: true, currentHash: hashContent(INITIAL_CONTENT) });
    // Content must be untouched.
    expect(ws.readFile(FILE_PATH)?.content).toBe(INITIAL_CONTENT);
    expect(ws.readFile(FILE_PATH)?.dirty).toBe(false);
  });

  it('applyPatch succeeds when expectedBeforeHash matches the current hash', () => {
    const ws = makeWorkspace();
    const result = ws.applyPatch(FILE_PATH, 'print("ok")\n', hashContent(INITIAL_CONTENT));
    expect('conflict' in result).toBe(false);
  });

  it('rollback restores content when nothing has changed since', () => {
    const ws = makeWorkspace();
    const newContent = 'print("goodbye")\n';
    const result = ws.applyPatch(FILE_PATH, newContent);
    if ('conflict' in result) throw new Error('unexpected conflict');

    const rolledBack = ws.rollback(result.id);
    expect(rolledBack).toBe(true);
    expect(ws.readFile(FILE_PATH)?.content).toBe(INITIAL_CONTENT);
  });

  it('rollback fails if the file content changed since the patch was applied', () => {
    const ws = makeWorkspace();
    const first = ws.applyPatch(FILE_PATH, 'print("v2")\n');
    if ('conflict' in first) throw new Error('unexpected conflict');

    // A second, unrelated edit lands on top.
    ws.applyPatch(FILE_PATH, 'print("v3")\n');

    const rolledBack = ws.rollback(first.id);
    expect(rolledBack).toBe(false);
    expect(ws.readFile(FILE_PATH)?.content).toBe('print("v3")\n');
  });

  it('rollback fails for an unknown transaction id', () => {
    const ws = makeWorkspace();
    expect(ws.rollback('does-not-exist')).toBe(false);
  });

  it('rollback fails if called twice on the same transaction', () => {
    const ws = makeWorkspace();
    const result = ws.applyPatch(FILE_PATH, 'print("v2")\n');
    if ('conflict' in result) throw new Error('unexpected conflict');

    expect(ws.rollback(result.id)).toBe(true);
    expect(ws.rollback(result.id)).toBe(false);
  });
});
