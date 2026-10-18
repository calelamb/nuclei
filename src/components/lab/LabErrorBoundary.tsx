/**
 * PRD 14 — Lab error boundary. A render error inside one Lab panel (a chart
 * given a payload shape it did not expect, say) must never blank the whole
 * app. This renders a designed in-panel error state with the error details
 * and a "Reload panel" action that remounts the subtree.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { LabButton } from './primitives';

interface Props {
  children: ReactNode;
  /** Names the failing panel in the logs and the accessible alert. */
  label?: string;
  /** When any entry changes (new job, new tab), a caught error is cleared. */
  resetKeys?: ReadonlyArray<unknown>;
  /** Smaller state for use inside a card. */
  compact?: boolean;
}

interface State {
  error: Error | null;
}

function keysChanged(a: ReadonlyArray<unknown> | undefined, b: ReadonlyArray<unknown> | undefined): boolean {
  if (a === b) return false;
  if (!a || !b || a.length !== b.length) return true;
  return a.some((value, i) => !Object.is(value, b[i]));
}

export function LabErrorState({
  error,
  onReload,
  label,
  compact,
}: {
  error: Error;
  onReload: () => void;
  label?: string;
  compact?: boolean;
}) {
  return (
    <div
      className="lab lab-error"
      role="alert"
      aria-label={label ? `${label} error` : 'Panel error'}
      style={compact ? { minHeight: 120, padding: 'var(--space-5)' } : undefined}
    >
      <div className="lab-error__icon" aria-hidden>
        <TriangleAlert size={20} strokeWidth={1.8} />
      </div>
      <p className="lab-empty__title">This panel hit an error</p>
      <p className="lab-empty__body">
        {label ? `${label} stopped rendering. ` : ''}The rest of Nuclei is unaffected. Reloading the panel re-renders it from the
        data it already has.
      </p>
      <details className="lab-error__details">
        <summary>Details</summary>
        <pre className="lab-code">{`${error.name}: ${error.message}`}</pre>
      </details>
      <LabButton variant="primary" icon={RotateCcw} onClick={onReload}>
        Reload panel
      </LabButton>
    </div>
  );
}

export class LabErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the detail in the console for bug reports; the UI shows the message.
    console.error(`[LabErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && keysChanged(prev.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null });
    }
  }

  reload = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return <LabErrorState error={error} onReload={this.reload} label={this.props.label} compact={this.props.compact} />;
    }
    return this.props.children;
  }
}
