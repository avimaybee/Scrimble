import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { dbService } from '../lib/db';
import { useAuthStore } from '../store/authStore';

export default function PlanRoute() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function findLatestPlan() {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const projects = await dbService.getProjectsByUserId(user.uid);
        if (projects.length > 0) {
          // Sort by updated_at descending or similar if exists. Usually getProjects returns newest first or we can just pick the first.
          const activeProj = projects[0];
          navigate(`/project/${activeProj.id}`, { replace: true });
        } else {
          // No active plan
          setLoading(false);
        }
      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    }
    findLatestPlan();
  }, [user, navigate]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-base">
        <div className="animate-pulse flex items-center gap-2 text-text-secondary">
          <div className="w-2 h-2 rounded-full bg-accent-primary" />
          Loading plan...
        </div>
      </div>
    );
  }

  // If no user or no project
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-bg-base text-center px-4">
      <div className="mb-4 w-12 h-12 rounded-full bg-border-subtle flex items-center justify-center">
        <svg className="w-6 h-6 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-text-primary mb-2">No Active Plan</h2>
      <p className="text-text-secondary mb-6 max-w-md">
        You don't have an active project plan right now. Head back to the dashboard to create one.
      </p>
      <button className="btn-primary" onClick={() => navigate('/dashboard')}>
        Go to Dashboard
      </button>
    </div>
  );
}
