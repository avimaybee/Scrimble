import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

type DropdownMenuContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const DropdownMenuContext = React.createContext<DropdownMenuContextValue>({
  open: false,
  setOpen: () => {},
});

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block" ref={ref}>
        {children}
      </div>
    </DropdownMenuContext.Provider>
  );
}

type DropdownMenuTriggerProps = {
  children: React.ReactNode;
  className?: string;
  onClick?: (event: React.MouseEvent) => void;
  asChild?: boolean;
};

type TriggerChildProps = {
  className?: string;
  onClick?: (event: React.MouseEvent) => void;
  'aria-haspopup'?: 'menu';
  'aria-expanded'?: boolean;
};

export function DropdownMenuTrigger({
  children,
  className,
  onClick,
  asChild,
}: DropdownMenuTriggerProps) {
  const { open, setOpen } = React.useContext(DropdownMenuContext);

  const handleClick = (event: React.MouseEvent) => {
    onClick?.(event);
    setOpen(!open);
  };

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<TriggerChildProps>;
    return React.cloneElement(child, {
      className: cn(className, child.props.className),
      'aria-haspopup': 'menu',
      'aria-expanded': open,
      onClick: (event: React.MouseEvent) => {
        child.props.onClick?.(event);
        handleClick(event);
      },
    });
  }

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      aria-haspopup="menu"
      aria-expanded={open}
    >
      {children}
    </button>
  );
}

export function DropdownMenuContent({
  children,
  className,
  align = 'start',
}: {
  children: React.ReactNode;
  className?: string;
  align?: 'start' | 'end';
}) {
  const { open } = React.useContext(DropdownMenuContext);

  const alignClass = align === 'end' ? 'right-0' : 'left-0';

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, y: -5, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -5, scale: 0.95 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          role="menu"
          aria-orientation="vertical"
          className={cn(
            'absolute z-50 mt-2 min-w-[180px] rounded-[16px] border border-border-default bg-bg-overlay py-1.5 shadow-panel focus:outline-none',
            alignClass,
            className,
          )}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function DropdownMenuLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('px-4 py-2 text-sm font-semibold text-text-primary', className)}>{children}</div>;
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn('mx-2 my-1 h-px bg-border-subtle', className)} />;
}

export function DropdownMenuItem({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const { setOpen } = React.useContext(DropdownMenuContext);

  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'mx-2 flex w-[calc(100%-1rem)] items-center rounded-[10px] px-4 py-2.5 text-sm text-text-secondary outline-none transition-colors hover:bg-bg-elevated hover:text-text-primary',
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        setOpen(false);
      }}
    >
      {children}
    </button>
  );
}
