#!/usr/bin/env node
import { Command } from 'commander';
import { runGenerationWorkflowLogic, type Bindings, type GenerationWorkflowPayload } from '@scrimble/core';
import { LocalWorkflowRunner } from './runner.js';
import { LocalBucket } from './local-bucket.js';
import { LocalDB } from './local-db.js';
import fs from 'fs';
import path from 'path';

const program = new Command();

program
  .name('scrimble')
  .description('Scrimble Core Engine CLI')
  .version('1.0.0');

function getBindings(projectDir: string, projectId: string, runId: string): Bindings {
  const scrimbleDir = path.join(projectDir, '.scrimble');
  const bucket = new LocalBucket(scrimbleDir);
  return {
    ENVIRONMENT: 'local',
    DB: new LocalDB(projectId, runId),
    CHECKPOINT_BUCKET: bucket as any,
    SCRIMBLE_BUCKET: bucket as any,
  } as unknown as Bindings;
}

async function runWorkflow(projectDir: string, pendingEventPayload?: any) {
  const projectId = 'local-project';
  const runId = 'local-run';
  
  const env = getBindings(projectDir, projectId, runId);
  const runner = new LocalWorkflowRunner(projectDir);
  
  if (pendingEventPayload) {
    runner.injectEvent(pendingEventPayload);
  }

  const payload: GenerationWorkflowPayload = {
    protocolVersion: 1,
    projectId,
    userId: 'local-user',
    runId,
    description: 'Local generation',
    intakeAnswers: {},
    fastProvider: {
      providerId: 'local-fast',
      providerName: 'local',
      providerType: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: process.env.OPENAI_BASE_URL || null,
      apiKey: process.env.OPENAI_API_KEY || 'test',
    },
    deepProvider: {
      providerId: 'local-deep',
      providerName: 'local',
      providerType: 'openai',
      model: 'gpt-4o',
      baseUrl: process.env.OPENAI_BASE_URL || null,
      apiKey: process.env.OPENAI_API_KEY || 'test',
    },
    stackTechnologies: [],
  };

  const saveToR2 = async (env: Bindings, pid: string, rid: string, key: string, data: any) => {
    const r2Key = `workflows/${pid}/${rid}/${key}.json`;
    await env.SCRIMBLE_BUCKET!.put(r2Key, JSON.stringify(data));
    return r2Key;
  };
  
  const loadFromR2 = async <T>(env: Bindings, r2Key: string) => {
    const obj = await env.SCRIMBLE_BUCKET!.get(r2Key);
    if (!obj) throw new Error(`Not found: ${r2Key}`);
    return obj.json<T>();
  };

  try {
    console.log('Engine running in local state-machine mode...');
    await runGenerationWorkflowLogic(env, payload, runner, saveToR2, loadFromR2);
    console.log('✅ Workflow complete!');
  } catch (error: any) {
    if (error.message === 'WORKFLOW_SUSPENDED') {
      const suspended = runner.getSuspendedEvent();
      console.log(`\n⏸️  Workflow suspended. Waiting for event: ${suspended.config.type}`);
      console.log(`Run 'scrimble approve <projectDir>' to provide the event and resume.\n`);
    } else {
      console.error('❌ Workflow failed:', error);
    }
  }
}

program
  .command('plan')
  .description('Generate a project plan completely offline (using local environment)')
  .argument('<projectDir>', 'Project directory')
  .action(async (projectDir) => {
    const fullDir = path.resolve(projectDir);
    console.log(`Initializing Scrimble engine for ${fullDir}...`);
    await runWorkflow(fullDir);
  });

program
  .command('resume')
  .description('Resume a suspended or interrupted workflow')
  .argument('<projectDir>', 'Project directory')
  .action(async (projectDir) => {
    const fullDir = path.resolve(projectDir);
    console.log(`Resuming Scrimble engine for ${fullDir}...`);
    await runWorkflow(fullDir);
  });

program
  .command('approve')
  .description('Approve a suspended workflow (HITL)')
  .argument('<projectDir>', 'Project directory')
  .option('-f, --feedback <feedback>', 'Optional feedback for architecture', '')
  .option('-i, --ide <ide>', 'Preferred IDE', 'vscode')
  .action(async (projectDir, options) => {
    const fullDir = path.resolve(projectDir);
    const eventPayload = {
      approved: true,
      feedback: options.feedback,
      preferredIde: options.ide
    };
    console.log(`Providing approval to Scrimble engine for ${fullDir}...`);
    await runWorkflow(fullDir, eventPayload);
  });

program
  .command('list')
  .description('List in-progress or suspended local workflows')
  .argument('[baseDir]', 'Base directory to search for workflows', '.')
  .action((baseDir) => {
    const dir = path.resolve(baseDir);
    if (fs.existsSync(path.join(dir, '.scrimble', 'workflow-state.json'))) {
      const runner = new LocalWorkflowRunner(dir);
      const suspended = runner.getSuspendedEvent();
      if (suspended) {
        console.log(`- ${dir} (Suspended waiting for: ${suspended.config.type})`);
      } else {
        console.log(`- ${dir} (In-progress or interrupted)`);
      }
    } else {
      console.log('No local workflows found in the specified directory.');
    }
  });

program.parse();
