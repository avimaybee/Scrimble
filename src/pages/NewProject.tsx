import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Hexagon, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { dbService } from '../lib/db';
import { generatePlan } from '../lib/ai';

export default function NewProject() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!user || !prompt.trim()) return;
    setLoading(true);
    setError('');
    
    try {
      setLoadingText('Architecting your project...');
      const planData = await generatePlan(prompt);
      
      setLoadingText('Initializing database...');
      const projectId = await dbService.createProject({
        user_id: user.uid,
        name: planData.project_name || 'Untitled Project',
        description: prompt.substring(0, 100) + '...',
        project_type: planData.project_type || 'custom',
        stack: JSON.stringify(planData.stack || {}),
        status: 'active'
      });

      const planId = await dbService.createPlan({
        project_id: projectId,
        version: 1,
        canvas_state: JSON.stringify({ x: 0, y: 0, zoom: 1 })
      });

      let globalStepOrder = 0;
      let prevStepId: string | null = null;

      setLoadingText('Building stages and steps...');

      for (const stage of planData.stages || []) {
        const stageId = await dbService.createStage({
          project_id: projectId,
          title: stage.title,
          type: stage.type,
          order_index: stage.order,
          status: stage.order === 0 ? 'active' : 'locked'
        });

        for (let i = 0; i < (stage.steps || []).length; i++) {
          const step = stage.steps[i];
          
          const stepId = await dbService.createStep({
            project_id: projectId,
            stage_id: stageId,
            title: step.title,
            type: step.type || 'task',
            category: stage.type,
            position_x: i * 250,
            position_y: stage.order * 400 + 100,
            status: (stage.order === 0 && i === 0) ? 'active' : 'locked',
            is_gate: step.is_gate || false,
            risk_level: step.risk_level || 'low',
            objective: step.objective || '',
            why_it_matters: step.why_it_matters || '',
            suggested_tools: JSON.stringify(step.suggested_tools || []),
            done_when: step.done_when || '',
            is_ai_enriched: false,
            order_index: globalStepOrder++
          });

          for (let j = 0; j < (step.checklist || []).length; j++) {
            const item = step.checklist[j];
            await dbService.createChecklistItem({
              step_id: stepId,
              label: item.label,
              is_required: item.is_required || false,
              is_completed: false,
              order_index: j
            });
          }

          if (prevStepId) {
            await dbService.createEdge({
              project_id: projectId,
              source_step_id: prevStepId,
              target_step_id: stepId,
              edge_type: 'default'
            });
          }
          prevStepId = stepId;
        }
      }

      setLoadingText('Almost ready...');
      setTimeout(() => {
        navigate(`/project/${projectId}`);
      }, 500);

    } catch (err: any) {
      console.error("Error generating plan:", err);
      setLoading(false);
      setError(err.message || "Failed to generate plan. Please check your API keys or try again.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base text-text-primary flex flex-col items-center justify-center font-sans">
        <motion.div
           animate={{ 
            scale: [1, 1.2, 1],
            rotate: [0, 180, 360],
            borderRadius: ["20%", "50%", "20%"]
          }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="w-16 h-16 bg-accent-primary-muted flex items-center justify-center mb-8"
        >
          <Sparkles className="w-8 h-8 text-accent-primary" />
        </motion.div>
        <motion.p
          key={loadingText}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="text-xl font-medium tracking-tight"
        >
          {loadingText}
        </motion.p>
      </div>
    );
  }

  return (
    <main className="pt-24 pb-16 px-6 max-w-3xl mx-auto w-full font-sans">
      <AnimatePresence mode="wait">
        <motion.div
          key="chat-input"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="space-y-8"
        >
          <div className="text-center mb-12">
            <motion.div 
               initial={{ scale: 0.8, opacity: 0 }}
               animate={{ scale: 1, opacity: 1 }}
               transition={{ delay: 0.2 }}
               className="w-16 h-16 bg-bg-elevated rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-node"
            >
              <Sparkles className="w-8 h-8 text-accent-primary" />
            </motion.div>
            <h1 className="text-4xl md:text-5xl font-serif text-text-primary tracking-tight mb-4">
              What do you want to build?
            </h1>
            <p className="text-lg text-text-secondary max-w-xl mx-auto">
              Describe your idea naturally. We'll architect the database, infrastructure, and an exact step-by-step path to get it to production.
            </p>
          </div>

          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-accent-primary to-accent-primary-muted rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
            <div className="relative bg-bg-surface border border-border-default rounded-2xl p-2 shadow-panel">
              <textarea 
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="e.g. A SaaS platform for dog walkers with Stripe subscriptions, built on Next.js and Supabase..."
                className="w-full bg-transparent p-4 text-text-primary placeholder:text-text-tertiary outline-none min-h-[160px] resize-none font-sans text-[17px] leading-relaxed"
                autoFocus
              />
              <div className="flex justify-between items-center px-4 pb-2">
                <div className="text-xs text-text-tertiary">
                  Powered by your BYO AI Key
                </div>
                <button 
                  onClick={handleGenerate}
                  disabled={!prompt.trim()}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  Architect it
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>
          </div>
          
          {error && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              className="text-status-error text-center p-4 bg-status-error/10 rounded-xl"
            >
              <p>{error}</p>
              {error.includes('settings') && (
                <button onClick={() => navigate('/settings')} className="mt-2 text-sm underline font-medium">
                  Go to Settings
                </button>
              )}
            </motion.div>
          )}

        </motion.div>
      </AnimatePresence>
    </main>
  );
}
