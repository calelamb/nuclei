import { describe, it, expect, beforeEach } from 'vitest';
import { applyQecExplainError, applyQecExplainResult } from './qecExplainMessages';
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
});
