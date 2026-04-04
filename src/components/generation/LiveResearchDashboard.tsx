import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, FileText, Blocks, Target, SkipForward, AlertTriangle, Zap, Server, LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ProjectGenerationStatusResponse, ProjectGenerationEvent } from '../../types';

export interface LiveResearchDashboardProps {
  status: ProjectGenerationStatusResponse | null;
  events: ProjectGenerationEvent[];
  onSkip?: () => void;
  isSkipping?: boolean;
  activityFeed?: { timestamp: string; message: string; icon: string }[];
}

const METRIC_CARD_STYLES = "relative flex-1 overflow-hidden rounded-[20px] border border-white/5 bg-black/40 p-6 backdrop-blur-md transition-all duration-500 hover:border-white/10 hover:bg-white/[0.02]";

export function LiveResearchDashboard({ 
  status, 
  events, 
  onSkip, 
  isSkipping,
  activityFeed = []
}: LiveResearchDashboardProps) {

  // We look for any relevant SSE events that might contain stats.
  // In a real scenario, the backend would send these via streamEvents.
  // For now, we aggregate some mock or real stats from the stream.
  const stats = useMemo(() => {
    let chunks = 0;
    let sources = 0;
    let evidence = 0;
    let tokens = 0;
    
    // Scan events backwards to find the latest metrics
    const reversedEvents = [...events].reverse();
    for (const evt of reversedEvents) {
      if ((evt as any).type === 'batch_progress' && (evt as any).metrics) {
        const m = (evt as any).metrics;
        if (m.chunks !== undefined && chunks === 0) chunks = m.chunks;
        if (m.sources !== undefined && sources === 0) sources = m.sources;
        if (m.evidence !== undefined && evidence === 0) evidence = m.evidence;
        if (m.tokens !== undefined && tokens === 0) tokens = m.tokens;
      }
    }

    return { chunks, sources, evidence, tokens };
  }, [events]);

  const ongoingTech = useMemo(() => {
    if (!activityFeed.length) return 'Initializing...';
    // Just grab the latest message as the target being researched
    return activityFeed[0].message;
  }, [activityFeed]);

  const TOKEN_LIMIT = 50000;
  const tokenPercentage = Math.min(100, Math.max(0, (stats.tokens / TOKEN_LIMIT) * 100));

  return (
    <div className="w-full max-w-[1400px] px-6 py-12 mx-auto">
      <div className="mb-10 w-full flex items-end justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-[#00E5FF] mb-3 flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-[#00E5FF] animate-pulse" />
            Active Collection
          </div>
          <h1 className="font-serif text-[44px] leading-none text-white tracking-tight">
            Research Canvas
          </h1>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8 items-start">
        
        {/* Left Column: Canvas */}
        <div className="flex flex-col gap-6">
          
          {/* Active Target Card */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="group relative overflow-hidden rounded-[32px] border border-white/5 bg-[#0a0a0a] p-8 shadow-2xl shadow-black/50"
          >
            <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#00E5FF]/20 to-transparent" />
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#00E5FF]/[0.03] rounded-full blur-[100px] pointer-events-none translate-x-1/3 -translate-y-1/4" />
            
            <div className="relative z-10 flex flex-col md:flex-row md:items-start justify-between gap-8 mb-10">
              <div>
                <div className="font-mono text-[12px] text-white/40 uppercase tracking-widest mb-3">Priority Target</div>
                <div className="font-sans text-[28px] font-semibold text-white tracking-tight leading-tight">
                  {ongoingTech}
                </div>
              </div>
              
              {onSkip && (
                <button
                  type="button"
                  disabled={isSkipping}
                  onClick={onSkip}
                  className="shrink-0 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 font-mono text-[12px] text-white/70 transition-all hover:bg-white/10 hover:text-white"
                >
                  {isSkipping ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <SkipForward className="h-3.5 w-3.5" />}
                  [ SKIP TARGET ]
                </button>
              )}
            </div>

            {/* Metrics Row */}
            <div className="relative z-10 flex flex-col sm:flex-row gap-4">
              <div className={METRIC_CARD_STYLES}>
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/5">
                  <FileText className="h-4 w-4 text-[#00E5FF]" />
                </div>
                <div className="font-mono text-[11px] text-white/40 uppercase tracking-wider mb-2">Sources</div>
                <div className="font-mono text-[36px] font-light text-white leading-none tracking-tighter">
                  {stats.sources.toString().padStart(2, '0')}
                </div>
              </div>

              <div className={METRIC_CARD_STYLES}>
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/5">
                  <Blocks className="h-4 w-4 text-[#00E5FF]" />
                </div>
                <div className="font-mono text-[11px] text-white/40 uppercase tracking-wider mb-2">Extracted Chunks</div>
                <div className="font-mono text-[36px] font-light text-white leading-none tracking-tighter">
                  {stats.chunks.toLocaleString()}
                </div>
              </div>

              <div className={METRIC_CARD_STYLES}>
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[#00E5FF]/10">
                  <Layers className="h-4 w-4 text-[#00E5FF]" />
                </div>
                <div className="font-mono text-[11px] text-[#00E5FF]/60 uppercase tracking-wider mb-2">Evidence Packs</div>
                <div className="font-mono text-[36px] font-light text-[#00E5FF] leading-none tracking-tighter">
                  {stats.evidence.toString().padStart(2, '0')}
                </div>
              </div>
            </div>
          </motion.div>

          {/* Activity Feed / Matrix Stream */}
          <div className="w-full flex-1 rounded-[32px] border border-white/5 bg-[#050505] p-8 min-h-[300px]">
            <div className="flex items-center gap-3 mb-6">
              <Server className="h-4 w-4 text-white/30" />
              <div className="font-mono text-[11px] uppercase tracking-widest text-white/30">System Telemetry</div>
            </div>
            
            <div className="space-y-3 font-mono text-[13px] h-[320px] overflow-y-auto pr-4 custom-scrollbar">
              <AnimatePresence initial={false}>
                {activityFeed.slice(0, 15).map((item, idx) => (
                  <motion.div
                    key={`${item.timestamp}-${idx}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex gap-4 items-start"
                  >
                    <span className="text-white/20 shrink-0 select-none">
                      {new Date(item.timestamp).toISOString().split('T')[1]}
                    </span>
                    <span className="text-white/60">
                      {item.message}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Right Column: Inspector Sidebar */}
        <div className="flex flex-col gap-6 sticky top-8">
          
          {/* Token Budget Gauge */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="rounded-[24px] border border-white/5 bg-[#0a0a0a] p-6"
          >
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-[#F59E0B]" />
                <span className="font-mono text-[11px] uppercase tracking-widest text-[#F59E0B]">Token Payload</span>
              </div>
              <div className="font-mono text-[11px] text-white/40">
                {stats.tokens.toLocaleString()} / {TOKEN_LIMIT.toLocaleString()}
              </div>
            </div>

            <div className="relative h-3 w-full overflow-hidden rounded-full bg-white/5">
              <motion.div 
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  tokenPercentage > 85 ? "bg-[#EF4444]" : tokenPercentage > 60 ? "bg-[#F59E0B]" : "bg-white/80"
                )}
                initial={{ width: 0 }}
                animate={{ width: `${tokenPercentage}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
            {tokenPercentage > 85 && (
              <div className="mt-4 flex items-start gap-2 text-[#EF4444] text-[12px] font-mono leading-tight">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                Capacity warning. Engine might aggressively truncate remaining context to fit budget.
              </div>
            )}
          </motion.div>

          <div className="rounded-[24px] border border-white/5 bg-[#0a0a0a] p-6">
             <div className="font-mono text-[11px] uppercase tracking-widest text-white/40 mb-6">Engine Specifications</div>
             <div className="space-y-4">
                <div className="flex justify-between font-mono text-[12px]">
                   <span className="text-white/30">Vector Indexing:</span>
                   <span className="text-[#00E5FF]">ACTIVE</span>
                </div>
                <div className="flex justify-between font-mono text-[12px]">
                   <span className="text-white/30">Auto-Recovery:</span>
                   <span className="text-white/70">ENABLED</span>
                </div>
                <div className="flex justify-between font-mono text-[12px]">
                   <span className="text-white/30">RAG Mode:</span>
                   <span className="text-white/70">DEEP</span>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}