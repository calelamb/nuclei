import { describe, it, expect } from 'vitest';
import { parseManifestJson } from './manifestSchema';

const VALID = {
  name: 'qubit-counter',
  version: '1.0.0',
  description: 'Live qubit-count panel.',
  author: 'Nuclei',
  entry: 'entry.js',
  capabilities: ['custom-panel'],
  permissions: ['read-circuit'],
};

function json(obj: unknown): string {
  return JSON.stringify(obj);
}

describe('parseManifestJson', () => {
  it('accepts a valid manifest', () => {
    const res = parseManifestJson(json(VALID));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.manifest.name).toBe('qubit-counter');
      expect(res.manifest.capabilities).toEqual(['custom-panel']);
    }
  });

  it('applies defaults for optional description/author/permissions', () => {
    const res = parseManifestJson(
      json({ name: 'x', version: '0.1.0', entry: 'e.js', capabilities: ['theme'] }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.manifest.description).toBe('');
      expect(res.manifest.author).toBe('');
      expect(res.manifest.permissions).toEqual([]);
    }
  });

  it('rejects invalid JSON with a clear error', () => {
    const res = parseManifestJson('{ not json ');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toMatch(/invalid JSON/i);
  });

  it('rejects a non-kebab-case name', () => {
    const res = parseManifestJson(json({ ...VALID, name: 'Qubit_Counter' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/kebab/i);
  });

  it('rejects a non-semver version', () => {
    const res = parseManifestJson(json({ ...VALID, version: '1.0' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/semver/i);
  });

  it('rejects a missing capabilities list', () => {
    const res = parseManifestJson(json({ ...VALID, capabilities: [] }));
    expect(res.ok).toBe(false);
  });

  it('rejects an unknown capability', () => {
    const res = parseManifestJson(json({ ...VALID, capabilities: ['telepathy'] }));
    expect(res.ok).toBe(false);
  });

  it('rejects unknown / typo keys (strict object)', () => {
    const res = parseManifestJson(json({ ...VALID, capabilties: ['theme'] }));
    expect(res.ok).toBe(false);
  });

  it.each([
    ['/etc/passwd', 'absolute POSIX'],
    ['../escape.js', 'parent traversal'],
    ['a/../../b.js', 'nested traversal'],
    ['C:\\win.js', 'Windows drive'],
    ['\\\\unc\\x.js', 'UNC path'],
  ])('rejects an escaping entry path (%s — %s)', (entry) => {
    const res = parseManifestJson(json({ ...VALID, entry }));
    expect(res.ok).toBe(false);
  });

  it('allows a nested but contained entry path', () => {
    const res = parseManifestJson(json({ ...VALID, entry: 'dist/entry.js' }));
    expect(res.ok).toBe(true);
  });
});
