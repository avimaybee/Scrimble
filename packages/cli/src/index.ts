#!/usr/bin/env node
import { Command } from 'commander';
import { 
  executeBatch1, 
  executeBatch2, 
  executeBatch3, 
  executeBatch4, 
  executeBatch5, 
  executeBatch6, 
  upsertUserMCPServer,
  loadBuilderProfileContext,
  loadProjectBriefContext,
  buildPlanMarkdown,
  mergePlanWithEnrichments,
  type Bindings,
  type ProviderConfig,
  type ProjectRecord
} from '@scrimble/core';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { LocalD1Database, applyMigrations } from './db.js';
import { authenticateUser, getStoredToken } from './auth.js';
import { syncLocalToCloud } from './sync.js';
import { setSecret, getSecret, deleteSecret } from './secrets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('scrimble')
  .description('Scrimble Core Engine CLI')
  .version('1.0.0');

program
  .command('login')
  .description('Authenticate with the cloud provider')
  .action(async () => {
    await authenticateUser();
  });

program
  .command('sync')
  .description('Sync local offline changes to the cloud database')
  .argument('[projectDir]', 'Project directory', '.')
  .action(async (projectDir) => {
    const token = await getStoredToken();
    if (!token) {
      console.error('Please login first using: scrimble login');
      process.exit(1);
    }
    await syncLocalToCloud(token, projectDir);
  });

const keys = program.command('keys').description('Manage local keys stored in the OS keyring');

keys
  .command('set <key> <value>')
  .description('Store a secret key in the system keychain')
  .action(async (key, value) => {
    await setSecret(key, value);
    console.log(`Saved secret for ${key} securely to system keychain.`);
  });

keys
  .command('get <key>')
  .description('Get a secret key from the system keychain')
  .action(async (key) => {
    const secret = await getSecret(key);
    if (!secret) {
      console.error(`No secret found for ${key}`);
      process.exit(1);
    }
    console.log(secret);
  });

keys
  .command('delete <key>')
  .description('Delete a secret key from the system keychain')
  .action(async (key) => {
    await deleteSecret(key);
    console.log(`Deleted secret for ${key}`);
  });

program
  .command('plan')
  .description('Generate a project plan completely offline (using local environment)')
  .argument('<projectDir>', 'Project directory')
  .action(async (projectDir) => {
    console.log(`Initializing Scrimble engine for ${projectDir}...`);

    let encryptionKey = await getSecret('scrimble_local_encryption_key');
    if (!encryptionKey) {
      encryptionKey = crypto.randomBytes(32).toString('hex');
      await setSecret('scrimble_local_encryption_key', encryptionKey);
    }
    
    const aiApiKey = await getSecret('anthropic_api_key') || await getSecret('openai_api_key');
    if (!aiApiKey) {
      console.error('Error: Missing AI provider API key in local keyring.');
      console.error('Please set it using: scrimble keys set anthropic_api_key <your-key>');
      process.exit(1);
    }

    const providerType = await getSecret('anthropic_api_key') ? 'anthropic' : 'openai';
    const providerConfig: ProviderConfig = {
      providerId: `local-${providerType}`,
      providerName: providerType === 'anthropic' ? 'Anthropic' : 'OpenAI',
      providerType: providerType,
      model: providerType === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gpt-4o',
      baseUrl: null,
      apiKey: aiApiKey,
    };
    
    const dbPath = path.resolve(projectDir, '.scrimble', 'local.db');
    const scDir = path.dirname(dbPath);
    if (!fs.existsSync(scDir)) {
      fs.mkdirSync(scDir, { recursive: true });
    }
    const dbWrapper = new LocalD1Database(dbPath);
    
    let srcMigrations = path.resolve(process.cwd(), 'migrations');
    if (!fs.existsSync(srcMigrations)) {
      srcMigrations = path.resolve(__dirname, '../../../../migrations');
    }
    
    applyMigrations(dbWrapper.getDb(), srcMigrations);
    
    const env = {
      ENVIRONMENT: 'local',
      DB: dbWrapper,
      ENCRYPTION_KEY: encryptionKey,
      CHECKPOINT_BUCKET: {
        get: async () => null,
        put: async () => ({ key: 'dummy', size: 0, httpEtag: 'dummy', body: new ReadableStream(), async text() { return ''; }, async json() { return {}; } }),
        delete: async () => {},
        list: async () => ({ objects: [], truncated: false })
      }
    } as unknown as Bindings;
    
    const userId = 'offline_user';
    await env.DB.prepare(
      `INSERT OR IGNORE INTO profiles (id, name, email, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(userId, 'Offline User', 'offline@scrimble.test').run();

    const braveToken = await getSecret('brave_search_token');
    if (braveToken) {
      await upsertUserMCPServer(env, userId, {
        serverType: 'brave-search',
        config: { apiKey: braveToken }
      });
      console.log('Using Brave Search token from keyring.');
    }

    const githubToken = await getSecret('github_token');
    if (githubToken) {
      await upsertUserMCPServer(env, userId, {
        serverType: 'github',
        config: { token: githubToken }
      });
      console.log('Using GitHub token from keyring.');
    }

    const projectId = `proj_offline_${Date.now()}`;
    let rawDescription = 'Offline project generation';
    
    const packageJsonPath = path.resolve(projectDir, 'package.json');
    const readmePath = path.resolve(projectDir, 'README.md');
    
    let localContext = '';
    if (fs.existsSync(readmePath)) {
      localContext += 'README.md:\n' + fs.readFileSync(readmePath, 'utf8') + '\n\n';
    }
    if (fs.existsSync(packageJsonPath)) {
      localContext += 'package.json:\n' + fs.readFileSync(packageJsonPath, 'utf8') + '\n\n';
    }
    if (localContext) {
      rawDescription = 'Generate a complete project based on the following local files:\n' + localContext;
    }

    await env.DB.prepare(
      `INSERT INTO projects (id, user_id, name, status, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(projectId, userId, 'Offline Plan', 'intake', rawDescription).run();

    await env.DB.prepare(
      `INSERT INTO generation_runs (id, project_id, status, current_batch, created_at, updated_at)
       VALUES (?, ?, 'running', 'batch_1_research_stack', datetime('now'), datetime('now'))`
    ).bind(`run_${projectId}`, projectId).run();

    // To support project updates:
    const projectRecord: ProjectRecord = {
      id: projectId,
      user_id: userId,
      name: 'Offline Plan',
      description: rawDescription,
      intake_answers: null,
      project_type: 'web app',
      stack: null,
      current_generation_run_id: `run_${projectId}`
    };

    const runId = `run_${projectId}`;

    const builderProfile = await loadBuilderProfileContext(userId, env);
    const projectBrief = await loadProjectBriefContext(env, projectId, userId, { rawDescription });

    console.log('Engine running in local continuous execution mode...');

    try {
      console.log('\n[1/6] Executing Batch 1: Research Stack...');
      await executeBatch1(env, projectRecord, providerConfig, runId, builderProfile, projectBrief);

      console.log('\n[2/6] Executing Batch 2: Fetch and Read...');
      await executeBatch2(env, projectRecord, providerConfig, providerConfig, runId, builderProfile, projectBrief);

      console.log('\n[3/6] Executing Batch 3: Architect...');
      await executeBatch3(env, projectId, runId, providerConfig, projectRecord, builderProfile, projectBrief);

      console.log('\n[4/6] Executing Batch 4: Plan Build...');
      await executeBatch4(env, projectId, runId, providerConfig, builderProfile, projectBrief);

      console.log('\n[5/6] Executing Batch 5: Enrich Steps...');
      await executeBatch5(env, projectId, providerConfig, runId, builderProfile, projectBrief);

      console.log('\n[6/6] Executing Batch 6: Generate Files...');
      await executeBatch6(env, projectId, runId, providerConfig, builderProfile, projectBrief);
      
      console.log('\n✅ Batch 1-6 workflow complete!');

      // Get generated plan
      const planRow = await env.DB.prepare(`SELECT payload_inline FROM generation_checkpoints WHERE project_id = ? AND batch_name = 'batch_4_plan_build'`).bind(projectId).first();
      const enrichmentsRow = await env.DB.prepare(`SELECT payload_inline FROM generation_checkpoints WHERE project_id = ? AND batch_name = 'batch_5_enrich_steps'`).bind(projectId).first();
      
      if (planRow && enrichmentsRow && planRow.payload_inline && enrichmentsRow.payload_inline) {
        const planData = JSON.parse(planRow.payload_inline);
        const enrichmentsData = JSON.parse(enrichmentsRow.payload_inline);
        
        const enrichedPlan = mergePlanWithEnrichments(planData, enrichmentsData.enrichments || []);
        const md = buildPlanMarkdown(planData, enrichedPlan, undefined);
        
        fs.writeFileSync(path.resolve(scDir, 'plan.md'), md, 'utf8');
        console.log(`Plan successfully generated and written to ${projectDir}/.scrimble/plan.md`);
      } else {
        console.log('Plan data missing from checkpoint storage. Run may have failed.');
      }
      
    } catch (err) {
      console.error('Execution failed:', err);
    }
  });


program
  .command('status')
  .description('Show local sync status')
  .argument('[projectDir]', 'Project directory', '.')
  .action(async (projectDir) => {
    const dbPath = path.resolve(projectDir, '.scrimble', 'local.db');
    const { getSyncStatus } = await import('./sync.js');
    const { pendingEvents } = await getSyncStatus(dbPath);
    console.log(`${pendingEvents} changes pending sync.`);
  });

program.parse();
