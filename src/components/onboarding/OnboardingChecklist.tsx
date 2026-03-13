import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronRight, X } from 'lucide-react';
import { useOnboardingStore, getOnboardingProgress } from '../../store/onboardingStore';
import { cn } from '../../lib/utils';
import { formatStepCount } from '../../lib/formatting';

interface OnboardingChecklistProps {
  hasAIKey: boolean;
  hasBuilderProfile: boolean;
  hasProjects: boolean;
}

interface ChecklistItemProps {
  label: string;
  isComplete: boolean;
  onClick?: () => void;
}

function ChecklistItem({ label, isComplete, onClick }: ChecklistItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isComplete}
      className={cn(
        "flex items-center justify-between w-full py-2 px-3 -mx-3 rounded-lg transition-colors",
        isComplete 
          ? "cursor-default" 
          : "hover:bg-bg-elevated/50 cursor-pointer"
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex items-center justify-center h-5 w-5 rounded-full border",
          isComplete 
            ? "bg-status-secure border-status-secure" 
            : "border-border-default"
        )}>
          {isComplete && <Check className="h-3 w-3 text-bg-base" strokeWidth={3} />}
        </div>
        <span className={cn(
          "text-sm",
          isComplete ? "text-text-secondary" : "text-text-primary"
        )}>
          {label}
        </span>
      </div>
      {!isComplete && (
        <ChevronRight className="h-4 w-4 text-text-tertiary" />
      )}
    </button>
  );
}

export default function OnboardingChecklist({
  hasAIKey,
  hasBuilderProfile,
  hasProjects,
}: OnboardingChecklistProps) {
  const navigate = useNavigate();
  const onboardingState = useOnboardingStore();
  const { completedSteps, dismiss } = onboardingState;
  
  const progress = getOnboardingProgress(onboardingState);

  const items = [
    { label: 'Sign in', isComplete: true },
    { label: 'Add an AI key', isComplete: hasAIKey },
    { label: 'Complete your builder profile', isComplete: hasBuilderProfile },
    { label: 'Start your first project', isComplete: hasProjects },
  ];

  const completedCount = items.filter(item => item.isComplete).length;

  if (completedCount === 4) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative rounded-xl border-l-[3px] border-accent-primary bg-bg-surface p-5 shadow-panel mb-6"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-primary">
          Get started with Scrimble
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-accent-primary">
            {formatStepCount(completedCount, 4)} complete
          </span>
          <button
            type="button"
            onClick={dismiss}
            className="p-1 rounded hover:bg-bg-elevated transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4 text-text-tertiary" />
          </button>
        </div>
      </div>

      <div className="h-1.5 w-full rounded-full bg-bg-elevated mb-4 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="h-full rounded-full bg-accent-primary"
        />
      </div>

      <div className="space-y-1">
        <ChecklistItem 
          label="Sign in" 
          isComplete={true}
        />
        <ChecklistItem 
          label="Add an AI key" 
          isComplete={hasAIKey}
          onClick={() => navigate('/settings', { state: { scrollTo: 'ai' } })}
        />
        <ChecklistItem 
          label="Complete your builder profile" 
          isComplete={hasBuilderProfile}
          onClick={() => navigate('/settings', { state: { scrollTo: 'profile' } })}
        />
        <ChecklistItem 
          label="Start your first project" 
          isComplete={hasProjects}
          onClick={() => navigate('/new')}
        />
      </div>
    </motion.div>
  );
}
