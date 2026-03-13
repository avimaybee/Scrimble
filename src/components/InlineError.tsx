import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { motion } from 'framer-motion';

interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function InlineError({ message, onRetry, className = '' }: InlineErrorProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`max-w-full rounded-lg border border-red-900/30 bg-red-950/20 p-3 ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
        <span className="text-sm text-red-200/80">{message}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-red-300 transition-colors hover:bg-red-900/20"
          >
            <RotateCcw className="h-3 w-3" />
            Retry
          </button>
        )}
      </div>
    </motion.div>
  );
}

export default InlineError;
