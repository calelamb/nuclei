import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Rocket, X } from 'lucide-react';
import { Button, Dialog, IconButton } from '../ui';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useEditorStore } from '../../stores/editorStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useThemeStore } from '../../stores/themeStore';
import { useFrameworksStore } from '../../stores/frameworksStore';
import { usePlatform } from '../../platform/PlatformProvider';
import { getHardware } from '../../App';
import { LaunchBackendStep } from './LaunchBackendStep';
import { LaunchProviderGrid } from './LaunchProviderGrid';
import {
  providerAllowsQsharp,
  providerNeedsToken,
  submissionLanguage,
} from './launchGating';
import { PROVIDERS, type ProviderMeta } from './launchProviders';
import type { BackendInfo, HardwareProviderType } from '../../types/hardware';
import './launch.css';

const MAX_SHOTS = 100000;
const DEFAULT_SHOTS = 1024;
const clampShots = (n: number) => Math.max(1, Math.min(MAX_SHOTS, Math.floor(n)));

/** Aggregator sub-provider filter: keep backends whose name mentions the chosen vendor. */
function filterBySubProvider(all: readonly BackendInfo[], provider: HardwareProviderType | null, sub: string | null): BackendInfo[] {
  if (!sub || sub === 'All' || (provider !== 'braket' && provider !== 'azure')) return [...all];
  const key = sub.toLowerCase();
  return all.filter((b) => b.name.toLowerCase().includes(key));
}

export function LaunchModal() {
  const open = useHardwareStore((s) => s.launchOpen);
  const closeLaunch = useHardwareStore((s) => s.closeLaunch);
  const selectedProvider = useHardwareStore((s) => s.selectedProvider);
  const selectProvider = useHardwareStore((s) => s.selectProvider);
  const selectedBackend = useHardwareStore((s) => s.selectedBackend);
  const selectBackend = useHardwareStore((s) => s.selectBackend);
  const backends = useHardwareStore((s) => s.backends);
  const providers = useHardwareStore((s) => s.providers);
  const stagedSubmission = useHardwareStore((s) => s.stagedSubmission);
  const selectedSubProvider = useHardwareStore((s) => s.selectedSubProvider);
  const selectSubProvider = useHardwareStore((s) => s.selectSubProvider);
  const connectingProvider = useHardwareStore((s) => s.connectingProvider);
  const connectionErrors = useHardwareStore((s) => s.connectionErrors);
  const cudaqInstalled = useFrameworksStore((s) => s.status?.installed.includes('cuda-q') ?? false);

  const shots = useSimulationStore((s) => s.shots);
  const setShots = useSimulationStore((s) => s.setShots);
  const code = useEditorStore((s) => s.code);
  const framework = useEditorStore((s) => s.framework);
  const colors = useThemeStore((s) => s.colors);
  const isWeb = usePlatform().getPlatform() === 'web';

  const [localShots, setLocalShots] = useState(shots || DEFAULT_SHOTS);
  // Raw text draft so the field can be cleared and retyped; `localShots` stays a valid clamped number.
  const [shotsDraft, setShotsDraft] = useState(String(shots || DEFAULT_SHOTS));
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastPicked = useRef<HardwareProviderType | null>(null);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setLocalShots(shots || DEFAULT_SHOTS);
      setShotsDraft(String(shots || DEFAULT_SHOTS));
    });
  }, [open, shots]);

  // Keyboard focus follows the step: into the dialog's step two, back onto the card that opened it.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const root = bodyRef.current;
      if (!root) return;
      const target = selectedProvider
        ? root.querySelector<HTMLElement>('[data-launch-focus]')
        : (lastPicked.current && root.querySelector<HTMLElement>(`[data-provider="${lastPicked.current}"]`));
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, selectedProvider]);

  const providerBackends = useMemo(
    () => filterBySubProvider(
      selectedProvider ? backends.filter((b) => b.provider === selectedProvider) : [],
      selectedProvider,
      selectedSubProvider,
    ),
    [selectedProvider, selectedSubProvider, backends],
  );

  if (!open) return null;

  const connectedSet = new Set(providers.filter((p) => p.connected).map((p) => p.name));
  const submitLanguage = submissionLanguage(stagedSubmission?.fileName ?? null, framework);
  const qsharpBlocks = (provider: HardwareProviderType) =>
    submitLanguage === 'qsharp' && !providerAllowsQsharp(provider);

  const handlePickProvider = (p: ProviderMeta) => {
    if (p.comingSoon || qsharpBlocks(p.name)) return;
    lastPicked.current = p.name;
    selectProvider(p.name);
    // Account-free providers have no token step: the kernel connects them as soon as they are chosen.
    if (!isWeb && !providerNeedsToken(p.name) && !connectedSet.has(p.name)) {
      getHardware()?.hardwareConnect(p.name, {});
    }
  };

  const handleBack = () => {
    selectProvider(null);
    selectBackend(null);
  };

  const handleSetupCredentials = (provider: HardwareProviderType) => {
    closeLaunch();
    useHardwareStore.getState().setShowCredentialSetup(provider);
  };

  const handleConnect = (provider: HardwareProviderType, token: string) => {
    getHardware()?.hardwareConnect(provider, { token });
  };

  const handleLaunch = () => {
    if (!selectedProvider || !selectedBackend) return;
    const hardwareStore = useHardwareStore.getState();
    const codeToSubmit = stagedSubmission?.content ?? code;
    if (!codeToSubmit.trim()) return;
    setShots(localShots);
    const hw = getHardware();
    const ok = hw?.hardwareSubmit(selectedProvider, selectedBackend, codeToSubmit, localShots, submitLanguage) ?? false;
    if (!ok) {
      hardwareStore.setConnectionError(selectedProvider, 'The kernel is not connected yet. Wait for the status bar to say ready, then launch again.');
      return;
    }
    // The job is recorded when the kernel confirms `hardware_job_submitted`; none is faked here.
    closeLaunch();
  };

  const selectedMeta = PROVIDERS.find((p) => p.name === selectedProvider);
  const connected = selectedProvider ? connectedSet.has(selectedProvider) : false;
  const hasCode = (stagedSubmission?.content ?? code).trim().length > 0;

  return (
    <Dialog
      title={(
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Rocket size={16} style={{ color: colors.accentText }} aria-hidden="true" />
          {selectedMeta ? `Launch to ${selectedMeta.label}` : 'Launch your circuit'}
        </span>
      )}
      width={1040}
      flush
      // Escape and the scrim step back from a provider before they close the dialog.
      onClose={selectedProvider ? handleBack : closeLaunch}
      leading={selectedProvider ? (
        <Button size="sm" onClick={handleBack} aria-label="Back" icon={<ChevronLeft size={12} />}>Back</Button>
      ) : undefined}
      trailing={(
        <IconButton size="sm" aria-label="Close" onClick={closeLaunch}>
          <X size={16} />
        </IconButton>
      )}
    >
      <div ref={bodyRef} style={{ overflow: 'auto', flex: 1 }}>
        {!selectedMeta ? (
          <div style={{ padding: 20 }}>
            <p style={{ color: colors.textMuted, fontSize: 12, lineHeight: 1.6, margin: '0 0 18px' }}>
              {isWeb
                ? 'Hardware launches run in the desktop app. The browser build simulates circuits in the page.'
                : 'Pick where to run your circuit. Real hardware runs take minutes to hours depending on queue; simulators run instantly.'}
            </p>
            <LaunchProviderGrid
              isWeb={isWeb}
              cudaqInstalled={cudaqInstalled}
              connected={connectedSet}
              qsharpBlocks={qsharpBlocks}
              onPick={handlePickProvider}
            />
          </div>
        ) : (
          <LaunchBackendStep
            provider={selectedMeta}
            isWeb={isWeb}
            connected={connected}
            connecting={connectingProvider === selectedMeta.name}
            connectionError={connectionErrors[selectedMeta.name] ?? null}
            backends={providerBackends}
            selectedBackend={selectedBackend}
            selectedSubProvider={selectedSubProvider}
            stagedFileName={stagedSubmission?.fileName ?? null}
            hasCode={hasCode}
            shotsDraft={shotsDraft}
            onShotsChange={(raw) => {
              setShotsDraft(raw);
              const n = Number(raw);
              if (raw.trim() !== '' && Number.isFinite(n)) setLocalShots(clampShots(n));
            }}
            onShotsBlur={() => {
              const n = Number(shotsDraft);
              const next = shotsDraft.trim() === '' || !Number.isFinite(n) ? localShots : clampShots(n);
              setLocalShots(next);
              setShotsDraft(String(next));
            }}
            onSelectBackend={selectBackend}
            onSelectSubProvider={selectSubProvider}
            onConnect={handleConnect}
            onSetupCredentials={handleSetupCredentials}
            onCancel={closeLaunch}
            onLaunch={handleLaunch}
          />
        )}
      </div>
    </Dialog>
  );
}
