import { describe, it, expect } from 'vitest';
import { entityLabel } from './qecEntityLabel';
import type { DiscoveredQecStudy } from '../../../services/qecStudyStore';

const studies = [{ fileName: 'a', path: 'a', study: { id: 'surface-memory', name: 'Surface Memory Study' } }] as unknown as DiscoveredQecStudy[];

describe('entityLabel', () => {
  it('shows a Study by its name', () => {
    expect(entityLabel({ kind: 'study', id: 'surface-memory' }, studies)).toEqual({ text: 'Surface Memory Study', mono: false });
  });
  it('falls back to the id when the Study is not loaded', () => {
    expect(entityLabel({ kind: 'study', id: 'gone' }, studies)).toEqual({ text: 'gone', mono: true });
  });
  it('shows other entities by id in mono', () => {
    expect(entityLabel({ kind: 'detector', id: 'D42' }, studies)).toEqual({ text: 'D42', mono: true });
  });
});
