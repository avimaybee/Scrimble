import type { PlanDiff } from '../types/diff';
import type { Bindings } from '@scrimble/core';

type ApplyPlanDiffResult = {
  updatedStepIds: string[];
  addedStepIds: string[];
  removedStepIds: string[];
  affectedStepIds: string[];
  appliedChangeCount: number;
};

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function inferGateFlag(source: {
  title?: string | null;
  objective?: string | null;
  why_it_matters?: string | null;
  category?: string | null;
  done_when?: string | null;
}): boolean {
  const haystack = [source.title, source.objective, source.why_it_matters, source.category, source.done_when]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return [
    'security',
    'auth',
    'authentication',
    'deploy',
    'deployment',
    'production',
    'billing',
    'payment',
    'secret',
    'permission',
    'database change',
    'database migration',
    'environment variable',
  ].some((keyword) => haystack.includes(keyword));
}

export async function applyPlanDiffToProject(
  env: Bindings,
  projectId: string,
  diff: PlanDiff,
): Promise<ApplyPlanDiffResult> {
  const statements: Array<any> = [];
  const updatedStepIds: string[] = [];
  const addedStepIds: string[] = [];
  const removedStepIds: string[] = [];

  for (const change of diff.changes) {
    if (change.action === 'update_step') {
      const existingStep = await env.DB.prepare(`
        SELECT s.*
        FROM steps s
        INNER JOIN workflows w ON w.id = s.workflow_id
        WHERE s.id = ? AND w.project_id = ?
      `)
        .bind(change.step_id, projectId)
        .first();

      if (!existingStep) {
        continue;
      }

      const nextTitle = change.updates.title || (existingStep.title as string);
      const nextObjective = change.updates.objective || (existingStep.objective as string);
      const nextWhyItMatters = change.updates.why_it_matters || (existingStep.why_it_matters as string);
      const nextDoneWhen = change.updates.done_when || (existingStep.done_when as string);
      const nextSuggestedTools = change.updates.suggested_tools
        ? JSON.stringify(change.updates.suggested_tools)
        : (existingStep.suggested_tools as string);
      const nextIsGate = inferGateFlag({
        title: nextTitle,
        objective: nextObjective,
        why_it_matters: nextWhyItMatters,
        category: existingStep.category as string,
        done_when: nextDoneWhen,
      });

      statements.push(
        env.DB.prepare(`
          UPDATE steps
          SET title = ?, objective = ?, why_it_matters = ?, suggested_tools = ?, done_when = ?, is_gate = ?, is_ai_enriched = 0, updated_at = datetime("now")
          WHERE id = ? AND workflow_id IN (SELECT id FROM workflows WHERE project_id = ?)
        `).bind(
          nextTitle,
          nextObjective,
          nextWhyItMatters,
          nextSuggestedTools,
          nextDoneWhen,
          nextIsGate ? 1 : 0,
          change.step_id,
          projectId,
        ),
      );

      if (change.updates.checklist) {
        statements.push(env.DB.prepare('DELETE FROM checklist_items WHERE step_id = ?').bind(change.step_id));
        change.updates.checklist.forEach((item, index) => {
          statements.push(
            env.DB.prepare(`
              INSERT INTO checklist_items (id, step_id, label, is_required, is_completed, order_index)
              VALUES (?, ?, ?, ?, 0, ?)
            `).bind(crypto.randomUUID(), change.step_id, item.label, item.is_required ? 1 : 0, index),
          );
        });
      }

      updatedStepIds.push(change.step_id);
      continue;
    }

    if (change.action === 'add_step') {
      const stageRecord = await env.DB.prepare(`
        SELECT st.*
        FROM stages st
        INNER JOIN workflows w ON w.id = st.workflow_id
        WHERE st.id = ? AND w.project_id = ?
      `)
        .bind(change.stage_id, projectId)
        .first();

      if (!stageRecord) {
        continue;
      }

      const placement = await env.DB.prepare(`
        SELECT
          COALESCE(MAX(s.order_index), -1) AS max_order_index,
          COALESCE(MAX(s.position_x), 0) AS max_position_x,
          COALESCE(MAX(s.position_y), ?) AS max_position_y
        FROM steps s
        INNER JOIN workflows w ON w.id = s.workflow_id
        WHERE w.project_id = ? AND s.stage_id = ?
      `)
        .bind(asNumber(stageRecord.order_index, 0) * 400 + 100, projectId, change.stage_id)
        .first();

      const stepId = crypto.randomUUID();
      const nextOrderIndex = asNumber(placement?.max_order_index, -1) + 1;
      const nextPositionX = asNumber(placement?.max_position_x, 0) + 250;
      const nextPositionY = asNumber(
        placement?.max_position_y,
        asNumber(stageRecord.order_index, 0) * 400 + 100,
      );
      const nextIsGate = inferGateFlag({
        title: change.step.title,
        objective: change.step.objective,
        why_it_matters: change.step.why_it_matters,
        category: stageRecord.type as string,
        done_when: change.step.done_when,
      });

      statements.push(
        env.DB.prepare(`
          INSERT INTO steps (
            id, workflow_id, stage_id, title, type, category, position_x, position_y, status,
            is_gate, risk_level, order_index, objective, why_it_matters, suggested_tools, done_when, is_ai_enriched
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).bind(
          stepId,
          stageRecord.workflow_id,
          change.stage_id,
          change.step.title,
          change.step.type,
          stageRecord.type,
          nextPositionX,
          nextPositionY,
          'locked',
          nextIsGate ? 1 : 0,
          change.step.risk_level,
          nextOrderIndex,
          change.step.objective || '',
          change.step.why_it_matters || '',
          change.step.suggested_tools ? JSON.stringify(change.step.suggested_tools) : null,
          change.step.done_when || '',
        ),
      );

      if (change.step.checklist?.length) {
        change.step.checklist.forEach((item, index) => {
          statements.push(
            env.DB.prepare(`
              INSERT INTO checklist_items (id, step_id, label, is_required, is_completed, order_index)
              VALUES (?, ?, ?, ?, 0, ?)
            `).bind(crypto.randomUUID(), stepId, item.label, item.is_required ? 1 : 0, index),
          );
        });
      }

      addedStepIds.push(stepId);
      continue;
    }

    if (change.action === 'remove_step') {
      statements.push(
        env.DB.prepare(`
          DELETE FROM steps
          WHERE id = ?
          AND workflow_id IN (SELECT id FROM workflows WHERE project_id = ?)
          AND status NOT IN ("complete", "needs_review")
        `).bind(change.step_id, projectId),
      );
      removedStepIds.push(change.step_id);
    }
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  const affectedStepIds = Array.from(new Set([...updatedStepIds, ...addedStepIds]));

  return {
    updatedStepIds,
    addedStepIds,
    removedStepIds,
    affectedStepIds,
    appliedChangeCount: updatedStepIds.length + addedStepIds.length + removedStepIds.length,
  };
}
