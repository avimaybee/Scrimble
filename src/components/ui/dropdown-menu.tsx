import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

const DropdownMenuContext = React.createContext<{ open: boolean, setOpen: (open: boolean) => void }>({ open: false, setOpen: () => {} });

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [ref]);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block" ref={ref}>
        {children}
      </div>
    </DropdownMenuContext.Provider>
  );
}

export function DropdownMenuTrigger({ children, className, onClick, asChild }: { children: React.ReactNode, className?: string, onClick?: (e: React.MouseEvent) => void, asChild?: boolean }) {
  const { open, setOpen } = React.useContext(DropdownMenuContext);
  
  const handleClick = (e: React.MouseEvent) => {
    onClick?.(e);
    setOpen(!open);
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      className: cn(className, (children as React.ReactElement<any>).props.className),
      onClick: (e: React.MouseEvent) => {
        (children as React.ReactElement<any>).props.onClick?.(e);
        handleClick(e);
      }
    });
  }

  return (
    <div className={className} onClick={handleClick} role="button" tabIndex={0}>
      {children}
    </div>
  );
}

export function DropdownMenuContent({ children, className, align = 'start' }: { children: React.ReactNode, className?: string, align?: 'start' | 'end' }) {
  const { open } = React.useContext(DropdownMenuContext);

  const alignClass = align === 'end' ? 'right-0' : 'left-0';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -5, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -5, scale: 0.95 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            "absolute z-50 mt-2 min-w-[180px] py-1.5 bg-bg-overlay border border-border-default rounded-[16px] shadow-panel focus:outline-none",
            alignClass,
            className
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function DropdownMenuLabel({ children, className }: { children: React.ReactNode, className?: string }) {
  return <div className={cn("px-4 py-2 text-sm font-semibold text-text-primary", className)}>{children}</div>;
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn("h-px bg-border-subtle my-1 mx-2", className)} />;
}

export function DropdownMenuItem({ children, className, onClick }: { children: React.ReactNode, className?: string, onClick?: () => void }) {
  const { setOpen } = React.useContext(DropdownMenuContext);
  return (
    <div
      className={cn("mx-2 flex cursor-pointer items-center rounded-[10px] px-4 py-2.5 text-sm text-text-secondary outline-none transition-colors hover:bg-bg-elevated hover:text-text-primary", className)}
      onClick={() => {
        onClick?.();
        setOpen(false);
      }}
      role="menuitem"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick?.();
          setOpen(false);
        }
      }}
    >
      {children}
    </div>
  );
}
