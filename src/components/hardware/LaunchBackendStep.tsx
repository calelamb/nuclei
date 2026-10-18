import { useState } from 'react';
import { Badge, Button, EmptyState, TextInput } from '../ui';
import { Clock, Download, FileCode, KeyRound, Rocket } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { openExternal } from '../../lib/openExternal';
import { DESKTOP_DOWNLOAD_URL } from '../../config/docsLinks';
import { formatErrorRate, providerNeedsToken } from './launchGating';
import { AGGREGATOR_SUB_PROVIDERS, INLINE_KEY_FIELD, type ProviderMeta } from './launchProviders';
import type { BackendInfo, HardwareProviderType } from '../../types/hardware';
import { TYPOGRAPHY } from '../../styles/tokens';

export interface LaunchBackendStepProps {
  readonly provider: ProviderMeta;
  readonly isWeb: boolean;
  readonly connected: boolean;
  readonly connecting: boolean;
  readonly connectionError: string | null;
  readonly backends: readonly BackendInfo[];
  readonly selectedBackend: string | null;
  readonly selectedSubProvider: string | null;
  readonly stagedFileName: string | null;
  readonly hasCode: boolean;
  readonly shotsDraft: string;
  readonly onShotsChange: (raw: string) => void;
  readonly onShotsBlur: () => void;
  readonly onSelectBackend: (name: string) => void;
  readonly onSelectSubProvider: (sub: string | null) => void;
  readonly onConnect: (provider: HardwareProviderType, token: string) => void;
  readonly onCancel: () => void;
  readonly onLaunch: () => void;
}

function emptyBackendsCopy(provider: ProviderMeta, connected: boolean): { title: string; body: string } {
  if (provider.name === 'nvidia') {
    return connected
      ? { title: 'No GPU targets reported', body: 'The kernel did not list any CUDA-Q targets on this machine.' }
      : { title: 'Install CUDA-Q to use your GPU', body: 'Add CUDA-Q from Settings, Environment, then reopen this dialog.' };
  }
  if (!providerNeedsToken(provider.name)) {
    return { title: 'No backends reported yet', body: 'The kernel has not listed any backends for this provider.' };
  }
  return connected
    ? { title: 'No live backends returned', body: `${provider.label} did not list any backends for this account.` }
    : { title: `Connect your ${provider.label} account`, body: 'Live backends and queue lengths appear once the provider is connected.' };
}

function TokenField(props: Pick<LaunchBackendStepProps, 'provider' | 'connecting' | 'onConnect'>) {
  const { provider, connecting, onConnect } = props;
  const [draft, setDraft] = useState('');
  const field = INLINE_KEY_FIELD[provider.name];
  if (!field) return null;
  const submit = () => {
    if (!draft.trim()) return;
    onConnect(provider.name, draft.trim());
    // The kernel owns persistence in the OS keyring; drop the in-memory copy now.
    setDraft('');
  };
  return (
    <div className="launch-token">
      <label htmlFor="launch-token-input" className="launch-token__label">
        <KeyRound size={12} aria-hidden="true" /> {field.label}
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <TextInput
          id="launch-token-input"
          data-launch-focus
          type="password"
          mono
          autoComplete="off"
          value={draft}
          placeholder={field.placeholder}
          disabled={connecting}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          style={{ flex: 1 }}
        />
        <Button variant="primary" onClick={submit} disabled={!draft.trim()} loading={connecting}>
          {connecting ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
      {field.helpUrl && (
        <a href={field.helpUrl} target="_blank" rel="noreferrer" className="launch-token__help">
          {field.helpText} ↗
        </a>
      )}
    </div>
  );
}

function BackendRow({ b, active, onSelect }: { b: BackendInfo; active: boolean; onSelect: () => void }) {
  const queue = b.queueLength === 0 ? 'No queue' : `${b.queueLength} job${b.queueLength === 1 ? '' : 's'} ahead`;
  return (
    <button
      type="button"
      className="launch-backend"
      aria-pressed={active}
      onClick={onSelect}
    >
      <span>
        <span className="launch-backend__name">{b.name}</span>
        <span className="launch-backend__meta">
          {b.qubitCount} qubits{b.gateSet.length > 0 ? ` · ${b.gateSet.slice(0, 3).join(', ')}` : ''}
        </span>
      </span>
      <span className="launch-backend__queue"><Clock size={12} aria-hidden="true" /> {queue}</span>
      <Badge tone={b.averageErrorRate === 0 ? 'success' : b.averageErrorRate < 0.02 ? 'neutral' : 'warning'}>
        {formatErrorRate(b.averageErrorRate)}
      </Badge>
    </button>
  );
}

function costHint(provider: ProviderMeta): string {
  switch (provider.pricing) {
    case 'Paid': return 'Paid provider: usage is billed to your account.';
    case 'Credits': return 'Uses your provider credits.';
    case 'Free': return 'Free tier. Queue times vary.';
    default: return 'Runs on this machine at no cost.';
  }
}

/** Step two: connect (if needed), pick a live backend, choose shots, launch. */
export function LaunchBackendStep(props: LaunchBackendStepProps) {
  const colors = useThemeStore((s) => s.colors);
  const { provider, isWeb, connected, backends, selectedBackend, hasCode } = props;
  const needsToken = providerNeedsToken(provider.name) && INLINE_KEY_FIELD[provider.name] !== undefined;
  const subs = AGGREGATOR_SUB_PROVIDERS[provider.name];
  const canLaunch = connected && Boolean(selectedBackend) && hasCode;

  if (isWeb) {
    return (
      <div className="launch-step">
        <EmptyState
          icon={<Download size={20} />}
          title="Launching runs in the desktop app"
          action={(
            <Button variant="primary" size="sm" data-launch-focus icon={<Download size={14} />} onClick={() => { void openExternal(DESKTOP_DOWNLOAD_URL); }}>
              Download Nuclei to launch
            </Button>
          )}
        >
          Provider connections and job queues need the local kernel. The browser build runs circuits in Python, in the page.
        </EmptyState>
      </div>
    );
  }

  const empty = emptyBackendsCopy(provider, connected);
  return (
    <div className="launch-step">
      {!(needsToken && !connected) && (
        <h3 className="launch-step__heading" tabIndex={-1} data-launch-focus>
          {providerNeedsToken(provider.name) ? 'Choose a backend' : `Choose a ${provider.label} target`}
        </h3>
      )}
      {props.stagedFileName && (
        <div className="launch-staged">
          <FileCode size={12} aria-hidden="true" />
          <span style={{ color: colors.textMuted }}>Submitting</span>
          <strong>{props.stagedFileName}</strong>
        </div>
      )}

      {needsToken && !connected && <TokenField provider={provider} connecting={props.connecting} onConnect={props.onConnect} />}
      {needsToken && connected && (
        <div className="launch-saved"><KeyRound size={12} aria-hidden="true" /> Token saved</div>
      )}
      {props.connectionError && (
        <div role="alert" className="launch-error">{props.connectionError}</div>
      )}

      {subs && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {subs.map((sub) => (
            <button
              key={sub}
              type="button"
              className="nuclei-chip"
              aria-pressed={(props.selectedSubProvider ?? 'All') === sub}
              onClick={() => props.onSelectSubProvider(sub === 'All' ? null : sub)}
            >
              {sub}
            </button>
          ))}
        </div>
      )}

      {backends.length === 0 ? (
        <EmptyState className="launch-empty" title={empty.title}>{empty.body}</EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {backends.map((b) => (
            <BackendRow key={b.name} b={b} active={b.name === selectedBackend} onSelect={() => props.onSelectBackend(b.name)} />
          ))}
        </div>
      )}

      <div className="launch-shots">
        <div>
          <label htmlFor="launch-shots-input" className="launch-token__label">Shots</label>
          <TextInput
            id="launch-shots-input"
            type="number"
            min={1}
            max={100000}
            value={props.shotsDraft}
            onChange={(e) => props.onShotsChange(e.target.value)}
            onBlur={props.onShotsBlur}
            style={{ width: 140, fontFamily: TYPOGRAPHY.fontSans }}
          />
        </div>
        <div className="launch-shots__hint">
          {!hasCode
            ? <span style={{ color: colors.warning }}>No code to submit.</span>
            : !selectedBackend ? 'Pick a backend to continue.' : costHint(provider)}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="primary" icon={<Rocket size={14} />} onClick={props.onLaunch} disabled={!canLaunch}>
          Launch
        </Button>
      </div>
    </div>
  );
}
