import { describe, it, expect, beforeEach } from 'vitest';
import { applyQecExplainError, applyQecExplainResult, explainSizeError } from './qecExplainMessages';
import { useQecExplainStore } from '../stores/qecExplainStore';

beforeEach(() => useQecExplainStore.getState().reset());

describe('qec explain message application', () => {
  it('stores a valid result and clears pending', () => {
    useQecExplainStore.getState().begin('R 0');
    applyQecExplainResult({ min_weight: { status: 'none_found', sentence: 'nothing found' } });
    const s = useQecExplainStore.getState();
    expect(s.pending).toBe(false);
    expect(s.result?.min_weight?.status).toBe('none_found');
  });

  it('turns a kernel error into a visible store error and drops stale results', () => {
    applyQecExplainResult({ nondeterministic: { status: 'ok', sentence: 'ok' } });
    applyQecExplainError('too large');
    const s = useQecExplainStore.getState();
    expect(s.error).toBe('too large');
    expect(s.result).toBeNull();
  });

  it('ignores a reply bound to a different request id (stale)', () => {
    useQecExplainStore.getState().begin('R 0', 'req-2');
    applyQecExplainResult({ min_weight: { status: 'none_found', sentence: 'old' } }, 'req-1');
    applyQecExplainError('old failure', 'req-1');
    let s = useQecExplainStore.getState();
    expect(s.pending).toBe(true);
    expect(s.result).toBeNull();
    expect(s.error).toBeNull();
    applyQecExplainResult({ min_weight: { status: 'none_found', sentence: 'new' } }, 'req-2');
    s = useQecExplainStore.getState();
    expect(s.pending).toBe(false);
    expect(s.result?.min_weight?.sentence).toBe('new');
  });

  it('accepts replies that carry no request id', () => {
    useQecExplainStore.getState().begin('R 0', 'req-1');
    applyQecExplainResult({ min_weight: { status: 'none_found', sentence: 'x' } });
    expect(useQecExplainStore.getState().pending).toBe(false);
  });

  it('failPending surfaces a lost connection only while a request is pending', () => {
    const store = useQecExplainStore.getState();
    store.failPending('Kernel connection lost.');
    expect(useQecExplainStore.getState().error).toBeNull();
    store.begin('R 0', 'req-1');
    store.failPending('Kernel connection lost.');
    const s = useQecExplainStore.getState();
    expect(s.pending).toBe(false);
    expect(s.error).toBe('Kernel connection lost.');
  });

  it('explainSizeError rejects circuits the kernel socket cannot carry', () => {
    expect(explainSizeError('H 0\n')).toBeNull();
    expect(explainSizeError('H 0\n'.repeat(300_000))).toMatch(/too large/i);
    expect(explainSizeError('é'.repeat(600_000))).toMatch(/too large/i);
  });
});
