import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { matchPath, useLocation } from 'react-router-dom';
import PillNav from './PillNav';
import Sidebar from './Sidebar';
import { cn } from '../lib/utils';

interface AppLayoutProps {
  children: React.ReactNode;
  rightPanel?: React.ReactNode;
  showSubNav?: boolean;
  subNav?: React.ReactNode;
}

export default function AppLayout({ children, rightPanel, showSubNav, subNav }: AppLayoutProps) {
  const location = useLocation();
  const contentTransitionKey = `${location.pathname}${location.search}`;
  const showNav = location.pathname === '/dashboard'
    || location.pathname === '/settings'
    || location.pathname === '/new'
    || Boolean(matchPath('/project/:id', location.pathname));

  const isSettings = location.pathname === '/settings';

  return (
    <div className="min-h-screen bg-bg-base text-text-primary flex flex-col lg:flex-row overflow-hidden">
      {showNav && <Sidebar />}

      <div className={cn(
        "flex-1 flex min-w-0 transition-all duration-300 overflow-y-auto",
        isSettings || showSubNav ? "flex-col lg:flex-row" : "flex-col",
        showNav ? "md:ml-[72px] xl:ml-[256px]" : ""
      )}>
        {showSubNav && subNav && (
          <aside className="hidden lg:flex w-[240px] shrink-0 bg-[#111111] border-r border-white/5 flex-col min-h-screen overflow-y-auto">
            {subNav}
          </aside>
        )}
        <main className={cn(
          "flex-1 flex flex-col w-full",
          !isSettings && "mx-auto max-w-[900px] px-6 lg:px-8",
          showNav ? "pb-[104px] lg:pb-0" : "pb-0",
          !isSettings && "bg-[#141414]"
        )}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={contentTransitionKey}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex flex-1 flex-col"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {showNav && rightPanel && (
        <aside id="right-panel-root" className="hidden lg:block w-[320px] shrink-0 border-l border-white/5 bg-bg-surface empty:hidden">
          {rightPanel}
        </aside>
      )}

      {showNav && (
        <div className="md:hidden">
          <PillNav />
        </div>
      )}
    </div>
  );
}
