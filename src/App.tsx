/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BrowserRouter, Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';
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

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

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
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
      className={className}
    >
      {children || <Outlet />}
    </motion.div>
  );
}

function ProtectedRoute() {
  const { user, isAuthReady } = useAuthStore();
  
  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-bg-base text-text-primary uppercase tracking-widest text-[10px]">Loading...</div>;
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return (
    <AppLayout>
      <RouteTransition className="flex flex-1 flex-col" />
    </AppLayout>
  );
}

function ProtectedFullscreenRoute() {
  const { user, isAuthReady } = useAuthStore();

  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-bg-base text-text-primary uppercase tracking-widest text-[10px]">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <RouteTransition className="min-h-screen flex flex-col bg-bg-base" />;
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location}>
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
        </Route>

        <Route path="/project" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <BrowserRouter>
        <AnimatedRoutes />
      </BrowserRouter>
      <Toaster theme="dark" position="bottom-right" richColors />
    </TooltipProvider>
  );
}
