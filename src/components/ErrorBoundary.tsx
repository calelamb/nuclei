import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

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
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 32,
            height: '100%',
            width: '100%',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
            color: '#64748B',
            background: 'transparent',
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#1A1A2E',
            }}
          >
            {this.props.label ?? 'Component'} failed to load
          </div>
          <div
            style={{
              fontSize: 12,
              fontFamily: "'JetBrains Mono', 'Roboto Mono', monospace",
              color: '#94A3B8',
              maxWidth: 480,
              textAlign: 'center',
              wordBreak: 'break-word',
            }}
          >
            {this.state.error.message}
          </div>
          <button
            onClick={this.reset}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              color: '#FFFFFF',
              background: '#0891B2',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
