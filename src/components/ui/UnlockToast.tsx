import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LockOpen, X } from 'lucide-react';

interface UnlockToastProps {
  show: boolean;
  count: number;
  onClose: () => void;
}

export default function UnlockToast({ show, count, onClose }: UnlockToastProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 20, opacity: 0, x: '-50%' }}
          animate={{ y: 0, opacity: 1, x: '-50%' }}
          exit={{ y: 20, opacity: 0, x: '-50%' }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[16px] border border-accent-border bg-bg-surface/94 px-5 py-3 shadow-panel backdrop-blur-md"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-accent-border bg-accent-primary-muted">
            <LockOpen className="h-4 w-4 text-accent-primary" />
          </div>
          <div className="text-sm font-medium text-text-primary whitespace-nowrap">
            {count} {count > 1 ? 'next steps are' : 'next step is'} ready.
          </div>
          <button 
            onClick={onClose}
            className="p-1 text-text-tertiary hover:text-text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
