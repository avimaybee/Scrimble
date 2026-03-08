/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import Dashboard from './pages/Dashboard';
import NewProject from './pages/NewProject';
import ProjectCanvas from './pages/ProjectCanvas';
import Settings from './pages/Settings';
import AppLayout from './components/AppLayout';
import { Toaster } from 'sonner';
import { TooltipProvider } from './components/ui/tooltip';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthReady } = useAuthStore();
  
  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-bg-base text-text-primary">Loading...</div>;
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return <AppLayout>{children}</AppLayout>;
}

export default function App() {
  return (
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/signup" element={<AuthPage mode="signup" />} />
          
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />
          
          <Route path="/new" element={
            <ProtectedRoute>
              <NewProject />
            </ProtectedRoute>
          } />
          
          <Route path="/project/:id" element={
            <ProtectedRoute>
              <ProjectCanvas />
            </ProtectedRoute>
          } />
          
          <Route path="/settings" element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
      <Toaster theme="dark" />
    </TooltipProvider>
  );
}

