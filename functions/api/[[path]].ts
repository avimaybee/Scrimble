import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { verifyFirebaseToken } from '../middleware/auth';
import { decrypt } from '../utils/crypto';
import { diffSchema } from '../types/diff';

type Bindings = {
  DB: any;
  FIREBASE_PROJECT_ID: string;
  ENCRYPTION_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>().basePath('/api');

app.post('/projects/:id/plan-diff', async (c) => {
  const projectId = c.req.param('id');
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.split(' ')[1];
  let uid: string;
  try {
    uid = await verifyFirebaseToken(token, c.env.FIREBASE_PROJECT_ID);
  } catch (err: any) {
    return c.json({ error: `Auth failed: ${err.message}` }, 401);
  }

  const body = await c.req.json();
  const result = diffSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Malformed diff', details: result.error.format() }, 400);
  }

  const diff = result.data;
  const statements: any[] = [];

  for (const change of diff.changes) {
    if (change.action === 'update_step') {
      const { step_id, updates } = change;
      statements.push(
        c.env.DB.prepare(
          'UPDATE steps SET title = COALESCE(?, title), objective = COALESCE(?, objective), why_it_matters = COALESCE(?, why_it_matters), suggested_tools = COALESCE(?, suggested_tools), done_when = COALESCE(?, done_when), is_ai_enriched = 0, updated_at = datetime("now") WHERE id = ? AND project_id = ?'
        ).bind(
          updates.title || null,
          updates.objective || null,
          updates.why_it_matters || null,
          updates.suggested_tools ? JSON.stringify(updates.suggested_tools) : null,
          updates.done_when || null,
          step_id,
          projectId
        )
      );
    } else if (change.action === 'add_step') {
      const { stage_id, step } = change;
      const stepId = crypto.randomUUID();
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO steps (id, project_id, stage_id, title, type, risk_level, objective, why_it_matters, done_when, is_ai_enriched) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)'
        ).bind(
          stepId,
          projectId,
          stage_id,
          step.title,
          step.type,
          step.risk_level,
          step.objective || '',
          step.why_it_matters || '',
          step.done_when || ''
        )
      );
    } else if (change.action === 'remove_step') {
      const { step_id } = change;
      statements.push(
        c.env.DB.prepare(
          'DELETE FROM steps WHERE id = ? AND project_id = ? AND status NOT IN ("complete", "needs_review")'
        ).bind(step_id, projectId)
      );
    }
  }

  try {
    if (statements.length > 0) {
      await c.env.DB.batch(statements);
    }
    return c.json({ success: true, summary: diff.summary });
  } catch (err: any) {
    return c.json({ error: `Failed to apply diff: ${err.message}` }, 500);
  }
});

app.post('/steps/:id/enrich', async (c) => {
  const stepId = c.req.param('id');
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.split(' ')[1];
  let uid: string;
  try {
    uid = await verifyFirebaseToken(token, c.env.FIREBASE_PROJECT_ID);
  } catch (err: any) {
    return c.json({ error: `Auth failed: ${err.message}` }, 401);
  }

  const { providerId, projectId } = await c.req.json();
  if (!providerId || !projectId) {
    return c.json({ error: 'providerId and projectId are required' }, 400);
  }

  // 1. Get Step details
  const stepRecord = await c.env.DB.prepare(
    'SELECT * FROM steps WHERE id = ? AND project_id = ?'
  )
    .bind(stepId, projectId)
    .first();

  if (!stepRecord) {
    return c.json({ error: 'Step not found' }, 404);
  }

  // 2. Get Project details (for context)
  const projectRecord = await c.env.DB.prepare(
    'SELECT * FROM projects WHERE id = ? AND user_id = ?'
  )
    .bind(projectId, uid)
    .first();

  if (!projectRecord) {
    return c.json({ error: 'Project not found or access denied' }, 403);
  }

  // 3. Update status to agent_working
  await c.env.DB.prepare('UPDATE steps SET status = "agent_working" WHERE id = ?')
    .bind(stepId)
    .run();

  // 4. Get Provider Key
  const providerRecord = await c.env.DB.prepare(
    'SELECT * FROM ai_providers WHERE id = ? AND user_id = ?'
  )
    .bind(providerId, uid)
    .first();

  if (!providerRecord) {
    return c.json({ error: 'Provider not found or access denied' }, 403);
  }

  let apiKey: string;
  try {
    apiKey = await decrypt(providerRecord.api_key_enc as string, c.env.ENCRYPTION_KEY);
  } catch (err) {
    return c.json({ error: 'Failed to decrypt API key' }, 500);
  }

  const providerType = providerRecord.provider as string;
  const model = providerRecord.model as string;
  const baseUrl = providerRecord.base_url as string;

  const systemPrompt = `You are Scrimble's step enrichment agent. You produce specific, actionable guidance for a single build step. Write for a solo builder — plain language, no jargon. Respond ONLY with valid JSON.`;
  const userPrompt = `Step: "${stepRecord.title}"\nProject: "${projectRecord.description}"\nStack: ${projectRecord.stack}`;

  const runId = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO agent_runs (id, project_id, step_id, run_type, status, provider, model) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(runId, projectId, stepId, 'enrich_step', 'running', providerType, model)
    .run();

  try {
    let aiResponse: Response;

    // Call AI (reuse logic from proxy but with specific prompts)
    if (providerType === 'anthropic') {
      aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          stream: true,
        }),
      });
    } else if (providerType === 'gemini') {
      const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;
      aiResponse = await fetch(googleUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
          ],
        }),
      });
    } else {
      const url = baseUrl || 'https://api.openai.com/v1/chat/completions';
      aiResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: true,
        }),
      });
    }

    if (!aiResponse.ok) {
      throw new Error(`AI Provider error: ${aiResponse.status}`);
    }

    const { readable, writable } = new TransformStream();
    const [stream1, stream2] = readable.tee();

    // Finalize in background
    c.executionCtx.waitUntil((async () => {
      const reader = stream2.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.choices?.[0]?.delta?.content) {
                fullContent += parsed.choices[0].delta.content;
              } else if (parsed.content?.[0]?.text) {
                fullContent += parsed.content[0].text;
              } else if (parsed.candidates?.[0]?.content?.parts?.[0]?.text) {
                fullContent += parsed.candidates[0].content.parts[0].text;
              }
            } catch (e) {}
          }
        }
      }

      try {
        const parsed = JSON.parse(fullContent);
        const nextStatus = stepRecord.is_gate ? 'needs_review' : 'complete';
        
        await c.env.DB.batch([
          c.env.DB.prepare('UPDATE steps SET ai_output = ?, prompts = ?, is_ai_enriched = 1, status = ?, updated_at = datetime("now") WHERE id = ?')
            .bind(parsed.ai_output || null, JSON.stringify(parsed.prompts || []), nextStatus, stepId),
          c.env.DB.prepare('UPDATE agent_runs SET status = "complete", output = ?, completed_at = datetime("now") WHERE id = ?')
            .bind(fullContent, runId)
        ]);
      } catch (err: any) {
        await c.env.DB.prepare('UPDATE agent_runs SET status = "failed", output = ? WHERE id = ?')
          .bind(`JSON Parse Error: ${err.message}\nRaw: ${fullContent}`, runId)
          .run();
      }
    })());

    aiResponse.body?.pipeTo(writable);

    return new Response(stream1, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (err: any) {
    await c.env.DB.prepare('UPDATE steps SET status = "active" WHERE id = ?').bind(stepId).run();
    return c.json({ error: err.message }, 500);
  }
});

app.post('/ai/proxy', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.split(' ')[1];
  let uid: string;
  try {
    uid = await verifyFirebaseToken(token, c.env.FIREBASE_PROJECT_ID);
  } catch (err: any) {
    return c.json({ error: `Auth failed: ${err.message}` }, 401);
  }

  const { providerId, system, prompt, projectId, stepId } = await c.req.json();
  if (!providerId || !prompt) {
    return c.json({ error: 'providerId and prompt are required' }, 400);
  }

  const providerRecord = await c.env.DB.prepare(
    'SELECT * FROM ai_providers WHERE id = ? AND user_id = ?'
  )
    .bind(providerId, uid)
    .first();

  if (!providerRecord) {
    return c.json({ error: 'Provider not found or access denied' }, 403);
  }

  let apiKey: string;
  try {
    apiKey = await decrypt(providerRecord.api_key_enc as string, c.env.ENCRYPTION_KEY);
  } catch (err) {
    return c.json({ error: 'Failed to decrypt API key' }, 500);
  }

  const providerType = providerRecord.provider as string;
  const model = providerRecord.model as string;
  const baseUrl = providerRecord.base_url as string;

  const runId = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO agent_runs (id, project_id, step_id, run_type, status, provider, model) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(runId, projectId || 'default', stepId || null, 'proxy_call', 'running', providerType, model)
    .run();

  try {
    let response: Response;

    if (providerType === 'anthropic') {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model,
          system: system,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
        }),
      });
    } else if (providerType === 'gemini') {
      const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;
      response = await fetch(googleUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: system ? `${system}\n\n${prompt}` : prompt }] }
          ],
        }),
      });
    } else {
      const url = baseUrl || 'https://api.openai.com/v1/chat/completions';
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          stream: true,
        }),
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI Provider returned ${response.status}: ${errorText}`);
    }

    const { readable, writable } = new TransformStream();
    response.body?.pipeTo(writable);

    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE agent_runs SET status = ?, completed_at = ? WHERE id = ?')
        .bind('complete', new Date().toISOString(), runId)
        .run()
    );

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (err: any) {
    await c.env.DB.prepare('UPDATE agent_runs SET status = ?, output = ? WHERE id = ?')
      .bind('failed', err.message, runId)
      .run();
    return c.json({ error: err.message }, 500);
  }
});

export const onRequest = handle(app);
