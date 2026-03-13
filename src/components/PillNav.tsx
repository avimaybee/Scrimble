import React, { useMemo } from 'react';
import { Link, matchPath, useLocation } from 'react-router-dom';
import { LayoutPanelTop, LayoutGrid, Settings } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';

type NavTab = 'plan' | 'projects' | 'settings';

export default function PillNav() {
  const location = useLocation();
  const projectMatch = matchPath('/project/:id', location.pathname);
  const projectPath = projectMatch ? `/project/${projectMatch.params.id}` : null;

  const activeTab = useMemo<NavTab | null>(() => {
    if (projectMatch) {
      return 'plan';
    }

    if (location.pathname === '/dashboard') {
      return 'projects';
    }

    if (location.pathname === '/settings') {
      return 'settings';
    }

    return null;
  }, [location.pathname, projectMatch]);

  const items: Array<{
    id: NavTab;
    label: string;
    to?: string;
    icon: React.ReactNode;
    disabled?: boolean;
  }> = [
    {
      id: 'plan',
      label: 'Plan',
      to: projectPath ?? undefined,
      icon: <LayoutPanelTop className="h-4 w-4" />,
      disabled: !projectPath,
    },
    {
      id: 'projects',
      label: 'Projects',
      to: '/dashboard',
      icon: <LayoutGrid className="h-4 w-4" />,
    },
    {
      id: 'settings',
      label: 'Settings',
      to: '/settings',
      icon: <Settings className="h-4 w-4" />,
    },
  ];

  return (
    <motion.div
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
    >
      <nav
        aria-label="App navigation"
        className="surface-panel flex items-center gap-1 p-1.5 shadow-[0_18px_42px_rgba(0,0,0,0.42)]"
      >
        {items.map((item) => (
          <NavItem
            key={item.id}
            to={item.to}
            isActive={activeTab === item.id}
            icon={item.icon}
            label={item.label}
            disabled={item.disabled}
          />
        ))}
      </nav>
    </motion.div>
  );
}

function NavItem({
  to,
  isActive,
  icon,
  label,
  disabled = false,
}: {
  to?: string;
  isActive: boolean;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  const content = (
    <>
      {isActive ? (
        <motion.div
          layoutId="pill-nav-active"
          className="absolute inset-0 rounded-[12px] border border-accent-border bg-accent-primary-muted"
          transition={{ type: 'spring', stiffness: 240, damping: 24 }}
        />
      ) : null}
      <span className="relative z-10 flex items-center gap-2">
        {icon}
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]">{label}</span>
      </span>
    </>
  );

  const classes = cn(
    'relative inline-flex h-11 min-w-[112px] items-center justify-center rounded-[12px] px-4 text-text-tertiary transition-colors duration-200',
    isActive ? 'text-text-primary' : 'hover:text-text-secondary',
    disabled ? 'cursor-not-allowed opacity-45 hover:text-text-tertiary' : '',
  );

  if (!to || disabled) {
    return (
      <span aria-disabled="true" className={classes}>
        {content}
      </span>
    );
  }

  return (
    <Link to={to} className={classes}>
      {content}
    </Link>
  );
}
