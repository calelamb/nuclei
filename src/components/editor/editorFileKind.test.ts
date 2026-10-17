import { describe, expect, it } from 'vitest';
import { editorFileKind } from './editorFileKind';

describe('editorFileKind', () => {
  it.each(['bell.py', 'steane.stim', 'grover.qs', 'ghz.qasm', 'a/b/Circuit.PY'])('treats %s as runnable', (p) => {
    expect(editorFileKind(p)).toBe('runnable');
  });
  it('treats the unsaved starter buffer as runnable', () => {
    expect(editorFileKind(null)).toBe('runnable');
    expect(editorFileKind(undefined)).toBe('runnable');
  });
  it('detects experiment manifests before generic yaml', () => {
    expect(editorFileKind('proj/theta-sweep.experiment.yaml')).toBe('experiment');
  });
  it.each(['README.md', 'data.csv', 'settings.yaml', 'notes.txt'])('treats %s as plain text', (p) => {
    expect(editorFileKind(p)).toBe('other');
  });
});
