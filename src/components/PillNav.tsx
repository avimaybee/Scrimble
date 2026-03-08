import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutGrid, PlusSquare, Settings } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export default function PillNav() {
  const location = useLocation();

  const isNewProject = location.pathname === '/new';
  const isSettings = location.pathname === '/settings';
  const isDashboard = location.pathname === '/dashboard';

  const activeTab = useMemo(() => {
    if (isDashboard || isNewProject) return 'dashboard';
    if (isSettings) return 'settings';
    return null;
  }, [isDashboard, isNewProject, isSettings]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.4, duration: 0.8 }}
        className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
      >
        <div className="relative rounded-full border border-border-default bg-bg-surface/90 p-1 shadow-lg backdrop-blur-xl">
          <div className="flex items-center justify-center gap-1">
            <div className="flex items-center gap-1">
              <NavItem
                to="/dashboard"
                isActive={activeTab === 'dashboard'}
                icon={<LayoutGrid className="h-4.5 w-4.5" />}
                label="Dashboard"
              />
              <NavItem
                to="/new"
                isActive={false}
                icon={<PlusSquare className="h-4.5 w-4.5" />}
                label="New"
              />
              <NavItem
                to="/settings"
                isActive={activeTab === 'settings'}
                icon={<Settings className="h-4.5 w-4.5" />}
                label="Settings"
              />
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function NavItem({
  to,
  isActive,
  icon,
  label,
  disabled
}: {
  to: string;
  isActive: boolean;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Link
      to={disabled ? '#' : to}
      onClick={(e) => disabled && e.preventDefault()}
      className={cn(
        'group relative flex flex-col items-center justify-center px-3 py-1 transition-all duration-200',
        isActive ? 'text-accent-primary' : 'text-text-tertiary hover:text-text-secondary',
        disabled && !isActive ? 'opacity-50 cursor-not-allowed hover:text-text-tertiary' : ''
      )}
    >
      <div className="relative mb-0.5 flex items-center justify-center">
        {isActive && (
          <motion.div
            layoutId="nav-bg"
            className="absolute -inset-x-2.5 -inset-y-1 rounded-full bg-accent-primary-muted/20"
            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
          />
        )}
        {icon}
      </div>
      <span className="text-[10px] font-medium uppercase tracking-[0.1em]">{label}</span>
    </Link>
  );
}
