import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore } from '../../stores/projectStore';
import { hashContent } from './hash';
import { StoreWorkspace } from './storeWorkspace';

const INITIAL_CODE = 'print("hello")\n';

function resetStores(): void {
  useEditorStore.setState({ code: INITIAL_CODE, framework: 'qiskit', filePath: null, isDirty: false });
  useProjectStore.setState({ tabs: [], activeTabPath: null, projectRoot: null });
}

describe('StoreWorkspace', () => {
  beforeEach(() => {
    resetStores();
  });

  it('activePath falls back to "editor" when no project tab is open', () => {
    const ws = new StoreWorkspace();
    expect(ws.activePath()).toBe('editor');
  });

  it('activePath follows projectStore.activeTabPath when a tab is open', () => {
    useProjectStore.setState({ activeTabPath: 'bell.py' });
    const ws = new StoreWorkspace();
    expect(ws.activePath()).toBe('bell.py');
  });

  it('listFiles returns the single active buffer with the editor content and framework', () => {
    const ws = new StoreWorkspace();
    expect(ws.listFiles()).toEqual([{ path: 'editor', framework: 'qiskit', content: INITIAL_CODE, dirty: false }]);
  });

  it('readFile returns the active buffer for the active path and null otherwise', () => {
    const ws = new StoreWorkspace();
    expect(ws.readFile('editor')?.content).toBe(INITIAL_CODE);
    expect(ws.readFile('other.py')).toBeNull();
  });

  it('applyPatch mutates editorStore.code and returns a transaction', () => {
    const ws = new StoreWorkspace();
    const newContent = 'print("goodbye")\n';
    const result = ws.applyPatch('editor', newContent);

    expect('conflict' in result).toBe(false);
    if ('conflict' in result) throw new Error('unexpected conflict');

    expect(result.path).toBe('editor');
    expect(result.beforeContent).toBe(INITIAL_CODE);
    expect(result.afterContent).toBe(newContent);
    expect(result.beforeHash).toBe(hashContent(INITIAL_CODE));
    expect(result.afterHash).toBe(hashContent(newContent));
    expect(result.rolledBack).toBe(false);

    expect(useEditorStore.getState().code).toBe(newContent);
  });

  it('applyPatch reports a conflict and does not mutate when expectedBeforeHash mismatches', () => {
    const ws = new StoreWorkspace();
    const result = ws.applyPatch('editor', 'print("nope")\n', 'not-the-real-hash');

    expect(result).toEqual({ conflict: true, currentHash: hashContent(INITIAL_CODE) });
    expect(useEditorStore.getState().code).toBe(INITIAL_CODE);
  });

  it('applyPatch succeeds when expectedBeforeHash matches the current hash', () => {
    const ws = new StoreWorkspace();
    const result = ws.applyPatch('editor', 'print("ok")\n', hashContent(INITIAL_CODE));
    expect('conflict' in result).toBe(false);
  });

  it('applyPatch reports a conflict for any path other than the active buffer', () => {
    const ws = new StoreWorkspace();
    const result = ws.applyPatch('not-active.py', 'print("nope")\n');
    expect(result).toEqual({ conflict: true, currentHash: hashContent(INITIAL_CODE) });
    expect(useEditorStore.getState().code).toBe(INITIAL_CODE);
  });

  it('rollback restores editorStore.code when nothing has changed since', () => {
    const ws = new StoreWorkspace();
    const newContent = 'print("goodbye")\n';
    const result = ws.applyPatch('editor', newContent);
    if ('conflict' in result) throw new Error('unexpected conflict');

    const rolledBack = ws.rollback(result.id);
    expect(rolledBack).toBe(true);
    expect(useEditorStore.getState().code).toBe(INITIAL_CODE);
  });

  it('rollback fails if the editor content changed since the patch was applied', () => {
    const ws = new StoreWorkspace();
    const first = ws.applyPatch('editor', 'print("v2")\n');
    if ('conflict' in first) throw new Error('unexpected conflict');

    // A second, unrelated edit lands on top (e.g. the user typed in Monaco).
    useEditorStore.getState().setCode('print("v3")\n');

    const rolledBack = ws.rollback(first.id);
    expect(rolledBack).toBe(false);
    expect(useEditorStore.getState().code).toBe('print("v3")\n');
  });

  it('rollback fails for an unknown transaction id', () => {
    const ws = new StoreWorkspace();
    expect(ws.rollback('does-not-exist')).toBe(false);
  });

  it('rollback fails if called twice on the same transaction', () => {
    const ws = new StoreWorkspace();
    const result = ws.applyPatch('editor', 'print("v2")\n');
    if ('conflict' in result) throw new Error('unexpected conflict');

    expect(ws.rollback(result.id)).toBe(true);
    expect(ws.rollback(result.id)).toBe(false);
  });

  it('getTransaction returns the full transaction by id, or undefined when unknown', () => {
    const ws = new StoreWorkspace();
    const result = ws.applyPatch('editor', 'print("v2")\n');
    if ('conflict' in result) throw new Error('unexpected conflict');

    expect(ws.getTransaction(result.id)).toEqual(result);
    expect(ws.getTransaction('missing')).toBeUndefined();
  });
});
