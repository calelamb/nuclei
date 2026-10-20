import { useState } from 'react';
import { useDiracStore } from '../../stores/diracStore';
import { useDiracAgent } from '../../hooks/useDiracAgent';
import { useThemeStore } from '../../stores/themeStore';
import { usePlatform } from '../../platform/PlatformProvider';
import { AgentRunCard } from './AgentRunCard';

import { useWorkspaceStore } from '../../stores/workspaceStore';
import { Button, TextInput, Tooltip } from '../ui';
import './dirac.css';
/**
 * Goal input + Run button for Dirac's agent mode, plus the live
 * AgentRunCard once a run starts. Kept as its own component (rather than
 * inline in DiracSidePanel) to keep that file from growing further — it's
 * a self-contained, clearly-labeled section that the panel just renders.
 */
export function AgentEntryPoint() {
  const colors = useThemeStore((s) => s.colors);
  const platform = usePlatform();
  const isWeb = platform.getPlatform() === 'web';
  const workspaceMode = useWorkspaceStore((s) => s.mode);
  const apiKey = useDiracStore((s) => s.apiKey);
  const hasApiKey = Boolean(apiKey && apiKey.trim() !== '');
  const { start, cancel, isRunning, activeRun } = useDiracAgent();
  const [goal, setGoal] = useState('');

  // Nothing to run without a key, and on the web build agent mode does not exist:
  // say so once, visibly, instead of showing controls that cannot work.
  if (!hasApiKey) return null;
  if (isWeb) {
    return (
      <div className="dirac-agent-note">
        <span className="dirac-agent-note__chip">Agent mode &middot; desktop app</span>
      </div>
    );
  }

  const busyReason = isRunning ? 'An agent run is already in progress.' : null;
  const placeholder = workspaceMode === 'research'
    ? 'Agent goal, e.g. sweep theta 0\u20132\u03c0 and plot energy'
    : 'Agent goal, e.g. build a Bell state';

  const handleRun = () => {
    const trimmed = goal.trim();
    if (!trimmed || busyReason) return;
    setGoal('');
    void start(trimmed);
  };

  return (
    <div
      style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', gap: 6 }}>
        <TextInput
          size="md"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRun();
          }}
          placeholder={placeholder}
          disabled={Boolean(busyReason)}
          aria-label="Agent goal"
          style={{ flex: 1, minWidth: 0 }}
        />
        <Tooltip label={busyReason ?? 'Run the agent toward this goal'} placement="below">
          <span style={{ display: 'inline-flex' }}>
            <Button
              variant="secondary"
              onClick={handleRun}
              disabled={Boolean(busyReason) || !goal.trim()}
            >
              Run Agent
            </Button>
          </span>
        </Tooltip>
      </div>

      {activeRun && <AgentRunCard run={activeRun} isRunning={isRunning} onStop={cancel} />}
    </div>
  );
}
