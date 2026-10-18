import { Badge, Button, EmptyState, Select } from '../ui';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Download, Rocket, Trash2 } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useHardwareStore } from '../../stores/hardwareStore';
import { hasActiveJobForBackend } from '../../lib/hardwareJobs';
import { openExternal } from '../../lib/openExternal';
import { DESKTOP_DOWNLOAD_URL } from '../../config/docsLinks';
import { useFrameworksStore } from '../../stores/frameworksStore';
import { usePlatform } from '../../platform/PlatformProvider';
import { ProviderStatusBadge } from './ProviderStatusBadge';
import { providerNeedsToken, providerStatus } from './launchGating';
import { useSimulationStore } from '../../stores/simulationStore';
import { JobTracker } from './JobTracker';
import { ConnectivityMap } from './ConnectivityMap';
import { ResultsComparison } from './ResultsComparison';
import { CredentialSetup } from './CredentialSetup';
import type { HardwareProviderType } from '../../types/hardware';

import { TYPOGRAPHY } from '../../styles/tokens';
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
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            fontFamily: TYPOGRAPHY.fontSans,
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

/* ── Main HardwarePanel ── */

export function HardwarePanel() {
  const colors = useThemeStore((s) => s.colors);
  const providers = useHardwareStore((s) => s.providers);
  const backends = useHardwareStore((s) => s.backends);
  const selectedBackend = useHardwareStore((s) => s.selectedBackend);
  const jobs = useHardwareStore((s) => s.jobs);
  const results = useHardwareStore((s) => s.results);
  const showCredentialSetup = useHardwareStore((s) => s.showCredentialSetup);
  const selectBackend = useHardwareStore((s) => s.selectBackend);
  const clearJobs = useHardwareStore((s) => s.clearJobs);
  const setShowCredentialSetup = useHardwareStore((s) => s.setShowCredentialSetup);
  const openLaunch = useHardwareStore((s) => s.openLaunch);

  const simResult = useSimulationStore((s) => s.result);
  const isWeb = usePlatform().getPlatform() === 'web';
  const cudaqInstalled = useFrameworksStore((s) => s.status?.installed.includes('cuda-q') ?? false);

  const anyConnected = providers.some((p) => p.connected);

  const availableBackends = backends;
  const selectedBackendInfo = availableBackends.find((b) => b.name === selectedBackend);
  const backendBusy = hasActiveJobForBackend(jobs, selectedBackend ?? null);

  // Get simulator probabilities for comparison
  const simProbabilities = simResult?.probabilities ?? null;
  // Get the latest completed hardware job result for comparison
  const latestCompleteJob = jobs.find((j) => j.status === 'complete');
  const hwProbabilities = latestCompleteJob
    ? results[latestCompleteJob.id]?.probabilities ?? null
    : null;

  const font: React.CSSProperties = {
    fontFamily: TYPOGRAPHY.fontSans,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* ── Providers ── */}
        <Section title="Providers" defaultOpen>
          {isWeb && (
            <EmptyState
              icon={<Download size={20} />}
              title="Hardware runs need the desktop app"
              action={(
                <Button size="sm" variant="primary" onClick={() => { void openExternal(DESKTOP_DOWNLOAD_URL); }}>
                  Download Nuclei
                </Button>
              )}
            >
              Provider connections and job queues need the local kernel.
            </EmptyState>
          )}
          {providers.map((p) => {
            const status = providerStatus({ provider: p.name, connected: p.connected, isWeb, cudaqInstalled });
            return (
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
                <span style={{ fontSize: 11, color: colors.text, ...font }}>
                  {PROVIDER_LABELS[p.name]}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {status.kind === 'needs-setup' && providerNeedsToken(p.name) && (
                  <Button size="sm" variant="secondary" onClick={() => setShowCredentialSetup(p.name)}>
                    Configure
                  </Button>
                )}
                <ProviderStatusBadge status={status} />
              </div>
            </div>
            );
          })}
        </Section>

        {/* ── Backend Selection ── */}
        {anyConnected && !isWeb && (
          <Section title="Backend" defaultOpen>
            {availableBackends.length === 0 && (
              <EmptyState title="No live backends yet">
                Backends and queue lengths appear here once the kernel lists them for a connected provider.
              </EmptyState>
            )}
            {availableBackends.length > 0 && <Select
              aria-label="Backend"
              value={selectedBackend ?? ''}
              onChange={(e) => selectBackend(e.target.value)}
            >
              <option value="" disabled>Select backend…</option>
              {availableBackends.map((b) => (
                <option key={b.name} value={b.name}>
                  {`${b.name} · ${PROVIDER_LABELS[b.provider]} · ${b.qubitCount}q${b.status === 'online' ? '' : ' (offline)'}`}
                </option>
              ))}
            </Select>}

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
                  <Badge tone={selectedBackendInfo.status === 'online' ? 'success' : 'danger'} style={{ textTransform: 'uppercase' }}>
                    {selectedBackendInfo.status}
                  </Badge>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div>
                    <div style={{ fontSize: 11, color: colors.textDim, textTransform: 'uppercase', ...font }}>
                      Qubits
                    </div>
                    <div style={{ fontSize: 12, color: colors.text, fontWeight: 600, ...font }}>
                      {selectedBackendInfo.qubitCount}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: colors.textDim, textTransform: 'uppercase', ...font }}>
                      Queue
                    </div>
                    <div style={{ fontSize: 12, color: colors.text, fontWeight: 600, ...font }}>
                      {selectedBackendInfo.queueLength}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: colors.textDim, textTransform: 'uppercase', ...font }}>
                      Error Rate
                    </div>
                    <div style={{ fontSize: 12, color: colors.text, fontWeight: 600, ...font }}>
                      {(selectedBackendInfo.averageErrorRate * 100).toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: colors.textDim, textTransform: 'uppercase', ...font }}>
                      Provider
                    </div>
                    <div style={{ fontSize: 12, color: colors.accentText, fontWeight: 600, ...font }}>
                      {PROVIDER_LABELS[selectedBackendInfo.provider]}
                    </div>
                  </div>
                </div>

                {/* Gate set pills */}
                <div style={{ marginTop: 8 }}>
                  <div
                    style={{
                      fontSize: 11,
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
                      <Badge key={gate} tone="accent" style={{ fontFamily: TYPOGRAPHY.fontMono }}>
                        {gate}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Launching goes through the Launch dialog, which talks to the kernel; the panel never fabricates a job. */}
            <Button
              variant="primary"
              style={{ width: '100%', marginTop: 10 }}
              onClick={() => openLaunch()}
              disabled={backendBusy}
              icon={<Rocket size={12} />}
            >
              {backendBusy ? 'Job in queue' : 'Run on hardware'}
            </Button>
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
            <button className="nuclei-hover-danger"
              onClick={() => { if (window.confirm('Clear all hardware jobs from the list?')) clearJobs(); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                width: '100%',
                marginTop: 8,
                padding: '5px 0',
                fontSize: 11,
                color: colors.textDim,
                background: 'transparent',
                border: `1px solid ${colors.border}`,
                borderRadius: 3,
                cursor: 'pointer',
                ...font,
              }}
            >
              <Trash2 size={12} />
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
