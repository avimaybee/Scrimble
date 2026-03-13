import { AlertTriangle, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function InlineError({ message, onRetry, className }: InlineErrorProps) {
  return (
    <div
      className={cn(
        'bg-red-950/20 border border-red-900/30 rounded-lg p-3 flex items-start gap-2',
        className
      )}
    >
      <AlertTriangle className="h-4 w-4 text-status-error shrink-0 mt-0.5" />
      <p className="text-sm text-text-secondary flex-1">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-status-error hover:text-accent-soft transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  );
}
