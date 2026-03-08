import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Hexagon, ArrowRight, User as UserIcon, LogOut, Settings } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { dbService } from '../lib/db';
import { Project } from '../types';
import { logout } from '../lib/firebase';

export default function Dashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [greeting, setGreeting] = useState('Good morning.');

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good morning.');
    else if (hour < 18) setGreeting('Good afternoon.');
    else setGreeting('Good evening.');
  }, []);

  useEffect(() => {
    if (!user) return;
    
    async function fetchProjects() {
      try {
        const data = await dbService.getProjectsByUserId(user.uid);
        // In a real V4.0 app, we might fetch stages here too, 
        // but for the UI mockup/sync, we'll derive "stages" from progress.
        setProjects(data);
      } catch (error) {
        console.error("Error fetching projects:", error);
      } finally {
        setLoading(false);
      }
    }
    
    fetchProjects();
  }, [user]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <main className="pt-24 pb-24 px-6 max-w-6xl mx-auto w-full font-sans">
      <header className="flex justify-between items-end mb-12">
        <div>
          <h1 className="text-4xl font-serif text-text-primary mb-2">{greeting}</h1>
          <p className="text-text-secondary text-lg">Here's where your projects stand.</p>
        </div>
        <Link to="/new" className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Start something new
        </Link>
      </header>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Hexagon className="w-10 h-10 text-accent-primary animate-spin mb-4" />
          <p className="text-text-tertiary font-mono text-sm uppercase tracking-widest">Loading projects...</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-bg-surface border border-dashed border-border-strong rounded-3xl p-16 text-center">
          <div className="w-16 h-16 bg-bg-elevated rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Hexagon className="w-8 h-8 text-text-tertiary" />
          </div>
          <h2 className="text-2xl font-medium text-text-primary mb-2">You haven't started anything yet.</h2>
          <p className="text-text-secondary mb-8 max-w-md mx-auto">
            Tell Scrimble what you want to build and we'll architect the entire path to production for you.
          </p>
          <Link to="/new" className="btn-primary inline-flex items-center gap-2">
            Architect my first project
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {projects.map((project, idx) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              onClick={() => navigate(`/project/${project.id}`)}
              className="group cursor-pointer bg-bg-surface border border-border-default hover:border-accent-border rounded-2xl p-6 shadow-panel transition-all duration-300 hover:shadow-panel-hover relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-1 h-full bg-accent-primary opacity-0 group-hover:opacity-100 transition-opacity" />
              
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-xl font-medium text-text-primary group-hover:text-accent-primary transition-colors mb-1">
                    {project.name}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-tertiary uppercase tracking-wider">
                      {project.project_type.replace('_', ' ')}
                    </span>
                    <span className="text-text-muted">•</span>
                    <span className="text-xs text-text-tertiary">
                      Updated recently
                    </span>
                  </div>
                </div>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(stage => (
                    <div 
                      key={stage} 
                      className={`w-1.5 h-1.5 rounded-full ${stage <= Math.ceil((project.progress / 100) * 8) ? 'bg-accent-primary shadow-[0_0_6px_rgba(235,94,40,0.5)]' : 'bg-bg-elevated'}`} 
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Progress</span>
                  <span className="font-mono text-accent-primary font-medium">{project.progress}%</span>
                </div>
                <div className="h-1.5 w-full bg-bg-elevated rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${project.progress}%` }}
                    transition={{ duration: 1, delay: 0.5 }}
                    className="h-full bg-accent-primary relative"
                  >
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                  </motion.div>
                </div>

                <div className="pt-4 border-t border-border-subtle flex items-center justify-between mt-4">
                  <div className="flex gap-2">
                    {JSON.parse(project.stack || '{}').frontend && (
                      <span className="text-[10px] font-mono text-text-muted uppercase tracking-widest bg-bg-elevated px-2 py-0.5 rounded">
                        {JSON.parse(project.stack).frontend}
                      </span>
                    )}
                    {JSON.parse(project.stack || '{}').database && (
                      <span className="text-[10px] font-mono text-text-muted uppercase tracking-widest bg-bg-elevated px-2 py-0.5 rounded">
                        {JSON.parse(project.stack).database}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-accent-primary opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all">
                    <span className="text-xs font-medium">Continue</span>
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </main>
  );
}
