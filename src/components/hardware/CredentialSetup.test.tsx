// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { CredentialSetup } from './CredentialSetup';

// Regression: PROVIDER_CONFIG used to declare the IBM field as `apiToken` and
// the IonQ field as `apiKey`, but the kernel reads `credentials.get("token")`
// (ibm_provider.py:22, ionq_provider.py:28). handleSave forwards the raw field
// values as the `credentials` object, so connects from this dialog silently
// sent an empty token. These tests pin the dialog to the kernel contract:
//   ibm  → required `token`, optional `instance`
//   ionq → required `token`
const { hardwareConnect } = vi.hoisted(() => ({ hardwareConnect: vi.fn() }));

vi.mock('../../App', () => ({
  getHardware: () => ({
    hardwareConnect,
    hardwareSubmit: vi.fn(),
    hardwareCancel: vi.fn(),
  }),
}));

describe('CredentialSetup — kernel credential contract', () => {
  beforeEach(() => {
    hardwareConnect.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('ibm: saving sends only kernel-contract keys (token, optional instance)', () => {
    const { getByPlaceholderText, getByText } = render(
      <CredentialSetup provider="ibm" onClose={vi.fn()} />,
    );

    fireEvent.change(getByPlaceholderText('Paste your IBM Quantum API token...'), {
      target: { value: 'ibm-secret-token' },
    });
    fireEvent.click(getByText('Save'));

    expect(hardwareConnect).toHaveBeenCalledTimes(1);
    const [provider, credentials] = hardwareConnect.mock.calls[0] as [
      string,
      Record<string, string>,
    ];
    expect(provider).toBe('ibm');
    // Kernel reads credentials.get("token") and optionally "instance".
    expect(credentials.token).toBe('ibm-secret-token');
    const allowedIbmKeys = ['token', 'instance'];
    expect(Object.keys(credentials)).toContain('token');
    Object.keys(credentials).forEach((key) => {
      expect(allowedIbmKeys).toContain(key);
    });
  });

  it('ionq: saving sends exactly { token } to hardwareConnect', () => {
    const { getByPlaceholderText, getByText } = render(
      <CredentialSetup provider="ionq" onClose={vi.fn()} />,
    );

    fireEvent.change(getByPlaceholderText('Paste your IonQ API key...'), {
      target: { value: 'ionq-secret-key' },
    });
    fireEvent.click(getByText('Save'));

    expect(hardwareConnect).toHaveBeenCalledTimes(1);
    const [provider, credentials] = hardwareConnect.mock.calls[0] as [
      string,
      Record<string, string>,
    ];
    expect(provider).toBe('ionq');
    // Kernel reads credentials.get("token") — nothing else.
    expect(credentials).toEqual({ token: 'ionq-secret-key' });
  });
});
