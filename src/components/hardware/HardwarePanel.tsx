import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Play, Trash2 } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useEditorStore } from '../../stores/editorStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { BackendSelector } from './BackendSelector';
import { JobTracker } from './JobTracker';
import { ConnectivityMap } from './ConnectivityMap';
import { ResultsComparison } from './ResultsComparison';
import { CredentialSetup } from './CredentialSetup';
import type { HardwareProviderType, BackendInfo } from '../../types/hardware';

/* ── Section (local copy matching SettingsPanel pattern) ── */

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const colors = useThemeStore((s) => s.colors);
  const Icon = open ? ChevronDown : ChevronRight;

  return (
    <div style={{ borderBottom: `1px solid ${colors.border}` }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: colors.textMuted,
        }}
      >
        <Icon size={12} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          {title}
        </span>
      </button>
      <div
        style={{
          overflow: 'hidden',
          maxHeight: open ? 800 : 0,
          transition: 'max-height 0.25s ease',
        }}
      >
        <div style={{ padding: '0 12px 10px' }}>{children}</div>
      </div>
    </div>
  );
}

/* ── Provider Labels ── */

const PROVIDER_LABELS: Record<HardwareProviderType, string> = {
  ibm: 'IBM Quantum',
  google: 'Google Quantum AI',
  ionq: 'IonQ',
  nvidia: 'NVIDIA CUDA-Q',
  braket: 'AWS Braket',
  azure: 'Azure Quantum',
  quantinuum: 'Quantinuum',
  xanadu: 'Xanadu',
  dwave: 'D-Wave',
  simulator: 'Local Simulator',
};

// Providers whose kernel adapters are stubs (raise NotImplementedError)
const STUB_PROVIDERS: ReadonlySet<HardwareProviderType> = new Set(['google', 'xanadu', 'dwave']);

/* ── Mock backends for demo ── */

const MOCK_BACKENDS: BackendInfo[] = [
  {
    name: 'ibm_brisbane',
    provider: 'ibm',
    qubitCount: 127,
    connectivity: [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
    ],
    queueLength: 12,
    averageErrorRate: 0.0032,
    gateSet: ['CX', 'ID', 'RZ', 'SX', 'X'],
    status: 'online',
  },
  {
    name: 'ibm_osaka',
    provider: 'ibm',
    qubitCount: 127,
    connectivity: [
      [0, 1], [1, 2], [2, 3],
      [0, 4], [4, 5], [5, 6],
    ],
    queueLength: 3,
    averageErrorRate: 0.0028,
    gateSet: ['CX', 'ID', 'RZ', 'SX', 'X'],
    status: 'online',
  },
  {
    name: 'aer_simulator',
    provider: 'simulator',
    qubitCount: 32,
    connectivity: [],
    queueLength: 0,
    averageErrorRate: 0,
    gateSet: ['All'],
    status: 'online',
  },
];

/* ── Main HardwarePanel ── */

export function HardwarePanel() {
  const colors = useThemeStore((s) => s.colors);
  const providers = useHardwareStore((s) => s.providers);
  const backends = useHardwareStore((s) => s.backends);
  const selectedBackend = useHardwareStore((s) => s.selectedBackend);
  const jobs = useHardwareStore((s) => s.jobs);
  const results = useHardwareStore((s) => s.results);
  const showCredentialSetup = useHardwareStore((s) => s.showCredentialSetup);
  const setBackends = useHardwareStore((s) => s.setBackends);
  const selectBackend = useHardwareStore((s) => s.selectBackend);
  const addJob = useHardwareStore((s) => s.addJob);
  const clearJobs = useHardwareStore((s) => s.clearJobs);
  const setShowCredentialSetup = useHardwareStore((s) => s.setShowCredentialSetup);

  const code = useEditorStore((s) => s.code);
  const shots = useSimulationStore((s) => s.shots);
  const simResult = useSimulationStore((s) => s.result);

  const anyConnected = providers.some((p) => p.connected);

  // Populate backends from connected providers (use mocks for now)
  const availableBackends =
    backends.length > 0
      ? backends
      : MOCK_BACKENDS.filter((b) =>
          providers.some((p) => p.name === b.provider && p.connected)
        );

  // If store backends are empty but we have mocks, set them
  if (backends.length === 0 && availableBackends.length > 0) {
    // Use setTimeout to avoid setState during render
    setTimeout(() => setBackends(availableBackends), 0);
  }

  const selectedBackendInfo = availableBackends.find((b) => b.name === selectedBackend);

  const handleRunOnHardware = useCallback(() => {
    if (!selectedBackend || !code) return;

    const job = {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      provider: selectedBackendInfo?.provider ?? 'simulator',
      backend: selectedBackend,
      submittedAt: new Date().toISOString(),
      status: 'queued' as const,
      queuePosition: selectedBackendInfo?.queueLength ?? null,
      shots,
    };

    addJob(job);
  }, [selectedBackend, code, selectedBackendInfo, shots, addJob]);

  // Get simulator probabilities for comparison
  const simProbabilities = simResult?.probabilities ?? null;
  // Get the latest completed hardware job result for comparison
  const latestCompleteJob = jobs.find((j) => j.status === 'complete');
  const hwProbabilities = latestCompleteJob
    ? results[latestCompleteJob.id]?.probabilities ?? null
    : null;

  const font: React.CSSProperties = {
    fontFamily: "'Geist Sans', sans-serif",
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* ── Providers ── */}
        <Section title="Providers" defaultOpen>
          {providers.map((p) => (
            <div
              key={p.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '5px 0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: p.connected ? colors.success : colors.textDim,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 11, color: colors.text, ...font }}>
                  {PROVIDER_LABELS[p.name]}
                </span>
              </div>

              {!p.connected && p.name !== 'simulator' && STUB_PROVIDERS.has(p.name) && (
                <span
                  style={{
                    fontSize: 9,
                    color: colors.textDim,
                    fontStyle: 'italic',
                    ...font,
                  }}
                >
                  Coming Soon
                </span>
              )}

              {!p.connected && p.name !== 'simulator' && !STUB_PROVIDERS.has(p.name) && (
                <button
                  onClick={() => setShowCredentialSetup(p.name)}
                  style={{
                    fontSize: 10,
                    color: colors.accent,
                    background: 'transparent',
                    border: `1px solid ${colors.accent}40`,
                    borderRadius: 3,
                    padding: '2px 8px',
                    cursor: 'pointer',
                    ...font,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = `${colors.accent}15`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  Configure
                </button>
              )}

              {p.connected && (
                <span style={{ fontSize: 10, color: colors.success, ...font }}>
                  Connected
                </span>
              )}
            </div>
          ))}
        </Section>

        {/* ── Backend Selection ── */}
        {anyConnected && (
          <Section title="Backend" defaultOpen>
            <BackendSelector
              backends={availableBackends}
              selected={selectedBackend}
              onSelect={selectBackend}
            />

            {/* Selected backend detail card */}
            {selectedBackendInfo && (
              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: colors.text, ...font }}>
                    {selectedBackendInfo.name}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      padding: '1px 5px',
                      borderRadius: 3,
                      background:
                        selectedBackendInfo.status === 'online'
                          ? `${colors.success}20`
                          : `${colors.error}20`,
                      color:
                        selectedBackendInfo.status === 'online'
                          ? colors.success
                          : colors.error,
                      ...font,
                    }}
                  >
                    {selectedBackendInfo.status}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div>
                    <div style={{ fontSize: 9, color: colors.textDim, textTransform: 'uppercase', ...font }}>
                      Qubits
                    </div>
                    <div style={{ fontSize: 12, color: colors.text, fontWeight: 600, ...font }}>
                      {selectedBackendInfo.qubitCount}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: colors.textDim, textTransform: 'uppercase', ...font }}>
                      Queue
                    </div>
                    <div style={{ fontSize: 12, color: colors.text, fontWeight: 600, ...font }}>
                      {selectedBackendInfo.queueLength}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: colors.textDim, textTransform: 'uppercase', ...font }}>
                      Error Rate
                    </div>
                    <div style={{ fontSize: 12, color: colors.text, fontWeight: 600, ...font }}>
                      {(selectedBackendInfo.averageErrorRate * 100).toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: colors.textDim, textTransform: 'uppercase', ...font }}>
                      Provider
                    </div>
                    <div style={{ fontSize: 12, color: colors.accent, fontWeight: 600, ...font }}>
                      {PROVIDER_LABELS[selectedBackendInfo.provider]}
                    </div>
                  </div>
                </div>

                {/* Gate set pills */}
                <div style={{ marginTop: 8 }}>
                  <div
                    style={{
                      fontSize: 9,
                      color: colors.textDim,
                      textTransform: 'uppercase',
                      marginBottom: 4,
                      ...font,
                    }}
                  >
                    Gate Set
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {selectedBackendInfo.gateSet.map((gate) => (
                      <span
                        key={gate}
                        style={{
                          fontSize: 9,
                          padding: '1px 6px',
                          borderRadius: 3,
                          background: `${colors.accent}15`,
                          color: colors.accent,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {gate}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Run button */}
            <button
              onClick={handleRunOnHardware}
              disabled={!selectedBackend}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                marginTop: 10,
                padding: '8px 0',
                borderRadius: 4,
                border: 'none',
                background: selectedBackend ? colors.accent : colors.borderStrong,
                color: selectedBackend ? '#fff' : colors.textDim,
                fontSize: 11,
                fontWeight: 600,
                cursor: selectedBackend ? 'pointer' : 'not-allowed',
                transition: 'opacity 0.15s',
                ...font,
              }}
              onMouseEnter={(e) => {
                if (selectedBackend) e.currentTarget.style.opacity = '0.85';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
            >
              <Play size={12} />
              Run on Hardware
            </button>
          </Section>
        )}

        {/* ── Connectivity Map ── */}
        {selectedBackendInfo && selectedBackendInfo.connectivity.length > 0 && (
          <Section title="Connectivity">
            <ConnectivityMap
              connectivity={selectedBackendInfo.connectivity}
              qubitCount={Math.min(selectedBackendInfo.qubitCount, 16)}
            />
          </Section>
        )}

        {/* ── Jobs ── */}
        <Section title="Jobs" defaultOpen={jobs.length > 0}>
          <JobTracker jobs={jobs} results={results} />
          {jobs.length > 0 && (
            <button
              onClick={clearJobs}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                width: '100%',
                marginTop: 8,
                padding: '5px 0',
                fontSize: 10,
                color: colors.textDim,
                background: 'transparent',
                border: `1px solid ${colors.border}`,
                borderRadius: 3,
                cursor: 'pointer',
                ...font,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = colors.error;
                e.currentTarget.style.color = colors.error;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.color = colors.textDim;
              }}
            >
              <Trash2 size={10} />
              Clear Jobs
            </button>
          )}
        </Section>

        {/* ── Results Comparison ── */}
        <Section title="Sim vs Hardware">
          <ResultsComparison
            simulatorResult={simProbabilities}
            hardwareResult={hwProbabilities}
          />
        </Section>
      </div>

      {/* ── Credential Setup Modal ── */}
      {showCredentialSetup && (
        <CredentialSetup
          provider={showCredentialSetup}
          onClose={() => setShowCredentialSetup(null)}
        />
      )}
    </div>
  );
}
