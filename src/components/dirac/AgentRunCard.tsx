import { useThemeStore } from '../../stores/themeStore';
import type { ThemeColors } from '../../stores/themeStore';
import { useAgentRunStore } from '../../stores/agentRunStore';
import type { AgentRunUi } from '../../stores/agentRunStore';
import { storeWorkspace } from '../../services/agent/storeWorkspace';
import type { JournalEntry, PatchTransaction } from '../../services/agent/types';

const RUNNING_STATES = new Set(['planning', 'working', 'paused']);

function stateLabel(state: AgentRunUi['state']): string {
  switch (state) {
    case 'planning':
      return 'Planning';
    case 'working':
      return 'Working';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'paused':
      return 'Paused';
    default:
      return state;
  }
}

function stateColor(state: AgentRunUi['state'], colors: ThemeColors): string {
  switch (state) {
    case 'completed':
      return colors.success;
    case 'failed':
      return colors.error;
    case 'cancelled':
      return colors.textMuted;
    case 'paused':
      return colors.warning;
    default:
      return colors.accent;
  }
}

/** Turns one journal entry into a compact one-line summary. Returns null for
 * entries that shouldn't clutter the timeline (raw tool_call requests —
 * their paired tool_result carries the interesting information). */
function summarizeEntry(entry: JournalEntry): string | null {
  if (entry.kind === 'error') return `error — ${entry.message}`;
  if (entry.kind !== 'tool_result') return null;

  const { tool, ok, facts, diagnostics } = entry.evidence;
  if (!ok) return `${tool} — failed: ${diagnostics ?? 'unknown error'}`;

  switch (tool) {
    case 'apply_patch':
      return `apply_patch → ${String(facts.path ?? 'file')}`;
    case 'rollback_patch':
      return `rollback_patch → ${String(facts.transactionId ?? '')}`;
    case 'read_quantum_file':
      return `read_quantum_file → ${String(facts.path ?? '')}`;
    case 'parse_quantum_program':
      return `parse_quantum_program → ok (${String(facts.gateCount ?? 0)} gates)`;
    case 'run_simulation':
      return `run_simulation → ok (${String(facts.shotCount ?? '?')} shots)`;
    case 'compare_quantum_results':
      return `compare_quantum_results → ${facts.matches ? 'matched' : 'mismatch'}`;
    case 'inspect_project':
      return 'inspect_project → ok';
    case 'finish':
      return `finish → ${facts.success ? 'success' : 'incomplete'}`;
    default:
      return `${tool} → ok`;
  }
}

function TimelineRow({ text }: { text: string }) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div
      style={{
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
        color: colors.textMuted,
        padding: '2px 0',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </div>
  );
}

function PatchRow({ tx }: { tx: PatchTransaction }) {
  const colors = useThemeStore((s) => s.colors);

  const handleRollback = () => {
    const rolledBack = storeWorkspace.rollback(tx.id);
    const latest = storeWorkspace.getTransaction(tx.id);
    if (latest) useAgentRunStore.getState().recordPatch(latest);
    else if (rolledBack) useAgentRunStore.getState().recordPatch({ ...tx, rolledBack: true });
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        borderRadius: 4,
        background: colors.bgPanel,
        border: `1px solid ${colors.border}`,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
          color: colors.text,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {tx.path}
      </span>
      {tx.rolledBack ? (
        <span style={{ fontSize: 10, color: colors.textDim, fontFamily: "'Geist Sans', sans-serif" }}>
          Rolled back
        </span>
      ) : (
        <button
          onClick={handleRollback}
          style={{
            padding: '2px 8px',
            fontSize: 10,
            fontFamily: "'Geist Sans', sans-serif",
            background: colors.border,
            color: colors.text,
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Rollback
        </button>
      )}
    </div>
  );
}

export interface AgentRunCardProps {
  run: AgentRunUi;
  isRunning: boolean;
  onStop: () => void;
}

/** Live status card for a Dirac agent run — goal, state badge, iteration
 * count, a compact journal timeline, and applied patches with per-patch
 * rollback. Renders whenever agentRunStore has an activeRun. */
export function AgentRunCard({ run, isRunning, onStop }: AgentRunCardProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const badgeColor = stateColor(run.state, colors);
  const canStop = isRunning && RUNNING_STATES.has(run.state);

  const timeline = run.journal
    .map((entry) => summarizeEntry(entry))
    .filter((line): line is string => line !== null);

  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: colors.bg,
        boxShadow: shadow.sm,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: colors.text,
            fontFamily: "'Geist Sans', sans-serif",
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={run.goal}
        >
          {run.goal}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 999,
            background: `${badgeColor}18`,
            color: badgeColor,
            border: `1px solid ${badgeColor}40`,
            fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          {stateLabel(run.state)}
        </span>
      </div>

      <div
        style={{
          fontSize: 10,
          color: colors.textDim,
          fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        {run.iterations} tool call{run.iterations === 1 ? '' : 's'}
      </div>

      {timeline.length > 0 && (
        <div
          style={{
            maxHeight: 140,
            overflow: 'auto',
            padding: '4px 6px',
            background: colors.bgPanel,
            borderRadius: 4,
            border: `1px solid ${colors.border}`,
          }}
        >
          {timeline.map((line, i) => (
            <TimelineRow key={i} text={line} />
          ))}
        </div>
      )}

      {run.patches.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {run.patches.map((tx) => (
            <PatchRow key={tx.id} tx={tx} />
          ))}
        </div>
      )}

      {run.summary && (
        <div
          style={{
            fontSize: 11,
            color: colors.textMuted,
            fontFamily: "'Geist Sans', sans-serif",
            lineHeight: 1.4,
          }}
        >
          {run.summary}
        </div>
      )}

      {canStop && (
        <button
          onClick={onStop}
          style={{
            alignSelf: 'flex-start',
            padding: '4px 12px',
            fontSize: 11,
            fontFamily: "'Geist Sans', sans-serif",
            background: colors.error,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Stop
        </button>
      )}
    </div>
  );
}
