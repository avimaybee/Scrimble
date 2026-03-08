import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutGrid, PlusSquare, Settings } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export default function PillNav() {
  const location = useLocation();

  const isNewProject = location.pathname === '/new';
  const isSettings = location.pathname === '/settings';
  const isProject = location.pathname.startsWith('/project/');
  const isDashboard = location.pathname === '/dashboard';
  
  const activeTab = useMemo(() => {
    if (isDashboard) return 'dashboard';
    if (isProject) return 'plan';
    if (isSettings) return 'settings';
    return null;
  }, [isDashboard, isProject, isSettings]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.4, duration: 0.8 }}
        className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
      >
        <div className="relative rounded-[16px] border border-border-default bg-bg-surface/90 p-2 shadow-lg backdrop-blur-xl">
          <div className="flex items-center justify-center gap-1">
            <div className="flex items-center gap-1">
              <NavItem
                to="/dashboard"
                isActive={activeTab === 'dashboard'}
                icon={<LayoutGrid className="h-5 w-5" />}
                label="Explore"
              />
              <NavItem
                to="/new"
                isActive={activeTab === 'plan'}
                icon={<PlusSquare className="h-5 w-5" />}
                label="Plan"
              />
              <NavItem
                to="/settings"
                isActive={activeTab === 'settings'}
                icon={<Settings className="h-5 w-5" />}
                label="Adjust"
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
}: {
  to: string;
  isActive: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group relative flex flex-col items-center justify-center py-1 transition-all duration-200',
        isActive ? 'text-accent-primary' : 'text-text-tertiary hover:text-text-secondary'
      )}
    >
      <div className="relative mb-0.5 flex items-center justify-center">
        {isActive && (
          <motion.div
            layoutId="nav-bg"
            className="absolute -inset-x-3 -inset-y-1.5 rounded-[8px] bg-accent-primary-muted/20"
            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
          />
        )}
        {icon}
      </div>
      <span className="text-[10px] font-medium uppercase tracking-[0.1em]">{label}</span>
    </Link>
  );
}
