import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../../lib/utils';

const TooltipProviderContext = React.createContext<{ delayDuration: number }>({
  delayDuration: 300,
});

const TooltipContext = React.createContext<{
  open: boolean;
  close: () => void;
  openWithDelay: () => void;
} | null>(null);

export function TooltipProvider({
  children,
  delayDuration = 300,
}: {
  children: React.ReactNode;
  delayDuration?: number;
}) {
  return (
    <TooltipProviderContext.Provider value={{ delayDuration }}>
      {children}
    </TooltipProviderContext.Provider>
  );
}

export function Tooltip({
  children,
  delayDuration,
}: {
  children: React.ReactNode;
  delayDuration?: number;
}) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const provider = React.useContext(TooltipProviderContext);
  const resolvedDelay = delayDuration ?? provider.delayDuration;

  const clearOpenTimer = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const close = () => {
    clearOpenTimer();
    setOpen(false);
  };

  const openWithDelay = () => {
    clearOpenTimer();
    timeoutRef.current = window.setTimeout(() => {
      setOpen(true);
      timeoutRef.current = null;
    }, resolvedDelay);
  };

  useEffect(() => {
    return () => clearOpenTimer();
  }, []);

  return (
    <TooltipContext.Provider value={{ open, close, openWithDelay }}>
      <div
        className="relative inline-flex min-w-0 max-w-full"
        onMouseEnter={openWithDelay}
        onMouseLeave={close}
        onFocusCapture={openWithDelay}
        onBlurCapture={close}
      >
        {children}
      </div>
    </TooltipContext.Provider>
  );
}

export function TooltipTrigger({
  children,
  asChild,
}: {
  children: React.ReactNode;
  asChild?: boolean;
}) {
  if (asChild && React.isValidElement(children)) {
    return children;
  }

  return <span>{children}</span>;
}

export function TooltipContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const context = React.useContext(TooltipContext);
  const open = context?.open ?? false;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, y: 4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.98 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          className={cn(
            'pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-[6px] border border-white/10 bg-[#2a2a2a] px-[10px] py-[5px] text-[12px] text-white/85 shadow-[0_4px_12px_rgba(0,0,0,0.4)]',
            className,
          )}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
