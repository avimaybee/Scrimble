import React from 'react';
import { cn } from '../../lib/utils';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const TooltipContext = React.createContext<{ open: boolean, setOpen: (open: boolean) => void }>({ open: false, setOpen: () => {} });

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function Tooltip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        {children}
      </div>
    </TooltipContext.Provider>
  );
}

export function TooltipTrigger({ children, asChild }: { children: React.ReactNode, asChild?: boolean }) {
  if (asChild && React.isValidElement(children)) {
    return children;
  }
  return <span>{children}</span>;
}

export function TooltipContent({ children, className }: { children: React.ReactNode, className?: string }) {
  const { open } = React.useContext(TooltipContext);
  
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 5 }}
          transition={{ duration: 0.15 }}
          className={cn(
            "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-text-primary text-bg-base text-xs rounded shadow-sm whitespace-nowrap z-50 pointer-events-none",
            className
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
