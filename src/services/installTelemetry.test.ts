import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getInstallIdForDisplay,
  runInstallTelemetry,
} from './installTelemetry';

type FetchMock = ReturnType<typeof vi.fn>;

function setupFetchMock(): FetchMock {
  const mock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('installTelemetry', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing when disabled', async () => {
    const fetchMock = setupFetchMock();
    await runInstallTelemetry({
      appVersion: '1.2.3',
      isEnabled: () => false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getInstallIdForDisplay()).toBeNull();
  });

  it('sends first_run on first invocation and stores install id', async () => {
    const fetchMock = setupFetchMock();

    await runInstallTelemetry({
      appVersion: '1.2.3',
      isEnabled: () => true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://getnuclei.dev/api/telemetry');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe('first_run');
    expect(body.app_version).toBe('1.2.3');
    expect(body.install_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const persistedId = getInstallIdForDisplay();
    expect(persistedId).toBe(body.install_id);
  });

  it('does not send a second first_run or a heartbeat within a week', async () => {
    const fetchMock = setupFetchMock();

    await runInstallTelemetry({
      appVersion: '1.2.3',
      isEnabled: () => true,
    });
    await runInstallTelemetry({
      appVersion: '1.2.3',
      isEnabled: () => true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a heartbeat once the weekly interval has passed', async () => {
    const fetchMock = setupFetchMock();

    await runInstallTelemetry({
      appVersion: '1.2.3',
      isEnabled: () => true,
    });
    // Backdate the last-heartbeat marker to 8 days ago.
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      'nuclei-install-last-heartbeat',
      eightDaysAgo.toString(),
    );

    await runInstallTelemetry({
      appVersion: '1.2.3',
      isEnabled: () => true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(
      (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string,
    );
    expect(secondBody.event).toBe('heartbeat');
    expect(secondBody.install_id).toBe(getInstallIdForDisplay());
  });

  it('swallows network errors so startup is never blocked', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runInstallTelemetry({
        appVersion: '1.2.3',
        isEnabled: () => true,
      }),
    ).resolves.toBeUndefined();
  });

  it('reuses the same install_id across invocations', async () => {
    setupFetchMock();

    await runInstallTelemetry({
      appVersion: '1.2.3',
      isEnabled: () => true,
    });
    const firstId = getInstallIdForDisplay();

    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      'nuclei-install-last-heartbeat',
      eightDaysAgo.toString(),
    );

    await runInstallTelemetry({
      appVersion: '1.2.4',
      isEnabled: () => true,
    });

    expect(getInstallIdForDisplay()).toBe(firstId);
  });
});
