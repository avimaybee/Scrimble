import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThinkingBubbleProps {
  content?: string;
  isStreaming?: boolean;
  className?: string;
}

export function ThinkingBubble({ content, isStreaming, className }: ThinkingBubbleProps) {
  const normalizedContent = content?.trim() || '';
  const hasContent = normalizedContent.length > 0;

  return (
    <div className={cn("flex flex-col gap-2 max-w-[85%]", className)}>
      <div className="flex items-center gap-2 text-xs font-mono text-color-text-tertiary uppercase tracking-wider">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        >
          <Sparkles className="w-3 h-3 text-accent-primary" />
        </motion.div>
        <span>Agent Thoughts</span>
        {isStreaming && (
          <motion.span
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="text-[10px] text-accent-primary"
          >
            ●
          </motion.span>
        )}
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative group"
      >
        <div className="absolute -left-2 top-4 w-1 h-3/4 bg-accent-primary opacity-20 group-hover:opacity-40 transition-opacity rounded-full" />
        
        <div className="bg-bg-surface border border-border-default rounded-panel p-4 shadow-panel backdrop-blur-sm">
          {hasContent ? (
            <div className="text-sm leading-relaxed text-text-secondary whitespace-pre-wrap italic">
              {normalizedContent}
            </div>
          ) : isStreaming ? (
            <div className="flex items-center gap-3 text-sm text-text-tertiary italic">
              <Brain className="w-4 h-4 animate-pulse" />
              <span>Analyzing context and preparing next steps...</span>
            </div>
          ) : (
            <div className="text-sm text-text-tertiary italic">
              No model reasoning was emitted for this turn.
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
