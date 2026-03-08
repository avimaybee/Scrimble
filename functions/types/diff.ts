import { z } from 'zod';

export const diffSchema = z.object({
  summary: z.string(),
  changes: z.array(z.discriminatedUnion('action', [
    z.object({ 
      action: z.literal('update_step'), 
      step_id: z.string(), 
      updates: z.object({
        title: z.string().optional(),
        objective: z.string().optional(),
        why_it_matters: z.string().optional(),
        suggested_tools: z.array(z.any()).optional(),
        checklist: z.array(z.any()).optional(),
        done_when: z.string().optional()
      })
    }),
    z.object({ 
      action: z.literal('add_step'), 
      stage_id: z.string(), 
      step: z.object({
        title: z.string(),
        type: z.string().default('task'),
        risk_level: z.string().default('low'),
        objective: z.string().optional(),
        why_it_matters: z.string().optional(),
        checklist: z.array(z.any()).optional(),
        done_when: z.string().optional()
      })
    }),
    z.object({ 
      action: z.literal('remove_step'), 
      step_id: z.string() 
    })
  ]))
});

export type PlanDiff = z.infer<typeof diffSchema>;
