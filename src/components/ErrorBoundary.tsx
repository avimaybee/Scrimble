import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Hexagon, RotateCcw, LayoutDashboard } from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function ErrorActions() {
  const navigate = useNavigate();

  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={handleRetry}
        className="btn-secondary flex items-center gap-2 rounded-lg px-6"
      >
        <RotateCcw className="h-4 w-4" />
        Retry
      </button>
      <button
        onClick={() => navigate('/dashboard')}
        className="btn-ghost flex items-center gap-2 px-6"
      >
        <LayoutDashboard className="h-4 w-4" />
        Go to Dashboard
      </button>
    </div>
  );
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

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-[400px] w-full flex-col items-center justify-center py-12 text-center">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="mb-6 text-text-muted"
          >
            <Hexagon className="h-8 w-8" />
          </motion.div>

          <h2 className="mb-2 text-heading">
            Something went wrong
          </h2>
          <p className="mb-8 max-w-md text-text-secondary">
            We hit an unexpected bump. Give it another shot or head back to your dashboard.
          </p>

          <ErrorActions />

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
