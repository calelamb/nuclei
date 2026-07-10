import { useState } from 'react';
import { useDiracStore } from '../../stores/diracStore';
import { useDiracAgent } from '../../hooks/useDiracAgent';
import { useThemeStore } from '../../stores/themeStore';
import { usePlatform } from '../../platform/PlatformProvider';
import { AgentRunCard } from './AgentRunCard';

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
  const apiKey = useDiracStore((s) => s.apiKey);
  const hasApiKey = Boolean(apiKey && apiKey.trim() !== '');
  const { start, cancel, isRunning, activeRun } = useDiracAgent();
  const [goal, setGoal] = useState('');

  const disabledReason = isWeb
    ? 'Agent mode requires the desktop app.'
    : !hasApiKey
      ? 'Add your Anthropic API key in Settings to use the agent.'
      : isRunning
        ? 'An agent run is already in progress.'
        : null;

  const handleRun = () => {
    const trimmed = goal.trim();
    if (!trimmed || disabledReason) return;
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
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRun();
          }}
          placeholder="Agent goal — e.g. build a Bell state"
          disabled={Boolean(disabledReason)}
          title={disabledReason ?? undefined}
          aria-label="Agent goal"
          style={{
            flex: 1,
            padding: '6px 10px',
            fontSize: 12,
            fontFamily: "'Geist Sans', sans-serif",
            background: colors.bgPanel,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            color: colors.text,
            outline: 'none',
          }}
        />
        <button
          onClick={handleRun}
          disabled={Boolean(disabledReason) || !goal.trim()}
          title={disabledReason ?? 'Run the agent toward this goal'}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "'Geist Sans', sans-serif",
            background: disabledReason || !goal.trim() ? colors.border : colors.dirac,
            color: disabledReason || !goal.trim() ? colors.textMuted : '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: disabledReason || !goal.trim() ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Run Agent
        </button>
      </div>

      {activeRun && <AgentRunCard run={activeRun} isRunning={isRunning} onStop={cancel} />}
    </div>
  );
}
