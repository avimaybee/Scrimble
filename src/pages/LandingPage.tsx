import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Hexagon, ArrowRight } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg-base text-text-primary font-sans selection:bg-accent-primary-muted selection:text-accent-primary overflow-hidden">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 h-[60px] bg-bg-base/85 backdrop-blur-[16px] border-b border-border-subtle z-50 flex items-center justify-between px-10 font-sans">
        <div className="flex items-center gap-2">
          <Hexagon className="w-5 h-5 text-accent-primary" />
          <span className="font-semibold text-[15px] tracking-tight text-text-primary">Scrimble</span>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/login" className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors">
            Sign in
          </Link>
          <Link to="/signup" className="btn-primary">
            Get started
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative pt-[60px]">
        <div className="absolute top-[-200px] right-[-100px] w-[700px] h-[700px] bg-[radial-gradient(ellipse_at_center,rgba(235,94,40,0.06)_0%,transparent_70%)] pointer-events-none"></div>
        
        <div className="grid lg:grid-cols-[52fr_48fr] items-center min-h-[calc(100vh-60px)] px-10 lg:px-20 gap-16 max-w-[1440px] mx-auto">
          {/* Left Column */}
          <div className="pt-20 lg:pt-0">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="badge mb-8"
            >
              Now in beta
            </motion.div>
            
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="text-hero"
            >
              <span className="display-bold">Build it. Ship it.</span>
              <span className="display-italic">Don't lose the thread.</span>
            </motion.h1>
            
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="text-body text-[17px] max-w-[480px] mb-10"
            >
              Scrimble keeps vibe coders on track — one step at a time, powered by AI.
            </motion.p>
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col sm:flex-row items-center gap-4"
            >
              <Link to="/signup" className="btn-primary w-full sm:w-auto text-center">
                Start building
              </Link>
              <a href="#how-it-works" className="btn-ghost w-full sm:w-auto text-center flex items-center justify-center gap-2">
                See how it works <ArrowRight className="w-4 h-4" />
              </a>
            </motion.div>
          </div>

          {/* Right Column - Canvas Mockup */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="hidden lg:block relative perspective-[1000px]"
          >
            <div className="transform rotate-[-12deg] rotate-x-[4deg] origin-center filter drop-shadow-[0_40px_80px_rgba(235,94,40,0.15)]">
              <div className="bg-bg-base border border-border-default rounded-2xl w-[600px] h-[400px] p-8 relative overflow-hidden bg-[radial-gradient(circle,rgba(204,197,185,0.05)_1px,transparent_1px)] bg-[size:28px_28px]">
                
                {/* Mock Nodes */}
                <div className="absolute top-12 left-12 w-[176px] bg-bg-surface border border-accent-border rounded-[10px] p-3 shadow-[0_0_0_1px_rgba(235,94,40,0.30),0_4px_20px_rgba(235,94,40,0.10)]">
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-stage-understand rounded-t-[10px]"></div>
                  <div className="text-label mb-2 text-stage-understand">Understand</div>
                  <div className="font-sans text-[12px] font-medium text-text-primary leading-[1.4] mb-3">Define Data Models</div>
                  <div className="h-[2px] bg-[rgba(204,197,185,0.08)] rounded-[2px] overflow-hidden">
                    <div className="h-full bg-accent-primary w-[60%]"></div>
                  </div>
                </div>

                <div className="absolute top-32 left-[240px] w-[176px] bg-bg-surface border border-[rgba(52,211,153,0.25)] rounded-[10px] p-3">
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-stage-build rounded-t-[10px]"></div>
                  <div className="text-label mb-2 text-stage-build">Build</div>
                  <div className="font-sans text-[12px] font-medium text-text-primary leading-[1.4] mb-3">Setup Auth</div>
                  <div className="h-[2px] bg-[rgba(204,197,185,0.08)] rounded-[2px] overflow-hidden">
                    <div className="h-full bg-status-secure w-full"></div>
                  </div>
                </div>

                <div className="absolute top-12 left-[460px] w-[176px] bg-bg-surface border border-border-default rounded-[10px] p-3 opacity-35">
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-stage-deploy rounded-t-[10px]"></div>
                  <div className="text-label mb-2 text-stage-deploy">Deploy</div>
                  <div className="font-sans text-[12px] font-medium text-text-primary leading-[1.4] mb-3">Production Release</div>
                  <div className="h-[2px] bg-[rgba(204,197,185,0.08)] rounded-[2px] overflow-hidden">
                    <div className="h-full bg-accent-primary w-0"></div>
                  </div>
                </div>

                {/* Mock Edges */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
                  <path d="M 188 48 C 214 48, 214 144, 240 144" fill="none" stroke="rgba(204,197,185,0.18)" strokeWidth="2" />
                  <path d="M 416 144 C 438 144, 438 48, 460 48" fill="none" stroke="rgba(204,197,185,0.18)" strokeWidth="2" strokeDasharray="4 4" />
                </svg>

              </div>
            </div>
          </motion.div>
        </div>
      </main>

      {/* Feature Sections */}
      <section id="how-it-works" className="py-[120px] border-t border-border-subtle">
        <div className="max-w-[1200px] mx-auto px-10 lg:px-20 space-y-[120px]">
          
          {/* Feature 1 */}
          <div className="grid md:grid-cols-2 gap-[80px] items-center">
            <div>
              <div className="text-label mb-4">The Canvas</div>
              <h2 className="text-heading mb-5">Your entire project, in one view</h2>
              <p className="text-body max-w-[380px]">
                Step-based plan showing every stage from idea to launch. Click to expand. Unlock as you go.
              </p>
            </div>
            <div className="bg-bg-base border border-border-default rounded-[14px] aspect-[4/3] flex items-center justify-center relative overflow-hidden bg-[radial-gradient(circle,rgba(204,197,185,0.05)_1px,transparent_1px)] bg-[size:28px_28px]">
              <div className="transform rotate-[8deg] filter drop-shadow-[0_20px_40px_rgba(235,94,40,0.10)] relative w-full h-full">
                 {/* Mock Nodes */}
                 <div className="absolute top-[20%] left-[10%] w-[160px] bg-bg-surface border border-[rgba(52,211,153,0.25)] rounded-[10px] p-3">
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-stage-understand rounded-t-[10px]"></div>
                  <div className="text-label mb-2 text-stage-understand">Understand</div>
                  <div className="font-sans text-[12px] font-medium text-text-primary leading-[1.4] mb-3">Requirements</div>
                  <div className="h-[2px] bg-[rgba(204,197,185,0.08)] rounded-[2px] overflow-hidden">
                    <div className="h-full bg-status-secure w-full"></div>
                  </div>
                </div>

                <div className="absolute top-[40%] left-[45%] w-[160px] bg-bg-surface border border-accent-border rounded-[10px] p-3 shadow-[0_0_0_1px_rgba(235,94,40,0.30),0_4px_20px_rgba(235,94,40,0.10)]">
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-stage-build rounded-t-[10px]"></div>
                  <div className="text-label mb-2 text-stage-build">Build</div>
                  <div className="font-sans text-[12px] font-medium text-text-primary leading-[1.4] mb-3">Core Features</div>
                  <div className="h-[2px] bg-[rgba(204,197,185,0.08)] rounded-[2px] overflow-hidden">
                    <div className="h-full bg-accent-primary w-[30%]"></div>
                  </div>
                </div>

                <div className="absolute top-[60%] left-[80%] w-[160px] bg-bg-surface border border-border-default rounded-[10px] p-3 opacity-35">
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-stage-deploy rounded-t-[10px]"></div>
                  <div className="text-label mb-2 text-stage-deploy">Deploy</div>
                  <div className="font-sans text-[12px] font-medium text-text-primary leading-[1.4] mb-3">Launch</div>
                  <div className="h-[2px] bg-[rgba(204,197,185,0.08)] rounded-[2px] overflow-hidden">
                    <div className="h-full bg-accent-primary w-0"></div>
                  </div>
                </div>

                {/* Mock Edges */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
                  <path d="M 170 30% C 220 30%, 220 50%, 270 50%" fill="none" stroke="rgba(204,197,185,0.18)" strokeWidth="2" />
                  <path d="M 430 50% C 480 50%, 480 70%, 530 70%" fill="none" stroke="rgba(204,197,185,0.18)" strokeWidth="2" strokeDasharray="4 4" />
                </svg>
              </div>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="grid md:grid-cols-2 gap-[80px] items-center">
            <div className="order-1 md:order-2">
              <div className="text-label mb-4">AI Generation</div>
              <h2 className="text-heading mb-5">Tell it what you're building. It handles the rest.</h2>
              <p className="text-body max-w-[380px]">
                AI generates your workflow, writes your docs, fills your checklists. You review and move forward.
              </p>
            </div>
            <div className="order-2 md:order-1 bg-bg-surface border border-border-default rounded-[14px] aspect-[4/3] flex items-center justify-center p-8">
              <div className="w-full max-w-[320px] space-y-6">
                <div>
                  <div className="text-label mb-2">Project Type</div>
                  <div className="bg-bg-elevated border border-accent-border rounded-lg p-3 shadow-[0_0_0_1px_rgba(235,94,40,0.30)]">
                    <div className="font-sans font-medium text-text-primary text-[14px]">SaaS MVP</div>
                    <div className="text-text-secondary text-[12px] mt-1">Full-stack web application</div>
                  </div>
                </div>
                <div>
                  <div className="text-label mb-2">Stack</div>
                  <div className="flex gap-2">
                    <span className="px-2 py-1 rounded-[4px] bg-bg-elevated border border-border-strong text-[11px] font-mono text-text-secondary">React</span>
                    <span className="px-2 py-1 rounded-[4px] bg-bg-elevated border border-border-strong text-[11px] font-mono text-text-secondary">Node.js</span>
                  </div>
                </div>
                <div className="pt-4 border-t border-border-subtle">
                  <div className="btn-primary w-full text-center opacity-80">Generate Workflow</div>
                </div>
              </div>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="grid md:grid-cols-2 gap-[80px] items-center">
            <div>
              <div className="text-label mb-4">Daily Focus</div>
              <h2 className="text-heading mb-5">Open it every morning. Know exactly what's next.</h2>
              <p className="text-body max-w-[380px]">
                Your project's state is always visible. No more lost context. No more "what was I doing?"
              </p>
            </div>
            <div className="bg-bg-surface border border-border-default rounded-[14px] aspect-[4/3] flex items-center justify-center p-8">
               <div className="w-full max-w-[320px] bg-bg-elevated border border-border-default rounded-[14px] p-[28px]">
                 <div className="flex items-center gap-3 mb-6">
                   <div className="w-10 h-10 rounded-[8px] bg-accent-primary-muted flex items-center justify-center border border-accent-border">
                     <Hexagon className="w-5 h-5 text-accent-primary" />
                   </div>
                   <div>
                     <div className="font-sans font-medium text-[16px] text-text-primary">SaaS MVP</div>
                     <div className="text-label mt-1">Next.js · Supabase</div>
                   </div>
                 </div>
                 <div className="space-y-3">
                   <div className="flex justify-between text-[12px] font-sans">
                     <span className="text-text-secondary">Progress</span>
                     <span className="text-text-primary font-medium">42%</span>
                   </div>
                   <div className="h-[2px] bg-[rgba(204,197,185,0.08)] rounded-[2px] overflow-hidden">
                     <div className="h-full bg-accent-primary w-[42%]"></div>
                   </div>
                   <div className="pt-4 mt-4 border-t border-border-subtle">
                     <div className="text-[12px] text-text-secondary mb-1">Next up</div>
                     <div className="font-sans text-[14px] text-text-primary flex items-center gap-2">
                       <ArrowRight className="w-3 h-3 text-accent-primary" /> Define data models
                     </div>
                   </div>
                 </div>
               </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border-subtle py-8 px-10">
        <div className="max-w-[1440px] mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2 text-text-tertiary">
            <Hexagon className="w-4 h-4" />
            <span className="text-sm font-sans">© 2026 Scrimble</span>
          </div>
          <div className="flex gap-6 text-sm font-sans text-text-tertiary">
            <a href="#" className="hover:text-text-primary transition-colors">Privacy</a>
            <a href="#" className="hover:text-text-primary transition-colors">Terms</a>
            <a href="#" className="hover:text-text-primary transition-colors">Twitter/X</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
