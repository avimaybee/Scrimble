import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Compass, Settings } from 'lucide-react';
import { cn } from '../lib/utils';

const navItems = [
  { icon: Compass, label: 'Plan', path: '/project' }, // Will need to handle dynamic project ID or redirect to last active
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

export default function PillNav() {
  return (
    <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-bg-surface/90 backdrop-blur-xl border border-border-default px-2 py-2 rounded-2xl shadow-lg z-50 flex items-center gap-1">
      {navItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) => cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 group",
            isActive 
              ? "bg-accent-primary-muted text-accent-primary" 
              : "text-text-tertiary hover:text-text-primary hover:bg-bg-elevated"
          )}
        >
          <item.icon className="w-4 h-4" />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
