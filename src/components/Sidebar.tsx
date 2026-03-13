import React, { useMemo, useState } from 'react';
import { Link, matchPath, useLocation } from 'react-router-dom';
import { LayoutPanelTop, LayoutGrid, Settings, Plus, Sparkles, LogOut, MoreHorizontal, Lock, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { useAuthStore } from '../store/authStore';
import { logout } from '../lib/firebase';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NewProjectModal } from './NewProjectModal';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

type NavTab = 'plan' | 'projects' | 'settings';

export default function Sidebar() {
  const location = useLocation();
  const { user } = useAuthStore();
  const projectMatch = matchPath('/project/:id', location.pathname);
  const projectPath = projectMatch ? `/project/${projectMatch.params.id}` : null;
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [isSignOutConfirmOpen, setIsSignOutConfirmOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const avatarInitial = (user?.displayName || user?.email || 'U').trim().charAt(0).toUpperCase();

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
    icon: React.ElementType;
    disabled?: boolean;
  }> = [
    {
      id: 'projects',
      label: 'Projects',
      to: '/dashboard',
      icon: LayoutGrid,
    },
    {
      id: 'plan',
      label: 'Plan',
      to: projectPath ?? undefined,
      icon: LayoutPanelTop,
      disabled: !projectPath,
    },
    {
      id: 'settings',
      label: 'Settings',
      to: '/settings',
      icon: Settings,
    },
  ];

  const handleConfirmSignOut = async () => {
    setIsSigningOut(true);
    try {
      await logout();
      setIsSignOutConfirmOpen(false);
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[72px] flex-col bg-[#0f0f0f] md:flex xl:w-64">
      <div className="flex h-14 items-center justify-center px-3 xl:justify-start xl:px-5">
        <Link to="/dashboard" className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-primary text-white shadow-[0_0_15px_rgba(235,94,40,0.3)]">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="hidden font-display text-base font-medium tracking-tight text-text-primary xl:inline">
            Scrimble
          </span>
        </Link>
      </div>

      <div className="flex flex-1 flex-col gap-2 px-2 py-6 xl:px-3">
        <nav className="flex flex-col gap-0.5">
          {items.map((item) => (
            <SidebarItem
              key={item.id}
              to={item.to}
              isActive={activeTab === item.id}
              icon={item.icon}
              label={item.label}
              disabled={item.disabled}
            />
          ))}
        </nav>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setIsNewProjectModalOpen(true)}
              className="group mt-4 flex items-center justify-center gap-2.5 rounded-lg border border-white/15 px-3 py-2.5 text-sm font-medium text-text-secondary transition-all duration-200 hover:border-white/25 hover:bg-white/4 hover:text-text-primary xl:justify-start"
            >
              <Plus className="h-4 w-4 transition-transform duration-[180ms] ease-out group-hover:rotate-90" />
              <span className="hidden xl:inline">New Project</span>
            </button>
          </TooltipTrigger>
          <TooltipContent className="xl:hidden">New project</TooltipContent>
        </Tooltip>
      </div>

      <div className="mt-auto border-t border-white/5 p-2 xl:p-3">
        <div 
          className="group flex items-center justify-center gap-3 rounded-xl p-2 transition-colors duration-200 hover:bg-white/4 xl:justify-start"
        >
          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/5">
            {user?.photoURL ? (
              <img src={user.photoURL} alt={user.displayName || 'User'} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center rounded-full bg-[linear-gradient(135deg,#E8581A_0%,#c44a14_100%)] text-[13px] font-semibold tracking-[0.02em] text-white">
                {avatarInitial}
              </span>
            )}
          </div>
          <div className="hidden flex-1 flex-col overflow-hidden xl:flex">
            <span className="truncate text-sm font-medium text-text-primary">
              {user?.displayName || 'Builder'}
            </span>
            <span className="truncate text-[11px] text-text-muted">{user?.email}</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary opacity-100 transition-all duration-200 hover:bg-white/10 hover:text-text-primary xl:opacity-0 xl:group-hover:opacity-100">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => setIsSignOutConfirmOpen(true)} className="text-status-error">
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex items-center justify-center border-t border-white/5 px-2 py-3 xl:justify-between xl:px-4">
        <div className="hidden items-center gap-2 text-[10px] text-text-muted xl:flex">
          <Lock className="h-3 w-3 text-status-secure" />
          <span className="h-1.5 w-1.5 rounded-full bg-status-secure" />
          <span>End-to-end encrypted</span>
        </div>
        <span className="hidden font-mono text-[10px] text-text-muted xl:inline">⌘K</span>
      </div>

      <NewProjectModal open={isNewProjectModalOpen} onOpenChange={setIsNewProjectModalOpen} />
      <Dialog open={isSignOutConfirmOpen} onOpenChange={(open) => !isSigningOut && setIsSignOutConfirmOpen(open)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Sign out of Scrimble?</DialogTitle>
            <DialogDescription>
              You&apos;ll need to sign back in to access your projects and plans.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsSignOutConfirmOpen(false)}
              disabled={isSigningOut}
              className="btn-secondary px-6"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmSignOut()}
              disabled={isSigningOut}
              className="btn-danger px-6"
            >
              {isSigningOut ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing out...
                </>
              ) : (
                'Sign out'
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function SidebarItem({
  to,
  isActive,
  icon: Icon,
  label,
  disabled = false,
}: {
  to?: string;
  isActive: boolean;
  icon: React.ElementType;
  label: string;
  disabled?: boolean;
}) {
  const tooltipLabel = disabled
    ? `${label} is available after you open a project.`
    : label;

  const content = (
    <>
      {isActive && (
        <motion.div
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-lg bg-white/6 border-l-[3px] border-accent-primary"
          initial={false}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
      )}
      <div className={cn(
        "relative z-10 flex min-h-10 items-center justify-center gap-3 px-3 xl:justify-start",
        isActive ? "text-accent-primary" : "text-text-secondary group-hover:text-text-primary"
      )}>
        <Icon className={cn("h-5 w-5", isActive ? "text-[rgba(230,100,30,0.9)]" : "text-[rgba(255,255,255,0.7)] group-hover:text-[rgba(255,255,255,0.95)]")} />
        <span className="hidden text-[14px] font-medium xl:inline">{label}</span>
      </div>
    </>
  );

  const classes = cn(
    'group relative rounded-lg transition-all duration-200',
    isActive ? '' : 'hover:bg-white/4',
    disabled ? 'cursor-not-allowed opacity-40' : '',
  );

  if (!to || disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div aria-disabled="true" className={classes}>
            {content}
          </div>
        </TooltipTrigger>
        <TooltipContent className={disabled ? undefined : 'xl:hidden'}>{tooltipLabel}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link to={to} className={classes}>
          {content}
        </Link>
      </TooltipTrigger>
      <TooltipContent className="xl:hidden">{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
}
