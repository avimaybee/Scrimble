/**
 * Research Budget Module (Phase 19 - T4, T5)
 * 
 * Provides token budget tracking for research operations.
 * Enables budget-aware fetch gating in Batch 2 and cross-batch budget pooling.
 */

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type TokenBudget = {
  target: number;
  hardLimit: number;
  consumed: number;
  remaining: number;
  exhausted: boolean;
};

export type BatchBudgetConfig = {
  batchName: string;
  targetTokens: number;
  hardLimitTokens: number;
};

export type BatchBudgetAllocation = {
  batchName: string;
  targetTokens: number;
  hardLimitTokens: number;
  consumedTokens: number;
  remainingTokens: number;
  carryoverTokens: number;
  exhausted: boolean;
};

export type AggregateBudget = {
  batches: Record<string, BatchBudgetAllocation>;
  totalTarget: number;
  totalHardLimit: number;
  totalConsumed: number;
  totalRemaining: number;
};

export type FetchBudgetDecision = {
  canFetch: boolean;
  reason: 'within_budget' | 'near_limit' | 'at_limit' | 'exhausted';
  remainingTokens: number;
  estimatedFetchTokens: number;
};

export type SkippedSource = {
  technology: string;
  sourceType: string;
  url: string;
  reason: 'budget_exhausted' | 'limit_reached' | 'carryover_insufficient';
  estimatedTokens: number;
};

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

export const DEFAULT_BATCH_BUDGETS: Record<string, BatchBudgetConfig> = {
  batch_2_fetch_and_read: {
    batchName: 'batch_2_fetch_and_read',
    targetTokens: 8000,
    hardLimitTokens: 10000,
  },
  batch_3_architecture: {
    batchName: 'batch_3_architecture',
    targetTokens: 7000,
    hardLimitTokens: 9000,
  },
  batch_4_plan: {
    batchName: 'batch_4_plan',
    targetTokens: 7000,
    hardLimitTokens: 9000,
  },
  batch_5_enrich_steps: {
    batchName: 'batch_5_enrich_steps',
    targetTokens: 8000,
    hardLimitTokens: 10000,
  },
  batch_6_files: {
    batchName: 'batch_6_files',
    targetTokens: 6000,
    hardLimitTokens: 8000,
  },
};

export const CHARS_PER_TOKEN = 4;
export const FETCH_BUFFER_TOKENS = 500;

// ─────────────────────────────────────────────────────────────────
// Token Estimation
// ─────────────────────────────────────────────────────────────────

/**
 * Estimate token count from text (approximate: ~4 chars per token).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate token count from character count.
 */
export function charsToTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Convert tokens to approximate character count.
 */
export function tokensToChars(tokens: number): number {
  return tokens * CHARS_PER_TOKEN;
}

// ─────────────────────────────────────────────────────────────────
// Budget Creation
// ─────────────────────────────────────────────────────────────────

/**
 * Create a new token budget.
 */
export function createTokenBudget(config: {
  target: number;
  hardLimit: number;
  initialConsumed?: number;
}): TokenBudget {
  const consumed = config.initialConsumed ?? 0;
  const remaining = Math.max(0, config.hardLimit - consumed);

  return {
    target: config.target,
    hardLimit: config.hardLimit,
    consumed,
    remaining,
    exhausted: remaining <= 0,
  };
}

/**
 * Create a batch budget allocation.
 */
export function createBatchBudget(
  config: BatchBudgetConfig,
  initialConsumed: number = 0,
  carryover: number = 0,
): BatchBudgetAllocation {
  const effectiveLimit = config.hardLimitTokens + carryover;
  const remaining = Math.max(0, effectiveLimit - initialConsumed);

  return {
    batchName: config.batchName,
    targetTokens: config.targetTokens,
    hardLimitTokens: config.hardLimitTokens,
    consumedTokens: initialConsumed,
    remainingTokens: remaining,
    carryoverTokens: carryover,
    exhausted: remaining <= FETCH_BUFFER_TOKENS,
  };
}

/**
 * Create an aggregate budget tracking all batches.
 */
export function createAggregateBudget(
  batchConfigs: BatchBudgetConfig[] = Object.values(DEFAULT_BATCH_BUDGETS),
): AggregateBudget {
  const batches: Record<string, BatchBudgetAllocation> = {};
  let totalTarget = 0;
  let totalHardLimit = 0;

  for (const config of batchConfigs) {
    batches[config.batchName] = createBatchBudget(config);
    totalTarget += config.targetTokens;
    totalHardLimit += config.hardLimitTokens;
  }

  return {
    batches,
    totalTarget,
    totalHardLimit,
    totalConsumed: 0,
    totalRemaining: totalHardLimit,
  };
}

// ─────────────────────────────────────────────────────────────────
// Budget Operations
// ─────────────────────────────────────────────────────────────────

/**
 * Check if a fetch can be afforded within the budget.
 */
export function canAffordFetch(
  budget: TokenBudget,
  estimatedChars: number,
): FetchBudgetDecision {
  const estimatedTokens = charsToTokens(estimatedChars);
  const afterFetch = budget.consumed + estimatedTokens;

  if (budget.exhausted || budget.remaining <= 0) {
    return {
      canFetch: false,
      reason: 'exhausted',
      remainingTokens: budget.remaining,
      estimatedFetchTokens: estimatedTokens,
    };
  }

  if (afterFetch > budget.hardLimit) {
    return {
      canFetch: false,
      reason: 'at_limit',
      remainingTokens: budget.remaining,
      estimatedFetchTokens: estimatedTokens,
    };
  }

  if (afterFetch > budget.target) {
    return {
      canFetch: true,
      reason: 'near_limit',
      remainingTokens: budget.remaining,
      estimatedFetchTokens: estimatedTokens,
    };
  }

  return {
    canFetch: true,
    reason: 'within_budget',
    remainingTokens: budget.remaining,
    estimatedFetchTokens: estimatedTokens,
  };
}

/**
 * Record token consumption and update budget.
 */
export function recordConsumption(
  budget: TokenBudget,
  chars: number,
): TokenBudget {
  const tokens = charsToTokens(chars);
  const newConsumed = budget.consumed + tokens;
  const newRemaining = Math.max(0, budget.hardLimit - newConsumed);

  return {
    ...budget,
    consumed: newConsumed,
    remaining: newRemaining,
    exhausted: newRemaining <= FETCH_BUFFER_TOKENS,
  };
}

/**
 * Record consumption for a specific batch.
 */
export function recordBatchConsumption(
  allocation: BatchBudgetAllocation,
  chars: number,
): BatchBudgetAllocation {
  const tokens = charsToTokens(chars);
  const newConsumed = allocation.consumedTokens + tokens;
  const effectiveLimit = allocation.hardLimitTokens + allocation.carryoverTokens;
  const newRemaining = Math.max(0, effectiveLimit - newConsumed);

  return {
    ...allocation,
    consumedTokens: newConsumed,
    remainingTokens: newRemaining,
    exhausted: newRemaining <= FETCH_BUFFER_TOKENS,
  };
}

/**
 * Update aggregate budget after batch consumption.
 */
export function updateAggregateBudget(
  aggregate: AggregateBudget,
  batchName: string,
  allocation: BatchBudgetAllocation,
): AggregateBudget {
  const batches = {
    ...aggregate.batches,
    [batchName]: allocation,
  };

  const totalConsumed = Object.values(batches).reduce(
    (sum, batch) => sum + batch.consumedTokens,
    0,
  );

  return {
    ...aggregate,
    batches,
    totalConsumed,
    totalRemaining: aggregate.totalHardLimit - totalConsumed,
  };
}

// ─────────────────────────────────────────────────────────────────
// Cross-Batch Budget Pooling (T5)
// ─────────────────────────────────────────────────────────────────

/**
 * Calculate unused tokens from a completed batch.
 */
export function calculateUnusedTokens(allocation: BatchBudgetAllocation): number {
  const effectiveLimit = allocation.hardLimitTokens + allocation.carryoverTokens;
  return Math.max(0, effectiveLimit - allocation.consumedTokens);
}

/**
 * Reallocate unused tokens from one batch to another.
 */
export function reallocateUnused(
  aggregate: AggregateBudget,
  sourceBatch: string,
  targetBatch: string,
  maxCarryover?: number,
): AggregateBudget {
  const source = aggregate.batches[sourceBatch];
  const target = aggregate.batches[targetBatch];

  if (!source || !target) {
    return aggregate;
  }

  const unused = calculateUnusedTokens(source);
  const carryover = maxCarryover !== undefined
    ? Math.min(unused, maxCarryover)
    : unused;

  if (carryover <= 0) {
    return aggregate;
  }

  const updatedTarget: BatchBudgetAllocation = {
    ...target,
    carryoverTokens: target.carryoverTokens + carryover,
    remainingTokens: target.remainingTokens + carryover,
    exhausted: false,
  };

  return {
    ...aggregate,
    batches: {
      ...aggregate.batches,
      [targetBatch]: updatedTarget,
    },
  };
}

/**
 * Apply standard carryover chain: Batch 2 → 3 → 4 → 5 → 6.
 */
export function applyStandardCarryoverChain(aggregate: AggregateBudget): AggregateBudget {
  const chain = [
    { source: 'batch_2_fetch_and_read', target: 'batch_3_architecture' },
    { source: 'batch_3_architecture', target: 'batch_4_plan' },
    { source: 'batch_4_plan', target: 'batch_5_enrich_steps' },
    { source: 'batch_5_enrich_steps', target: 'batch_6_files' },
  ];

  let result = aggregate;
  for (const { source, target } of chain) {
    if (result.batches[source] && result.batches[target]) {
      result = reallocateUnused(result, source, target);
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Budget Gating for Fetch Loop
// ─────────────────────────────────────────────────────────────────

export type FetchGateContext = {
  budget: TokenBudget;
  skippedSources: SkippedSource[];
};

/**
 * Create a fetch gate context for tracking budget during fetch loop.
 */
export function createFetchGateContext(budget: TokenBudget): FetchGateContext {
  return {
    budget,
    skippedSources: [],
  };
}

/**
 * Check if a fetch should proceed and update context accordingly.
 */
export function shouldFetch(
  context: FetchGateContext,
  source: { technology: string; sourceType: string; url: string },
  estimatedChars: number,
): { proceed: boolean; context: FetchGateContext } {
  const decision = canAffordFetch(context.budget, estimatedChars);

  if (!decision.canFetch) {
    const skipped: SkippedSource = {
      technology: source.technology,
      sourceType: source.sourceType,
      url: source.url,
      reason: decision.reason === 'exhausted' ? 'budget_exhausted' : 'limit_reached',
      estimatedTokens: decision.estimatedFetchTokens,
    };

    return {
      proceed: false,
      context: {
        ...context,
        skippedSources: [...context.skippedSources, skipped],
      },
    };
  }

  return { proceed: true, context };
}

/**
 * Record a completed fetch and update context.
 */
export function recordFetch(
  context: FetchGateContext,
  actualChars: number,
): FetchGateContext {
  return {
    ...context,
    budget: recordConsumption(context.budget, actualChars),
  };
}

// ─────────────────────────────────────────────────────────────────
// Budget Reporting
// ─────────────────────────────────────────────────────────────────

export type BudgetReport = {
  batchName: string;
  targetTokens: number;
  hardLimitTokens: number;
  consumedTokens: number;
  remainingTokens: number;
  carryoverTokens: number;
  utilizationPercent: number;
  exhausted: boolean;
  skippedSourceCount: number;
};

/**
 * Generate a budget report for a batch.
 */
export function generateBatchReport(
  allocation: BatchBudgetAllocation,
  skippedSources: SkippedSource[] = [],
): BudgetReport {
  const effectiveLimit = allocation.hardLimitTokens + allocation.carryoverTokens;
  const utilizationPercent = effectiveLimit > 0
    ? Math.round((allocation.consumedTokens / effectiveLimit) * 100)
    : 0;

  return {
    batchName: allocation.batchName,
    targetTokens: allocation.targetTokens,
    hardLimitTokens: allocation.hardLimitTokens,
    consumedTokens: allocation.consumedTokens,
    remainingTokens: allocation.remainingTokens,
    carryoverTokens: allocation.carryoverTokens,
    utilizationPercent,
    exhausted: allocation.exhausted,
    skippedSourceCount: skippedSources.length,
  };
}

/**
 * Generate aggregate budget summary.
 */
export function generateAggregateSummary(aggregate: AggregateBudget): {
  totalTarget: number;
  totalHardLimit: number;
  totalConsumed: number;
  totalRemaining: number;
  utilizationPercent: number;
  batchReports: BudgetReport[];
} {
  const batchReports = Object.values(aggregate.batches).map((allocation) =>
    generateBatchReport(allocation),
  );

  const utilizationPercent = aggregate.totalHardLimit > 0
    ? Math.round((aggregate.totalConsumed / aggregate.totalHardLimit) * 100)
    : 0;

  return {
    totalTarget: aggregate.totalTarget,
    totalHardLimit: aggregate.totalHardLimit,
    totalConsumed: aggregate.totalConsumed,
    totalRemaining: aggregate.totalRemaining,
    utilizationPercent,
    batchReports,
  };
}
