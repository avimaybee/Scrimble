import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Hexagon } from 'lucide-react';
import { cn } from '@/lib/utils';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

interface FullscreenStatusProps {
  label?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

export function FullscreenStatus({
  label,
  title,
  description,
  children,
  className,
}: FullscreenStatusProps) {
  return (
    <div
      className={cn(
        'relative flex min-h-screen items-center justify-center overflow-hidden bg-bg-base px-6 py-12 text-center text-text-primary',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(235,94,40,0.12)_0%,transparent_34%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,252,242,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,252,242,0.08) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      />

      <div className="relative z-10 flex w-full max-w-[560px] flex-col items-center">
        <motion.div
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="mb-6 text-accent-primary"
        >
          <Hexagon className="h-10 w-10" />
        </motion.div>

        {label ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
            className="section-label justify-center"
          >
            {label}
          </motion.div>
        ) : null}

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
          className="mt-4 text-heading"
        >
          {title}
        </motion.h1>

        {description ? (
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.48, ease: EASE_OUT_EXPO, delay: 0.04 }}
            className="mt-3 max-w-[460px] text-body"
          >
            {description}
          </motion.p>
        ) : null}

        {children ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.48, ease: EASE_OUT_EXPO, delay: 0.08 }}
            className="mt-8 w-full"
          >
            {children}
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}

export default FullscreenStatus;
