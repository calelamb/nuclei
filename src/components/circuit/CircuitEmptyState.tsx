import { useThemeStore } from '../../stores/themeStore';
import { Workflow } from 'lucide-react';
import { TYPOGRAPHY } from '../../styles/tokens';
import { EmptyState } from '../ui';

const PREVIEW_PAUSED_MESSAGE = 'Preview paused: this code runs longer than 5 s. Press Run to execute.';

/**
 * Shown in the circuit panel until the kernel has parsed a circuit: the shared empty state with one
 * line of guidance. A parse error replaces it with the message so it is never hidden.
 */
export function CircuitEmptyState({ error, paused = false }: { error: string | null; paused?: boolean }) {
  const colors = useThemeStore((s) => s.colors);

  if (paused && !error) {
    return (
      <div role="status" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <span style={{ color: colors.textMuted, fontSize: 13, fontFamily: TYPOGRAPHY.fontSans, textAlign: 'center', lineHeight: 1.5 }}>{PREVIEW_PAUSED_MESSAGE}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <span style={{ color: colors.error, fontSize: 13, fontFamily: TYPOGRAPHY.fontSans, textAlign: 'center' }}>{error}</span>
      </div>
    );
  }

  return (
    <div role="status" style={{ height: '100%', minHeight: 110, display: 'flex' }}>
      <EmptyState className="viz-empty" icon={<Workflow size={20} />} title="Your circuit appears here">
        Write code in the editor and the diagram draws as you type.
      </EmptyState>
    </div>
  );
}
