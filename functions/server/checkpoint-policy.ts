/**
 * Checkpoint Policy
 *
 * Centralized checkpoint trigger logic for the generation pipeline.
 * Batches use this module instead of duplicating checkpoint decisions.
 *
 * Checkpoint triggers:
 *   - Budget exhaustion: Subrequest count approaches limit
 *   - Progress interval: Item/step count crosses threshold
 *   - Combined: Either condition met
 */

import type { GenerationBatchName } from './types';

export type CheckpointBatchConfig = {
  /**
   * Maximum subrequest budget for this batch.
   * When count >= maxBudget - reserve, checkpoint is triggered.
   */
  maxBudget: number;

  /**
   * Reserved subrequests for finalization (e.g., saving results).
   */
  subrequestReserve: number;

  /**
   * Number of items processed before triggering a checkpoint.
   * 0 means interval-based checkpointing is disabled.
   */
  checkpointInterval: number;

  /**
   * Whether this batch supports checkpointing at all.
   */
  supportsCheckpoint: boolean;
};

const BATCH_CHECKPOINT_CONFIGS: Record<GenerationBatchName, CheckpointBatchConfig> = {
  batch_1_research_stack: {
    maxBudget: 35,
    subrequestReserve: 5,
    checkpointInterval: 0, // No checkpointing for batch 1
    supportsCheckpoint: false,
  },
  batch_2_fetch_and_read: {
    maxBudget: 35,
    subrequestReserve: 5,
    checkpointInterval: 20,
    supportsCheckpoint: true,
  },
  batch_3_architect: {
    maxBudget: 35,
    subrequestReserve: 5,
    checkpointInterval: 0, // No checkpointing for architect
    supportsCheckpoint: false,
  },
  batch_4_plan_build: {
    maxBudget: 35,
    subrequestReserve: 5,
    checkpointInterval: 0, // No checkpointing for plan build
    supportsCheckpoint: false,
  },
  batch_5_enrich_steps: {
    maxBudget: 40,
    subrequestReserve: 8,
    checkpointInterval: 8, // Checkpoint every 8 steps
    supportsCheckpoint: true,
  },
  batch_6_generate_files: {
    maxBudget: 35,
    subrequestReserve: 5,
    checkpointInterval: 0, // No checkpointing for file generation
    supportsCheckpoint: false,
  },
};

export function getCheckpointConfig(batchName: GenerationBatchName): CheckpointBatchConfig {
  return BATCH_CHECKPOINT_CONFIGS[batchName];
}

export type CheckpointDecision = {
  shouldCheckpoint: boolean;
  reason: 'budget' | 'interval' | 'none';
};

export type CheckpointContext = {
  batchName: GenerationBatchName;
  subrequestCount: number;
  itemIndex: number;
  startIndex: number;
  totalItems: number;
};

/**
 * Determine whether a checkpoint should be saved.
 *
 * @param context - Current execution context
 * @returns Decision object with reason
 */
export function shouldCheckpoint(context: CheckpointContext): CheckpointDecision {
  const config = BATCH_CHECKPOINT_CONFIGS[context.batchName];

  if (!config.supportsCheckpoint) {
    return { shouldCheckpoint: false, reason: 'none' };
  }

  // Don't checkpoint on last item
  if (context.itemIndex + 1 >= context.totalItems) {
    return { shouldCheckpoint: false, reason: 'none' };
  }

  // Budget exhaustion check
  const budgetRemaining = config.maxBudget - context.subrequestCount;
  if (budgetRemaining <= config.subrequestReserve) {
    return { shouldCheckpoint: true, reason: 'budget' };
  }

  // Progress interval check (if configured)
  if (config.checkpointInterval > 0) {
    const itemsProcessedSinceStart = context.itemIndex + 1 - context.startIndex;
    if (itemsProcessedSinceStart >= config.checkpointInterval) {
      return { shouldCheckpoint: true, reason: 'interval' };
    }
  }

  return { shouldCheckpoint: false, reason: 'none' };
}

/**
 * Check if budget is near exhaustion (for early warning).
 */
export function isBudgetNearExhaustion(
  batchName: GenerationBatchName,
  subrequestCount: number,
): boolean {
  const config = BATCH_CHECKPOINT_CONFIGS[batchName];
  const budgetRemaining = config.maxBudget - subrequestCount;
  return budgetRemaining <= config.subrequestReserve;
}

/**
 * Get the effective subrequest budget for a batch.
 */
export function getEffectiveBudget(batchName: GenerationBatchName): number {
  const config = BATCH_CHECKPOINT_CONFIGS[batchName];
  return config.maxBudget - config.subrequestReserve;
}
