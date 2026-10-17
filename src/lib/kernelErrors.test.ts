import { describe, expect, it } from 'vitest';
import { describeKernelFailure, normalizeKernelError } from './kernelErrors';

describe('normalizeKernelError', () => {
  it('keeps the verbatim Rust string', () => {
    expect(normalizeKernelError('Port 8742 is already in use by another application.')).toBe(
      'Port 8742 is already in use by another application.',
    );
  });

  it('unwraps Error objects and strips the "Error:" prefix', () => {
    expect(normalizeKernelError(new Error('Error: boom'))).toBe('boom');
  });

  it('never returns an empty string', () => {
    expect(normalizeKernelError(undefined)).toMatch(/unknown reason/);
    expect(normalizeKernelError({})).toMatch(/unknown reason/);
  });
});

describe('describeKernelFailure', () => {
  it.each([
    ['Port 8742 is already in use by another application. Close it and retry.', 'port-in-use'],
    ['Kernel script not found at: /x/kernel/server.py. cwd: /x', 'script-missing'],
    ['Failed to start kernel: No such file or directory (cwd: /x)', 'python-missing'],
    ['Kernel rejected the session token — restart Nuclei', 'auth-rejected'],
    ["Couldn't start the browser Python engine. Check your connection or content blocker, then retry.", 'browser-load'],
    ['something else entirely', 'unknown'],
  ])('classifies %s', (message, kind) => {
    const failure = describeKernelFailure(message);
    expect(failure.kind).toBe(kind);
    expect(failure.message).toBe(message);
    expect(failure.docsUrl).toBe(`https://getnuclei.dev/docs/introduction/kernel-troubleshooting/#${kind}`);
  });

  it('does not repeat the title in the banner body', () => {
    const failure = describeKernelFailure(
      "Couldn't start the browser Python engine. Check your connection or content blocker, then retry.",
    );
    expect(failure.detail).toBe('Check your connection or content blocker, then retry.');
    expect(describeKernelFailure('Port 8742 is already in use.').detail).toBe('Port 8742 is already in use.');
  });
});
