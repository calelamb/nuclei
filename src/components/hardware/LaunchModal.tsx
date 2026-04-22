import { useState, useEffect, useMemo } from 'react';
import { Rocket, ChevronLeft, X, Clock, Cpu, DollarSign, KeyRound, FileCode } from 'lucide-react';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useEditorStore } from '../../stores/editorStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useThemeStore } from '../../stores/themeStore';
import { usePlatform } from '../../platform/PlatformProvider';
import { getHardware } from '../../App';
import { ProviderLogo } from './ProviderLogo';
import type { HardwareProviderType, BackendInfo } from '../../types/hardware';

interface ProviderMeta {
  name: HardwareProviderType;
  label: string;
  tagline: string;
  pricing: 'Free' | 'Credits' | 'Paid' | 'Local';
  tech: string;
  comingSoon?: boolean;
}

const PROVIDERS: ProviderMeta[] = [
  {
    name: 'ibm',
    label: 'IBM Quantum',
    tagline: 'Superconducting qubits · up to 127 qubits',
    pricing: 'Free',
    tech: 'Superconducting',
  },
  {
    name: 'ionq',
    label: 'IonQ',
    tagline: 'Trapped-ion · all-to-all connectivity',
    pricing: 'Paid',
    tech: 'Trapped ion',
  },
  {
    name: 'quantinuum',
    label: 'Quantinuum',
    tagline: 'Trapped-ion · highest fidelity · H1/H2 family',
    pricing: 'Paid',
    tech: 'Trapped ion',
  },
  {
    name: 'braket',
    label: 'AWS Braket',
    tagline: 'Aggregator · IonQ, Rigetti, QuEra, IQM, OQC, Pasqal',
    pricing: 'Paid',
    tech: 'Aggregator',
  },
  {
    name: 'azure',
    label: 'Azure Quantum',
    tagline: 'Aggregator · Quantinuum, IonQ, Rigetti, Pasqal, IQM',
    pricing: 'Credits',
    tech: 'Aggregator',
  },
  {
    name: 'nvidia',
    label: 'NVIDIA CUDA-Q',
    tagline: 'GPU-accelerated simulation · up to 34 qubits',
    pricing: 'Local',
    tech: 'GPU simulator',
  },
  {
    name: 'google',
    label: 'Google Quantum AI',
    tagline: 'Sycamore family · research access only',
    pricing: 'Credits',
    tech: 'Superconducting',
    comingSoon: true,
  },
  {
    name: 'xanadu',
    label: 'Xanadu',
    tagline: 'Photonic · boson sampling · different circuit model',
    pricing: 'Credits',
    tech: 'Photonic',
    comingSoon: true,
  },
  {
    name: 'dwave',
    label: 'D-Wave',
    tagline: 'Quantum annealer · QUBO / Ising · not gate-model',
    pricing: 'Credits',
    tech: 'Annealer',
    comingSoon: true,
  },
  {
    name: 'simulator',
    label: 'Local Simulator',
    tagline: 'Instant · runs in Nuclei · no account needed',
    pricing: 'Local',
    tech: 'Pyodide / Qiskit Aer',
  },
];

// Single-field BYOK config per provider. Deliberately minimal — the full
// multi-field credential form still lives in CredentialSetup.tsx for
// aggregators that need multiple values (AWS keys, Azure workspace IDs).
// Here we collect just the primary token inline to keep the flow fast.
// Providers not in this map need no credentials (simulator, nvidia) or
// require the richer CredentialSetup flow.
const INLINE_KEY_FIELD: Partial<Record<HardwareProviderType, { label: string; placeholder: string; helpText?: string; helpUrl?: string }>> = {
  ibm: {
    label: 'IBM Quantum API token',
    placeholder: 'Paste your IBM Quantum token',
    helpText: 'Get a free token at quantum.ibm.com',
    helpUrl: 'https://quantum.ibm.com',
  },
  ionq: {
    label: 'IonQ API key',
    placeholder: 'Paste your IonQ API key',
    helpText: 'Get an API key at cloud.ionq.com',
    helpUrl: 'https://cloud.ionq.com',
  },
  quantinuum: {
    label: 'Quantinuum Nexus token',
    placeholder: 'Paste your Nexus token',
    helpText: 'Request access at nexus.quantinuum.com',
    helpUrl: 'https://nexus.quantinuum.com',
  },
};

// For aggregators, show a small sub-provider chip row at the top of Act 2
// so students understand "this one bundle includes X, Y, Z." Clicking a
// chip filters the backend list to that sub-provider only. 'All' resets.
const AGGREGATOR_SUB_PROVIDERS: Partial<Record<HardwareProviderType, string[]>> = {
  braket: ['All', 'IonQ', 'Rigetti', 'QuEra', 'IQM', 'OQC', 'Simulator'],
  azure: ['All', 'Quantinuum', 'IonQ', 'Rigetti', 'Pasqal', 'IQM'],
};

// Mock backends the modal can display per-provider when the real kernel
// hasn't populated live data yet. Keeps the picker useful in demos even
// without credentials configured.
const MOCK_BACKENDS: Record<HardwareProviderType, BackendInfo[]> = {
  ibm: [
    { name: 'ibm_brisbane', provider: 'ibm', qubitCount: 127, connectivity: [], queueLength: 12, averageErrorRate: 0.0032, gateSet: ['CX', 'RZ', 'SX', 'X'], status: 'online' },
    { name: 'ibm_osaka', provider: 'ibm', qubitCount: 127, connectivity: [], queueLength: 3, averageErrorRate: 0.0028, gateSet: ['CX', 'RZ', 'SX', 'X'], status: 'online' },
  ],
  ionq: [
    { name: 'ionq_simulator', provider: 'ionq', qubitCount: 29, connectivity: [], queueLength: 0, averageErrorRate: 0.0, gateSet: ['All'], status: 'online' },
    { name: 'ionq_aria', provider: 'ionq', qubitCount: 25, connectivity: [], queueLength: 4, averageErrorRate: 0.0045, gateSet: ['CNOT', 'RX', 'RZ'], status: 'online' },
  ],
  nvidia: [
    { name: 'nvidia', provider: 'nvidia', qubitCount: 32, connectivity: [], queueLength: 0, averageErrorRate: 0, gateSet: ['All'], status: 'online' },
    { name: 'nvidia-fp64', provider: 'nvidia', qubitCount: 30, connectivity: [], queueLength: 0, averageErrorRate: 0, gateSet: ['All'], status: 'online' },
    { name: 'nvidia-mgpu', provider: 'nvidia', qubitCount: 34, connectivity: [], queueLength: 0, averageErrorRate: 0, gateSet: ['All'], status: 'online' },
  ],
  google: [],
  quantinuum: [
    { name: 'H1-1', provider: 'quantinuum', qubitCount: 20, connectivity: [], queueLength: 2, averageErrorRate: 0.0012, gateSet: ['RZZ', 'PhasedX'], status: 'online' },
    { name: 'H2-1', provider: 'quantinuum', qubitCount: 56, connectivity: [], queueLength: 6, averageErrorRate: 0.0008, gateSet: ['RZZ', 'PhasedX'], status: 'online' },
    { name: 'H1-1E', provider: 'quantinuum', qubitCount: 20, connectivity: [], queueLength: 0, averageErrorRate: 0, gateSet: ['Emulator'], status: 'online' },
  ],
  braket: [
    { name: 'IonQ Aria-1 (Braket)', provider: 'braket', qubitCount: 25, connectivity: [], queueLength: 3, averageErrorRate: 0.004, gateSet: ['CNOT', 'RX', 'RZ'], status: 'online' },
    { name: 'Rigetti Ankaa-2 (Braket)', provider: 'braket', qubitCount: 84, connectivity: [], queueLength: 1, averageErrorRate: 0.012, gateSet: ['CZ', 'RX', 'RZ'], status: 'online' },
    { name: 'QuEra Aquila (Braket)', provider: 'braket', qubitCount: 256, connectivity: [], queueLength: 0, averageErrorRate: 0, gateSet: ['Analog'], status: 'online' },
    { name: 'IQM Garnet (Braket)', provider: 'braket', qubitCount: 20, connectivity: [], queueLength: 1, averageErrorRate: 0.006, gateSet: ['CZ', 'PRX'], status: 'online' },
    { name: 'OQC Lucy (Braket)', provider: 'braket', qubitCount: 8, connectivity: [], queueLength: 0, averageErrorRate: 0.015, gateSet: ['CZ', 'RX'], status: 'online' },
    { name: 'Braket SV1 Simulator', provider: 'braket', qubitCount: 34, connectivity: [], queueLength: 0, averageErrorRate: 0, gateSet: ['All'], status: 'online' },
  ],
  azure: [
    { name: 'quantinuum.qpu.h1-1', provider: 'azure', qubitCount: 20, connectivity: [], queueLength: 2, averageErrorRate: 0.0012, gateSet: [], status: 'online' },
    { name: 'quantinuum.sim.h1-1sc', provider: 'azure', qubitCount: 20, connectivity: [], queueLength: 0, averageErrorRate: 0, gateSet: ['Emulator'], status: 'online' },
    { name: 'ionq.qpu.aria-1', provider: 'azure', qubitCount: 25, connectivity: [], queueLength: 4, averageErrorRate: 0.0045, gateSet: [], status: 'online' },
    { name: 'rigetti.qpu.ankaa-2', provider: 'azure', qubitCount: 84, connectivity: [], queueLength: 1, averageErrorRate: 0.012, gateSet: [], status: 'online' },
    { name: 'pasqal.qpu.fresnel', provider: 'azure', qubitCount: 100, connectivity: [], queueLength: 0, averageErrorRate: 0, gateSet: ['Analog'], status: 'online' },
    { name: 'iqm.qpu.garnet', provider: 'azure', qubitCount: 20, connectivity: [], queueLength: 1, averageErrorRate: 0.006, gateSet: [], status: 'online' },
  ],
  xanadu: [],
  dwave: [],
  simulator: [
    { name: 'aer_simulator', provider: 'simulator', qubitCount: 32, connectivity: [], queueLength: 0, averageErrorRate: 0, gateSet: ['All'], status: 'online' },
  ],
};

export function LaunchModal() {
  const open = useHardwareStore((s) => s.launchOpen);
  const closeLaunch = useHardwareStore((s) => s.closeLaunch);
  const selectedProvider = useHardwareStore((s) => s.selectedProvider);
  const selectProvider = useHardwareStore((s) => s.selectProvider);
  const selectedBackend = useHardwareStore((s) => s.selectedBackend);
  const selectBackend = useHardwareStore((s) => s.selectBackend);
  // Jobs are no longer added optimistically — we only record them when the
  // kernel confirms `hardware_job_submitted`. Keeps the UI honest.
  const backends = useHardwareStore((s) => s.backends);
  const setShowCredentialSetup = useHardwareStore((s) => s.setShowCredentialSetup);
  const providers = useHardwareStore((s) => s.providers);

  const shots = useSimulationStore((s) => s.shots);
  const setShots = useSimulationStore((s) => s.setShots);
  const code = useEditorStore((s) => s.code);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);

  const stagedSubmission = useHardwareStore((s) => s.stagedSubmission);
  const selectedSubProvider = useHardwareStore((s) => s.selectedSubProvider);
  const selectSubProvider = useHardwareStore((s) => s.selectSubProvider);
  const credentials = useHardwareStore((s) => s.credentials);
  const setProviderCredentials = useHardwareStore((s) => s.setProviderCredentials);
  const connectingProvider = useHardwareStore((s) => s.connectingProvider);
  const connectionErrors = useHardwareStore((s) => s.connectionErrors);
  const platform = usePlatform();
  const isWeb = platform.getPlatform() === 'web';

  const [localShots, setLocalShots] = useState(shots || 1024);
  const [keyDraft, setKeyDraft] = useState('');
  useEffect(() => {
    if (open) queueMicrotask(() => setLocalShots(shots || 1024));
  }, [open, shots]);
  // Clear the in-progress key input whenever we switch provider.
  useEffect(() => {
    queueMicrotask(() => setKeyDraft(''));
  }, [selectedProvider]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLaunch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeLaunch]);

  const providerBackends = useMemo<BackendInfo[]>(() => {
    if (!selectedProvider) return [];
    const live = backends.filter((b) => b.provider === selectedProvider);
    const all = live.length > 0 ? live : MOCK_BACKENDS[selectedProvider] ?? [];
    // Aggregator filtering: if the user picked a sub-provider chip (e.g.
    // "Rigetti" while viewing Braket), keep only backends whose name starts
    // with that sub-provider. Case-insensitive, "All" disables the filter.
    if (
      selectedSubProvider &&
      selectedSubProvider !== 'All' &&
      (selectedProvider === 'braket' || selectedProvider === 'azure')
    ) {
      const key = selectedSubProvider.toLowerCase();
      return all.filter((b) => b.name.toLowerCase().includes(key));
    }
    return all;
  }, [selectedProvider, selectedSubProvider, backends]);

  if (!open) return null;

  const handlePickProvider = (p: ProviderMeta) => {
    if (p.comingSoon) return;
    selectProvider(p.name);
  };

  const handleBack = () => {
    selectProvider(null);
    selectBackend(null);
  };

  const handleSubmit = () => {
    if (!selectedProvider || !selectedBackend) return;
    const providerState = providers.find((p) => p.name === selectedProvider);
    const isCredFree = selectedProvider === 'simulator' || selectedProvider === 'nvidia';
    const connected = providerState?.connected ?? false;
    // Hard gate: if the provider needs credentials and isn't actually
    // connected (inline BYOK wasn't filled, or the multi-field credential
    // form was never opened), refuse to submit. For aggregators we still
    // route to the richer CredentialSetup flow.
    if (!connected && !isCredFree) {
      if (INLINE_KEY_FIELD[selectedProvider]) {
        // Inline BYOK — the user hasn't connected yet. Don't submit a
        // fake job; surface the state via the inline error field above.
        useHardwareStore.getState().setConnectionError(
          selectedProvider,
          'Connect a token before launching.',
        );
        return;
      }
      closeLaunch();
      setShowCredentialSetup(selectedProvider);
      return;
    }

    // Actually send the code to the kernel for real hardware submission.
    const hw = getHardware();
    const codeToSubmit = stagedSubmission?.content ?? code;
    if (!codeToSubmit.trim()) return;

    setShots(localShots);
    if (hw && !isWeb) {
      const ok = hw.hardwareSubmit(
        selectedProvider,
        selectedBackend,
        codeToSubmit,
        localShots,
      );
      if (!ok) {
        useHardwareStore.getState().setConnectionError(
          selectedProvider,
          'Kernel not connected. Restart the app.',
        );
        return;
      }
      // The actual addJob happens when the kernel returns
      // `hardware_job_submitted` with a real job id. We don't fake one here.
    } else if (isWeb) {
      useHardwareStore.getState().setConnectionError(
        selectedProvider,
        'Hardware submission requires the desktop app — download from getnuclei.dev.',
      );
      return;
    }
    closeLaunch();
  };

  const selectedProviderMeta = PROVIDERS.find((p) => p.name === selectedProvider);
  const selectedBackendInfo = providerBackends.find((b) => b.name === selectedBackend);

  const pricingColor = (pricing: ProviderMeta['pricing']) =>
    pricing === 'Free' || pricing === 'Local'
      ? colors.success
      : pricing === 'Credits'
        ? colors.warning
        : colors.accentLight;

  return (
    <>
      <div
        role="presentation"
        onClick={closeLaunch}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(4px)',
          zIndex: 9998,
        }}
      />
      <div
        role="dialog"
        aria-label="Launch to quantum hardware"
        style={{
          position: 'fixed',
          top: '8vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(1040px, 94vw)',
          maxHeight: '84vh',
          background: colors.bgPanel,
          border: `1px solid ${colors.borderStrong}`,
          borderRadius: 16,
          boxShadow: shadow.lg,
          padding: 0,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 20px',
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          {selectedProvider && (
            <button
              onClick={handleBack}
              aria-label="Back"
              style={{
                background: 'transparent',
                border: `1px solid ${colors.border}`,
                color: colors.textMuted,
                borderRadius: 8,
                padding: '4px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: "'Geist Sans', sans-serif",
              }}
            >
              <ChevronLeft size={12} /> Back
            </button>
          )}
          <Rocket size={16} style={{ color: colors.accent }} />
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: colors.text,
            }}
          >
            {selectedProvider
              ? `Launch to ${selectedProviderMeta?.label ?? ''}`
              : 'Launch your circuit'}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={closeLaunch}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: colors.textDim,
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 6,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = colors.bgElevated;
              e.currentTarget.style.color = colors.text;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = colors.textDim;
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ overflow: 'auto', flex: 1 }}>
          {!selectedProvider ? (
            <div style={{ padding: 20 }}>
              <p
                style={{
                  color: colors.textMuted,
                  fontSize: 12,
                  lineHeight: 1.6,
                  marginTop: 0,
                  marginBottom: 18,
                }}
              >
                Pick where to run your circuit. Real hardware runs take minutes to
                hours depending on queue; simulators run instantly.
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 14,
                }}
              >
                {PROVIDERS.map((p) => {
                  const providerState = providers.find((pp) => pp.name === p.name);
                  const connected = providerState?.connected ?? p.name === 'simulator';
                  const disabled = p.comingSoon;
                  return (
                    <button
                      key={p.name}
                      onClick={() => handlePickProvider(p)}
                      disabled={disabled}
                      style={{
                        textAlign: 'left',
                        background: disabled ? `${colors.textDim}08` : colors.bgElevated,
                        border: `1px solid ${disabled ? colors.border : colors.border}`,
                        borderRadius: 14,
                        padding: 16,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        color: colors.text,
                        fontFamily: "'Geist Sans', sans-serif",
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        minHeight: 180,
                        transition: 'transform 150ms ease, border-color 120ms ease, background 120ms ease',
                        opacity: disabled ? 0.55 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!disabled) {
                          e.currentTarget.style.borderColor = colors.accent;
                          e.currentTarget.style.transform = 'translateY(-2px)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = colors.border;
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 12,
                            background: `${colors.accent}14`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: colors.accentLight,
                          }}
                        >
                          <ProviderLogo provider={p.name} size={32} />
                        </div>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: pricingColor(p.pricing),
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                            padding: '3px 8px',
                            borderRadius: 999,
                            background: `${pricingColor(p.pricing)}15`,
                          }}
                        >
                          {p.pricing}
                        </span>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
                          {p.label}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: colors.textMuted,
                            marginTop: 2,
                            lineHeight: 1.5,
                          }}
                        >
                          {p.tagline}
                        </div>
                      </div>
                      <div style={{ flex: 1 }} />
                      <div
                        style={{
                          fontSize: 10,
                          color: colors.textDim,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                        }}
                      >
                        {p.comingSoon ? (
                          <span style={{ color: colors.textDim }}>Coming soon</span>
                        ) : connected || p.name === 'simulator' || p.name === 'nvidia' ? (
                          <>
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: colors.success,
                              }}
                            />
                            Ready
                          </>
                        ) : (
                          <>
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: colors.warning,
                              }}
                            />
                            Connect to enable
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Staged file indicator */}
              {stagedSubmission && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    background: `${colors.success}10`,
                    border: `1px solid ${colors.success}30`,
                    borderRadius: 8,
                    fontSize: 11,
                    color: colors.text,
                    fontFamily: "'Geist Sans', sans-serif",
                  }}
                >
                  <FileCode size={12} style={{ color: colors.success }} />
                  <span style={{ color: colors.textDim }}>Submitting:</span>
                  <span style={{ fontWeight: 600 }}>{stagedSubmission.fileName}</span>
                </div>
              )}

              {/* Inline BYOK — shown when provider needs creds and isn't
                 connected yet. Intentionally tucked above the backend list
                 so the flow is a single continuous column rather than a
                 separate modal. */}
              {selectedProvider && INLINE_KEY_FIELD[selectedProvider] && !(providers.find((p) => p.name === selectedProvider)?.connected) && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: '10px 12px',
                    background: colors.bgElevated,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 10,
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      color: colors.textDim,
                      fontFamily: "'Geist Sans', sans-serif",
                    }}
                  >
                    <KeyRound size={11} />
                    {INLINE_KEY_FIELD[selectedProvider]?.label}
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="password"
                      value={keyDraft}
                      onChange={(e) => setKeyDraft(e.target.value)}
                      placeholder={INLINE_KEY_FIELD[selectedProvider]?.placeholder}
                      disabled={connectingProvider === selectedProvider}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && keyDraft.trim() && selectedProvider) {
                          e.preventDefault();
                          setProviderCredentials(selectedProvider, { token: keyDraft.trim() });
                          const hw = getHardware();
                          if (hw) hw.hardwareConnect(selectedProvider, { token: keyDraft.trim() });
                        }
                      }}
                      style={{
                        flex: 1,
                        background: colors.bg,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 6,
                        color: colors.text,
                        padding: '6px 10px',
                        fontSize: 12,
                        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                        outline: 'none',
                      }}
                    />
                    <button
                      onClick={() => {
                        if (keyDraft.trim() && selectedProvider) {
                          setProviderCredentials(selectedProvider, { token: keyDraft.trim() });
                          const hw = getHardware();
                          if (hw) hw.hardwareConnect(selectedProvider, { token: keyDraft.trim() });
                        }
                      }}
                      disabled={!keyDraft.trim() || connectingProvider === selectedProvider}
                      style={{
                        background: keyDraft.trim() ? colors.accent : colors.bgElevated,
                        color: keyDraft.trim() ? '#0a0f1a' : colors.textDim,
                        border: 'none',
                        borderRadius: 6,
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: "'Geist Sans', sans-serif",
                        cursor: keyDraft.trim() ? 'pointer' : 'default',
                      }}
                    >
                      {connectingProvider === selectedProvider ? 'Connecting…' : 'Connect'}
                    </button>
                  </div>
                  {selectedProvider && connectionErrors[selectedProvider] && (
                    <div style={{ fontSize: 10, color: colors.error, fontFamily: "'Geist Sans', sans-serif" }}>
                      {connectionErrors[selectedProvider]}
                    </div>
                  )}
                  {INLINE_KEY_FIELD[selectedProvider]?.helpText && (
                    <a
                      href={INLINE_KEY_FIELD[selectedProvider]?.helpUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: 10,
                        color: colors.accentLight,
                        textDecoration: 'none',
                        fontFamily: "'Geist Sans', sans-serif",
                      }}
                    >
                      {INLINE_KEY_FIELD[selectedProvider]?.helpText} ↗
                    </a>
                  )}
                </div>
              )}
              {selectedProvider && credentials[selectedProvider]?.token && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 10,
                    color: colors.success,
                    fontFamily: "'Geist Sans', sans-serif",
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  <KeyRound size={10} /> Token saved — ready to launch
                </div>
              )}

              {/* Aggregator sub-provider chips */}
              {selectedProvider && AGGREGATOR_SUB_PROVIDERS[selectedProvider] && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {AGGREGATOR_SUB_PROVIDERS[selectedProvider]!.map((sub) => {
                    const isActive = (selectedSubProvider ?? 'All') === sub;
                    return (
                      <button
                        key={sub}
                        onClick={() => selectSubProvider(sub === 'All' ? null : sub)}
                        style={{
                          padding: '3px 10px',
                          background: isActive ? colors.accent : 'transparent',
                          color: isActive ? '#0a0f1a' : colors.textMuted,
                          border: `1px solid ${isActive ? colors.accent : colors.border}`,
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 500,
                          fontFamily: "'Geist Sans', sans-serif",
                          cursor: 'pointer',
                        }}
                      >
                        {sub}
                      </button>
                    );
                  })}
                </div>
              )}

              {providerBackends.length === 0 ? (
                <div
                  style={{
                    padding: 16,
                    border: `1px dashed ${colors.border}`,
                    borderRadius: 12,
                    color: colors.textMuted,
                    fontSize: 12,
                    lineHeight: 1.6,
                  }}
                >
                  No backends available for this provider yet. Connect your
                  credentials to fetch live backends.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {providerBackends.map((b) => {
                    const isActive = b.name === selectedBackend;
                    const queueLabel =
                      b.queueLength === 0
                        ? 'No queue'
                        : `${b.queueLength} job${b.queueLength === 1 ? '' : 's'} ahead`;
                    const errPct = (b.averageErrorRate * 100).toFixed(2);
                    const errColor =
                      b.averageErrorRate < 0.005
                        ? colors.success
                        : b.averageErrorRate < 0.02
                          ? colors.warning
                          : colors.error;
                    return (
                      <button
                        key={b.name}
                        onClick={() => selectBackend(b.name)}
                        style={{
                          textAlign: 'left',
                          background: isActive ? `${colors.accent}12` : colors.bgElevated,
                          border: `1px solid ${isActive ? colors.accent : colors.border}`,
                          borderRadius: 10,
                          padding: '12px 14px',
                          cursor: 'pointer',
                          color: colors.text,
                          fontFamily: "'Geist Sans', sans-serif",
                          display: 'grid',
                          gridTemplateColumns: '1fr auto auto auto',
                          gap: 16,
                          alignItems: 'center',
                          transition: 'border-color 120ms ease, background 120ms ease',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{b.name}</div>
                          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                            {b.qubitCount} qubits · {b.gateSet.slice(0, 3).join(', ')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: colors.textDim }}>
                          <Cpu size={12} /> {b.qubitCount}q
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: colors.textDim }}>
                          <Clock size={12} /> {queueLabel}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: `${errColor}20`,
                            color: errColor,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                          }}
                        >
                          {b.averageErrorRate === 0 ? 'Ideal' : `±${errPct}%`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Shot count + submit */}
              <div
                style={{
                  borderTop: `1px solid ${colors.border}`,
                  paddingTop: 16,
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 16,
                  alignItems: 'center',
                }}
              >
                <div>
                  <label
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      color: colors.textDim,
                      display: 'block',
                      marginBottom: 6,
                    }}
                  >
                    Shots
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={localShots}
                    onChange={(e) => setLocalShots(Math.max(1, Math.min(100000, Number(e.target.value) || 0)))}
                    style={{
                      background: colors.bgElevated,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 8,
                      color: colors.text,
                      padding: '8px 12px',
                      fontSize: 13,
                      fontFamily: "'Geist Sans', sans-serif",
                      outline: 'none',
                      width: 140,
                    }}
                  />
                </div>
                <div style={{ textAlign: 'right', fontSize: 11, color: colors.textMuted }}>
                  {code.trim().length === 0 ? (
                    <span style={{ color: colors.warning }}>No code to submit.</span>
                  ) : !selectedBackendInfo ? (
                    'Pick a backend to continue.'
                  ) : (
                    <>
                      <DollarSign size={11} style={{ verticalAlign: -2, marginRight: 2 }} />
                      {selectedProviderMeta?.pricing === 'Paid'
                        ? 'Uses IonQ credits. See dashboard for pricing.'
                        : selectedProviderMeta?.pricing === 'Credits'
                          ? 'Uses free-tier credits.'
                          : 'No cost — runs locally / on free-tier hardware.'}
                    </>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={closeLaunch}
                  style={{
                    background: 'transparent',
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 10,
                    padding: '10px 16px',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: "'Geist Sans', sans-serif",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={(() => {
                    if (!selectedBackend) return true;
                    const srcCode = stagedSubmission?.content ?? code;
                    if (srcCode.trim().length === 0) return true;
                    // Providers that don't need credentials are always OK.
                    if (selectedProvider === 'simulator' || selectedProvider === 'nvidia') return false;
                    // Everything else must be actually connected.
                    const providerState = providers.find((p) => p.name === selectedProvider);
                    return !providerState?.connected;
                  })()}
                  style={{
                    background:
                      !selectedBackend || code.trim().length === 0
                        ? colors.bgElevated
                        : colors.accent,
                    color:
                      !selectedBackend || code.trim().length === 0
                        ? colors.textDim
                        : '#0a0f1a',
                    border: 'none',
                    borderRadius: 10,
                    padding: '10px 18px',
                    cursor: !selectedBackend || code.trim().length === 0 ? 'default' : 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "'Geist Sans', sans-serif",
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: shadow.sm,
                  }}
                >
                  <Rocket size={14} /> Launch
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
