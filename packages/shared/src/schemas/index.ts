import { z } from 'zod';

// AI provider schemas
export const aiProviderSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'github-copilot',
  'azure',
  'groq',
  'together',
]);

export const aiOptionsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
}).strict();

export const aiConfigSchema = z.object({
  provider: aiProviderSchema,
  model: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  options: aiOptionsSchema.optional(),
}).strict();

export const aiModelStrategySchema = z.enum(['auto', 'explicit']);
export const aiProfileAuthStrategySchema = z.enum([
  'api_key',
  'copilot_login',
  'env_token',
  'gh_cli',
  'personal_access_token',
]);

export const aiProfileAuthSchema = z.discriminatedUnion('strategy', [
  z.object({
    strategy: z.literal('api_key'),
    apiKey: z.string().optional(),
  }).strict(),
  z.object({
    strategy: z.literal('copilot_login'),
  }).strict(),
  z.object({
    strategy: z.literal('env_token'),
  }).strict(),
  z.object({
    strategy: z.literal('gh_cli'),
  }).strict(),
  z.object({
    strategy: z.literal('personal_access_token'),
    token: z.string().optional(),
  }).strict(),
]);

export const aiProviderProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: aiProviderSchema,
  modelStrategy: aiModelStrategySchema,
  model: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  auth: aiProfileAuthSchema,
  options: aiOptionsSchema.optional(),
}).strict().superRefine((profile, ctx) => {
  if (profile.modelStrategy === 'explicit' && !profile.model?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Explicit model strategy requires a model.',
      path: ['model'],
    });
  }

  if (profile.provider === 'github-copilot') {
    if (!['copilot_login', 'env_token', 'gh_cli', 'personal_access_token'].includes(profile.auth.strategy)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'GitHub Copilot profiles must use a Copilot auth strategy.',
        path: ['auth', 'strategy'],
      });
    }
  } else if (profile.auth.strategy !== 'api_key') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${profile.provider} profiles must use api_key auth strategy.`,
      path: ['auth', 'strategy'],
    });
  }

  if (profile.provider === 'azure' && !profile.baseUrl?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Azure profiles require baseUrl.',
      path: ['baseUrl'],
    });
  }
});

export const plannerWorkerSchema = z.enum(['gemini', 'copilot', 'auto']);
export const interactionModeSchema = z.enum(['guide', 'balanced', 'operator']);

export const workerPreferencesSchema = z.object({
  defaultWorker: plannerWorkerSchema.optional(),
  allowParallel: z.boolean().optional(),
  maxParallelWorkers: z.number().int().positive().optional(),
}).strict();

export const executionDefaultsSchema = z.object({
  worker: plannerWorkerSchema.optional(),
  timeoutSeconds: z.number().int().positive().optional(),
  maxParallelTasks: z.number().int().positive().optional(),
  maxRetriesPerTask: z.number().int().nonnegative().optional(),
}).strict();

export const verificationDefaultsSchema = z.object({
  enabled: z.boolean().optional(),
  commands: z.array(z.string()).optional(),
}).strict();

export const legacyScrimbleConfigSchema = z.object({
  schemaVersion: z.number().int().positive().default(1),
  ai: aiConfigSchema,
  interactionMode: interactionModeSchema.default('guide'),
  plannerWorker: plannerWorkerSchema.optional(),
  workerPreferences: workerPreferencesSchema.optional(),
  executionDefaults: executionDefaultsSchema.optional(),
  verificationDefaults: verificationDefaultsSchema.optional(),
}).strict();

// Local config schema
export const scrimbleConfigSchema = z.object({
  schemaVersion: z.number().int().positive().default(2),
  activeProfileId: z.string().min(1).optional(),
  profiles: z.array(aiProviderProfileSchema).default([]),
  interactionMode: interactionModeSchema.default('guide'),
  plannerWorker: plannerWorkerSchema.optional(),
  workerPreferences: workerPreferencesSchema.optional(),
  executionDefaults: executionDefaultsSchema.optional(),
  verificationDefaults: verificationDefaultsSchema.optional(),
}).strict();

// Verification schemas
export const verificationStatusSchema = z.enum(['pass', 'warn', 'fail', 'manual_review']);

export const verificationCheckSchema = z.object({
  name: z.string(),
  status: verificationStatusSchema,
  message: z.string().optional(),
  evidence: z.string().optional(),
});

export const verificationResultSchema = z.object({
  status: verificationStatusSchema,
  confidence: z.number().min(0).max(1),
  checks: z.array(verificationCheckSchema),
  timestamp: z.string().datetime(),
});

// Type exports from schemas (schema-derived only)
export type AIProviderFromSchema = z.infer<typeof aiProviderSchema>;
export type AIConfigFromSchema = z.infer<typeof aiConfigSchema>;
export type AIModelStrategyFromSchema = z.infer<typeof aiModelStrategySchema>;
export type AIProfileAuthStrategyFromSchema = z.infer<typeof aiProfileAuthStrategySchema>;
export type AIProfileAuthFromSchema = z.infer<typeof aiProfileAuthSchema>;
export type AIProviderProfileFromSchema = z.infer<typeof aiProviderProfileSchema>;
export type PlannerWorkerFromSchema = z.infer<typeof plannerWorkerSchema>;
export type InteractionModeFromSchema = z.infer<typeof interactionModeSchema>;
export type WorkerPreferencesFromSchema = z.infer<typeof workerPreferencesSchema>;
export type ExecutionDefaultsFromSchema = z.infer<typeof executionDefaultsSchema>;
export type VerificationDefaultsFromSchema = z.infer<typeof verificationDefaultsSchema>;
export type ScrimbleConfigFromSchema = z.infer<typeof scrimbleConfigSchema>;
export type LegacyScrimbleConfigFromSchema = z.infer<typeof legacyScrimbleConfigSchema>;
export type VerificationStatusFromSchema = z.infer<typeof verificationStatusSchema>;
export type VerificationCheckFromSchema = z.infer<typeof verificationCheckSchema>;
export type VerificationResultFromSchema = z.infer<typeof verificationResultSchema>;
