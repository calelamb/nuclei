import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

import { AlertTriangle } from 'lucide-react';
import { ICON_SIZE, ICON_STROKE } from '../styles/tokens';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  label?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary isolates subtree failures so one broken component (e.g. Monaco)
 * doesn't crash the entire IDE. When an error is caught, it renders a recoverable
 * fallback UI with a retry button that remounts the subtree.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info);
    }
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div role="alert" className="nuclei-error-boundary">
          <EmptyState
            icon={<AlertTriangle size={ICON_SIZE.lg} strokeWidth={ICON_STROKE} />}
            title={`${this.props.label ?? 'Component'} failed to load`}
            action={<Button variant="primary" size="sm" onClick={this.reset}>Retry</Button>}
          >
            <span className="nuclei-error-boundary__message">{this.state.error.message}</span>
          </EmptyState>
        </div>
      );
    }

    return this.props.children;
  }
}
