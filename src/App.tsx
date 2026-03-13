/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'framer-motion';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import Dashboard from './pages/Dashboard';
import NewProject from './pages/NewProject';
import ProjectGeneration from './pages/ProjectGeneration';
import ProjectCanvas from './pages/ProjectCanvas';
import Settings from './pages/Settings';
import AppLayout from './components/AppLayout';
import { Toaster } from 'sonner';
import { TooltipProvider } from './components/ui/tooltip';
import ErrorBoundary from './components/ErrorBoundary';
import FullscreenStatus from './components/ui/FullscreenStatus';

function RouteTransition({
  children,
  className = 'min-h-screen flex flex-col',
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={className}
    >
      {children || <Outlet />}
    </motion.div>
  );
}

function ProtectedRoute() {
  const { user, isAuthReady } = useAuthStore();
  
  if (!isAuthReady) {
    return (
      <FullscreenStatus
        label="Getting ready"
        title="Picking up where you left off"
        description="Checking your account and rebuilding the latest app state."
      />
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

function ProtectedFullscreenRoute() {
  const { user, isAuthReady } = useAuthStore();

  if (!isAuthReady) {
    return (
      <FullscreenStatus
        label="Getting ready"
        title="Picking up where you left off"
        description="Checking your account and reconnecting to the current build."
      />
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <RouteTransition className="min-h-screen flex flex-col bg-bg-base" />;
}

function AnimatedRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RouteTransition>
            <LandingPage />
          </RouteTransition>
        }
      />
      <Route
        path="/login"
        element={
          <RouteTransition>
            <AuthPage mode="login" />
          </RouteTransition>
        }
      />
      <Route
        path="/signup"
        element={
          <RouteTransition>
            <AuthPage mode="signup" />
          </RouteTransition>
        }
      />

      <Route element={<ProtectedFullscreenRoute />}>
        <Route path="/project/:id/generating" element={<ErrorBoundary name="Generation"><ProjectGeneration /></ErrorBoundary>} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<ErrorBoundary name="Dashboard"><Dashboard /></ErrorBoundary>} />
        <Route path="/new" element={<ErrorBoundary name="New Project"><NewProject /></ErrorBoundary>} />
        <Route path="/settings" element={<ErrorBoundary name="Settings"><Settings /></ErrorBoundary>} />
        <Route path="/project/:id" element={<ErrorBoundary name="Canvas"><ProjectCanvas /></ErrorBoundary>} />
        <Route path="/project" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <BrowserRouter>
        <AnimatedRoutes />
      </BrowserRouter>
      <Toaster
        theme="dark"
        position="bottom-right"
        expand={false}
        toastOptions={{
          duration: 4000,
          classNames: {
            toast: 'scrimble-toast !rounded-[14px] !border !border-border-default !bg-bg-surface !text-text-primary !shadow-panel',
            title: '!font-sans !text-[14px] !font-medium !text-text-primary',
            description: '!font-sans !text-[13px] !text-text-secondary',
            actionButton: '!bg-accent-primary !text-text-primary',
            cancelButton: '!bg-bg-elevated !text-text-secondary',
          },
        }}
      />
    </TooltipProvider>
  );
}
