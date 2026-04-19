import { useState } from 'react';
import { X } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useHardwareStore } from '../../stores/hardwareStore';
import type { HardwareProviderType } from '../../types/hardware';
import { getHardware } from '../../App';

interface CredentialSetupProps {
  provider: HardwareProviderType;
  onClose: () => void;
}

const PROVIDER_CONFIG: Record<
  HardwareProviderType,
  {
    label: string;
    description: string;
    fields: Array<{ key: string; label: string; placeholder: string; type?: string }>;
    helpText?: string;
    helpUrl?: string;
  }
> = {
  ibm: {
    label: 'IBM Quantum',
    description: 'Connect to IBM Quantum to run circuits on real quantum hardware.',
    fields: [
      {
        key: 'apiToken',
        label: 'IBM Quantum API Token',
        placeholder: 'Paste your IBM Quantum API token...',
      },
    ],
    helpText: 'Get a free token at quantum.ibm.com',
    helpUrl: 'https://quantum.ibm.com',
  },
  google: {
    label: 'Google Quantum AI',
    description: 'Connect to Google Cloud to access Cirq-compatible processors.',
    fields: [
      {
        key: 'projectId',
        label: 'Google Cloud Project ID',
        placeholder: 'my-quantum-project',
      },
      {
        key: 'serviceAccountPath',
        label: 'Service Account JSON Path',
        placeholder: '/path/to/service-account.json',
      },
    ],
  },
  ionq: {
    label: 'IonQ',
    description: 'Connect to IonQ trapped-ion quantum computers.',
    fields: [
      {
        key: 'apiKey',
        label: 'IonQ API Key',
        placeholder: 'Paste your IonQ API key...',
      },
    ],
    helpText: 'Or use Amazon Braket credentials for IonQ access',
  },
  nvidia: {
    label: 'NVIDIA CUDA-Q',
    description:
      'GPU-accelerated simulation via CUDA-Q. No credentials needed — just requires `cudaq` installed in the kernel environment.',
    fields: [],
    helpText: 'Install with: pip install cudaq',
    helpUrl: 'https://nvidia.github.io/cuda-quantum/',
  },
  braket: {
    label: 'AWS Braket',
    description:
      'AWS Braket aggregates IonQ, Rigetti, QuEra, IQM, OQC, Pasqal, and D-Wave under one integration. Requires AWS credentials with the AmazonBraketFullAccess policy.',
    fields: [
      { key: 'access_key_id', label: 'AWS Access Key ID', placeholder: 'AKIA...' },
      { key: 'secret_access_key', label: 'AWS Secret Access Key', placeholder: '••••••••' },
      { key: 'region', label: 'Region', placeholder: 'us-east-1' },
    ],
    helpText: 'Attach AmazonBraketFullAccess in the IAM console.',
    helpUrl: 'https://aws.amazon.com/braket/',
  },
  azure: {
    label: 'Azure Quantum',
    description:
      'Azure Quantum aggregates Quantinuum, IonQ, Rigetti, Pasqal, and IQM. Requires an Azure subscription and a Quantum workspace.',
    fields: [
      { key: 'subscription_id', label: 'Subscription ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
      { key: 'resource_group', label: 'Resource Group', placeholder: 'MyQuantumRG' },
      { key: 'workspace_name', label: 'Workspace Name', placeholder: 'my-workspace' },
      { key: 'location', label: 'Location', placeholder: 'eastus' },
    ],
    helpText: 'Create a workspace at portal.azure.com.',
    helpUrl: 'https://azure.microsoft.com/en-us/products/quantum',
  },
  quantinuum: {
    label: 'Quantinuum',
    description:
      'Direct access to Quantinuum H1/H2 trapped-ion systems via Quantinuum Nexus.',
    fields: [
      { key: 'token', label: 'Nexus API Token', placeholder: 'Paste your Nexus API token...' },
    ],
    helpText: 'Request access at nexus.quantinuum.com.',
    helpUrl: 'https://nexus.quantinuum.com',
  },
  xanadu: {
    label: 'Xanadu',
    description:
      'Xanadu is a photonic quantum computer — continuous-variable gates and boson sampling. It uses a different circuit model than Qiskit/Cirq; submissions from Nuclei are not yet supported.',
    fields: [],
    helpText: 'Photonic circuits are a different paradigm — coming later.',
  },
  dwave: {
    label: 'D-Wave',
    description:
      'D-Wave is a quantum annealer — it solves QUBO / Ising problems rather than running gate-model circuits. Submissions from Nuclei are not yet supported.',
    fields: [],
    helpText: 'Annealers are a different paradigm — coming later.',
  },
  simulator: {
    label: 'Local Simulator',
    description: 'The local simulator is always available.',
    fields: [],
  },
};

export function CredentialSetup({ provider, onClose }: CredentialSetupProps) {
  const colors = useThemeStore((s) => s.colors);
  const setProviderConnected = useHardwareStore((s) => s.setProviderConnected);
  const config = PROVIDER_CONFIG[provider];

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    config.fields.forEach((f) => {
      initial[f.key] = '';
    });
    return initial;
  });

  const font: React.CSSProperties = {
    fontFamily: "'Geist Sans', sans-serif",
  };

  const handleSave = () => {
    // Credentials go straight to the kernel, which persists them in the OS
    // keyring (macOS Keychain / Windows Credential Manager / Linux Secret
    // Service). They are NOT written to localStorage — plaintext tokens in
    // the browser's storage is a real XSS foot-gun. The kernel's success
    // response drives the UI's connected-state via the 'hardware_connected'
    // message handled in useKernel.ts; setProviderConnected here is an
    // optimistic flip so the user sees immediate feedback.
    const hw = getHardware();
    if (hw) {
      hw.hardwareConnect(provider, values);
    }
    setProviderConnected(provider, true);
    onClose();
  };

  const allFilled = config.fields.every((f) => values[f.key].trim().length > 0);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 380,
          maxWidth: '90vw',
          background: colors.bgElevated,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px',
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, ...font }}>
            {config.label}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: colors.textDim,
              padding: 2,
              display: 'flex',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px' }}>
          <p
            style={{
              fontSize: 11,
              color: colors.textMuted,
              margin: '0 0 16px',
              lineHeight: 1.5,
              ...font,
            }}
          >
            {config.description}
          </p>

          {config.fields.map((field) => (
            <div key={field.key} style={{ marginBottom: 12 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 10,
                  fontWeight: 600,
                  color: colors.textMuted,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  marginBottom: 4,
                  ...font,
                }}
              >
                {field.label}
              </label>
              <input
                type={field.type || 'text'}
                value={values[field.key]}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                placeholder={field.placeholder}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  fontSize: 11,
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  color: colors.text,
                  outline: 'none',
                  boxSizing: 'border-box',
                  ...font,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = colors.accent;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = colors.border;
                }}
              />
            </div>
          ))}

          {config.helpText && (
            <p
              style={{
                fontSize: 10,
                color: colors.textDim,
                margin: '0 0 12px',
                ...font,
              }}
            >
              {config.helpUrl ? (
                <span
                  style={{ color: colors.accent, cursor: 'pointer' }}
                  onClick={() => window.open(config.helpUrl, '_blank')}
                >
                  {config.helpText}
                </span>
              ) : (
                config.helpText
              )}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 16px',
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px',
              fontSize: 11,
              borderRadius: 4,
              border: `1px solid ${colors.border}`,
              background: 'transparent',
              color: colors.textMuted,
              cursor: 'pointer',
              ...font,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!allFilled}
            style={{
              padding: '6px 14px',
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 4,
              border: 'none',
              background: allFilled ? colors.accent : colors.borderStrong,
              color: allFilled ? '#fff' : colors.textDim,
              cursor: allFilled ? 'pointer' : 'not-allowed',
              ...font,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
