import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, X } from 'lucide-react';

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
          className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-bg-surface/90 backdrop-blur-md border border-accent-border px-6 py-3 rounded-full shadow-lg z-50 flex items-center gap-3"
        >
          <div className="w-8 h-8 bg-accent-primary-muted rounded-full flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-accent-primary" />
          </div>
          <div className="text-sm font-medium text-text-primary whitespace-nowrap">
            {count} {count > 1 ? 'nodes' : 'node'} unlocked!
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
