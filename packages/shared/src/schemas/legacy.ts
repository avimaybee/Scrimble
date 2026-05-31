import { z } from 'zod';

// Legacy project/chunk/generation-era schemas.
// These are intentionally excluded from the main package root surface.

export const projectStatusSchema = z.enum(['active', 'paused', 'completed', 'abandoned']);

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  repoUrl: z.string().url().optional(),
  goal: z.string().min(1).max(2000),
});

export const chunkStatusSchema = z.enum(['pending', 'active', 'completed', 'skipped']);

export const chunkDefinitionSchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive(),
  title: z.string().min(1).max(200),
  prompt: z.string().min(1),
  doneCondition: z.string().min(1),
  doNotTouch: z.string().optional(),
  verificationHints: z.array(z.string()).optional(),
});

export const planDataSchema = z.object({
  architecture: z.string().min(1),
  researchSummary: z.string().optional(),
  chunks: z.array(chunkDefinitionSchema),
});

export const generationRunTypeSchema = z.enum(['initial', 'replan', 'update']);
export const generationRunStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);

export const stackInfoSchema = z.object({
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  packageManager: z.string().optional(),
  buildTool: z.string().optional(),
});

export const directoryNodeSchema: z.ZodType<{
  name: string;
  type: 'file' | 'directory';
  children?: Array<{ name: string; type: 'file' | 'directory'; children?: unknown[] }>;
}> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.enum(['file', 'directory']),
    children: z.array(z.lazy(() => directoryNodeSchema)).optional(),
  })
) as z.ZodType<{
  name: string;
  type: 'file' | 'directory';
  children?: Array<{ name: string; type: 'file' | 'directory'; children?: unknown[] }>;
}>;

export const repoContextSchema = z.object({
  name: z.string(),
  path: z.string(),
  stack: stackInfoSchema,
  structure: z.array(directoryNodeSchema),
  existingFiles: z.array(z.string()).optional(),
});

export const generationInputSchema = z.object({
  goal: z.string().min(1),
  repoContext: repoContextSchema.optional(),
  existingPlan: planDataSchema.optional(),
  updateRequest: z.string().optional(),
});

export const initProjectRequestSchema = z.object({
  name: z.string().min(1).max(100),
  goal: z.string().min(1).max(2000),
  repoContext: repoContextSchema.optional(),
});

export const completeChunkRequestSchema = z.object({
  chunkId: z.string(),
  verificationResult: z.object({
    status: z.enum(['pass', 'warn', 'fail', 'manual_review']),
    confidence: z.number().min(0).max(1),
    checks: z.array(z.object({
      name: z.string(),
      status: z.enum(['pass', 'warn', 'fail', 'manual_review']),
      message: z.string().optional(),
      evidence: z.string().optional(),
    })),
    timestamp: z.string().datetime(),
  }).optional(),
  override: z.boolean().optional(),
  overrideReason: z.string().optional(),
});

export const skipChunkRequestSchema = z.object({
  chunkId: z.string(),
  reason: z.string().min(1).max(500),
});

export const updatePlanRequestSchema = z.object({
  updateDescription: z.string().min(1).max(2000),
});

export const firebaseApproveRequestSchema = z.object({
  userCode: z.string().min(1),
  idToken: z.string().min(1),
});

export type ProjectStatusFromSchema = z.infer<typeof projectStatusSchema>;
export type ChunkStatusFromSchema = z.infer<typeof chunkStatusSchema>;
export type ChunkDefinitionFromSchema = z.infer<typeof chunkDefinitionSchema>;
export type PlanDataFromSchema = z.infer<typeof planDataSchema>;
export type StackInfoFromSchema = z.infer<typeof stackInfoSchema>;
export type DirectoryNodeFromSchema = z.infer<typeof directoryNodeSchema>;
export type RepoContextFromSchema = z.infer<typeof repoContextSchema>;
export type GenerationInputFromSchema = z.infer<typeof generationInputSchema>;
