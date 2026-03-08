import React from 'react';
import PillNav from './PillNav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-base text-text-primary pb-[80px] flex flex-col">
      <div className="flex-1 flex flex-col">
        {children}
      </div>
      <PillNav />
    </div>
  );
}
