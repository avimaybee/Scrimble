import React from 'react';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export function Dialog({ open, onOpenChange, children }: { open?: boolean, onOpenChange?: (open: boolean) => void, children: React.ReactNode }) {
  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange?.(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 bg-black/70 backdrop-blur-[2px]"
            onClick={() => onOpenChange?.(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-50 w-full max-w-lg"
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function DialogContent({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <div className={cn("surface-panel overflow-hidden", className)}>
      {children}
    </div>
  );
}

export function DialogHeader({ children, className }: { children: React.ReactNode, className?: string }) {
  return <div className={cn("p-6 pb-4", className)}>{children}</div>;
}

export function DialogTitle({ children, className }: { children: React.ReactNode, className?: string }) {
  return <h2 className={cn("font-serif text-[28px] tracking-[-0.03em] text-text-primary", className)}>{children}</h2>;
}

export function DialogDescription({ children, className }: { children: React.ReactNode, className?: string }) {
  return <p className={cn("text-sm text-text-secondary mt-1.5", className)}>{children}</p>;
}

export function DialogFooter({ children, className }: { children: React.ReactNode, className?: string }) {
  return <div className={cn("p-6 pt-4 flex justify-end gap-3", className)}>{children}</div>;
}
