import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Hexagon, RotateCcw, Home } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`ErrorBoundary [${this.props.name || 'Global'}]:`, error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-[400px] w-full flex-col items-center justify-center rounded-[16px] border border-border-default bg-bg-surface p-12 text-center shadow-panel">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="mb-6 text-accent-primary"
          >
            <Hexagon className="h-8 w-8" />
          </motion.div>

          <h2 className="mb-2 font-serif text-2xl tracking-[-0.03em] text-text-primary">
            Something broke here
          </h2>
          <p className="mb-8 max-w-md text-text-secondary">
            {this.props.name ? `The ${this.props.name} view` : 'This part of the app'} hit a problem. Reload and pick up where you left off.
          </p>

          <div className="flex items-center gap-4">
            <button
              onClick={this.handleReset}
              className="btn-primary flex items-center gap-2 rounded-lg px-6"
            >
              <RotateCcw className="h-4 w-4" />
              Try again
            </button>
            <button
              onClick={this.handleGoHome}
              className="btn-ghost flex items-center gap-2 px-6"
            >
              <Home className="h-4 w-4" />
              Go home
            </button>
          </div>

          {process.env.NODE_ENV === 'development' && (
            <div className="mt-8 w-full max-w-2xl overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated p-4 text-left">
              <p className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-text-tertiary">Debug Info</p>
              <pre className="overflow-auto font-mono text-xs text-status-error">
                {this.state.error?.stack}
              </pre>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
