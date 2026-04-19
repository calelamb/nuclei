import { useState } from 'react';
import { X } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useHardwareStore } from '../../stores/hardwareStore';
import type { HardwareProviderType } from '../../types/hardware';

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
    // Store credentials in localStorage
    localStorage.setItem(`nuclei-hardware-${provider}`, JSON.stringify(values));
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
