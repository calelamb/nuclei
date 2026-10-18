import { describe, expect, it } from 'vitest';
import {
  desktopOnlyMessage, describeKernelFailure, kernelEngineName, kernelUnavailableMessage, kernelNotConnectedMessage, kernelStartFailureTitle,
  kernelStartingMessage, kernelWaitingLabel, normalizeKernelError,
} from './kernelErrors';

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

  it('names every failed start once per runtime, whatever the cause', () => {
    for (const message of ['Port 8742 is already in use.', 'Kernel script not found at: /x', 'something else entirely', 'The kernel did not respond after 15 attempts.']) {
      expect(describeKernelFailure(message, { isWeb: true }).title).toBe("Python didn't start");
      expect(describeKernelFailure(message, { isWeb: false }).title).toBe("Kernel didn't start");
    }
  });

  it('moves the specific reason into the body without repeating it', () => {
    const web = describeKernelFailure(
      "Couldn't start the browser Python engine. Check your connection or content blocker, then retry.",
      { isWeb: true },
    );
    expect(web.detail).toBe("Couldn't start the browser Python engine. Check your connection or content blocker, then retry.");
    expect(describeKernelFailure('Port 8742 is already in use.', { isWeb: false }).detail)
      .toBe('Another app is using the kernel port. Port 8742 is already in use.');
    expect(describeKernelFailure('something else entirely', { isWeb: false }).detail).toBe('something else entirely');
  });
});

describe('kernelStartFailureTitle', () => {
  it('is one phrase per runtime', () => {
    expect(kernelStartFailureTitle(true)).toBe("Python didn't start");
    expect(kernelStartFailureTitle(false)).toBe("Kernel didn't start");
  });
});

describe('shared kernel vocabulary (research-r-02)', () => {
  it('never says kernel on the web build', () => {
    const web = [
      kernelEngineName(true),
      kernelStartingMessage({ isWeb: true }),
      kernelNotConnectedMessage({ isWeb: true }),
      kernelWaitingLabel(true),
    ];
    web.forEach((text) => expect(text).not.toMatch(/kernel/i));
  });

  it('desktop names the kernel and tells the person where to look', () => {
    expect(kernelStartingMessage({ isWeb: false })).toBe('The kernel is still starting. Try again when the status bar says ready.');
    expect(kernelStartingMessage({ isWeb: false, again: 'Run again' })).toMatch(/^The kernel is still starting\. Run again/);
    expect(kernelNotConnectedMessage({ isWeb: false })).toBe("The kernel isn't connected. Check the status bar, then try again.");
    expect(kernelWaitingLabel(false)).toBe('Waiting for the kernel…');
  });
});

describe('describeDesktopCommandError', () => {
  it('maps a missing Tauri bridge to the desktop-only sentence and passes other errors through', async () => {
    const { describeDesktopCommandError, DESKTOP_ONLY_MESSAGE } = await import('./kernelErrors');
    expect(describeDesktopCommandError(new TypeError("Cannot read properties of undefined (reading 'invoke')"))).toBe(DESKTOP_ONLY_MESSAGE);
    expect(describeDesktopCommandError("Cannot read properties of undefined (reading 'transformCallback')")).toBe(DESKTOP_ONLY_MESSAGE);
    expect(describeDesktopCommandError(new Error('disk full'))).toBe('disk full');
  });
});

describe('kernelUnavailableMessage (research-r-03)', () => {
  it('connecting: still starting, with the caller follow-up', () => {
    expect(kernelUnavailableMessage('connecting', { isWeb: false })).toBe('The kernel is still starting. Try again when the status bar says ready.');
    expect(kernelUnavailableMessage('connecting', { isWeb: true, again: 'Run again' })).toBe('Python is still starting. Run again when the status bar says ready.');
  });

  it('failed: names the failed start like the banner and status bar do', () => {
    expect(kernelUnavailableMessage('failed', { isWeb: false })).toBe("Kernel didn't start. Check the status bar, then retry.");
    expect(kernelUnavailableMessage('failed', { isWeb: true })).toBe("Python didn't start. Check the status bar, then retry.");
  });

  it('ready or idle: the connection is gone', () => {
    expect(kernelUnavailableMessage('ready', { isWeb: false })).toBe("The kernel isn't connected. Check the status bar, then try again.");
    expect(kernelUnavailableMessage('idle', { isWeb: true })).toBe("Python isn't running. Check the status bar, then try again.");
  });
});

describe('desktopOnlyMessage', () => {
  it('names the feature and never claims the engine is down', () => {
    expect(desktopOnlyMessage('Resource estimates')).toBe('Resource estimates run in the desktop app.');
  });
});
