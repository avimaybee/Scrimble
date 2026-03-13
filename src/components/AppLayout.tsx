import React from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import PillNav from './PillNav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const showNav = location.pathname === '/dashboard'
    || location.pathname === '/settings'
    || Boolean(matchPath('/project/:id', location.pathname));

  return (
    <div className={`min-h-screen bg-bg-base text-text-primary ${showNav ? 'pb-[104px]' : 'pb-0'} flex flex-col`}>
      <div className="flex-1 flex flex-col">
        {children}
      </div>
      {showNav ? <PillNav /> : null}
    </div>
  );
}
