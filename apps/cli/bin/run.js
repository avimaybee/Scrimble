#!/usr/bin/env node

import { execute } from '@oclif/core';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const knownTopLevelCommands = new Set([
  'config',
  'doctor',
  'help',
  'init',
  'logs',
  'root',
  'version',
]);

const deprecatedCommands = new Set([
  'approve',
  'assign',
  'conflicts',
  'done',
  'generate',
  'import',
  'login',
  'logout',
  'next',
  'prompt',
  'replan',
  'retry',
  'run',
  'skip',
  'status',
  'sync',
  'update',
  'verify',
  'watch',
  'workers',
]);

const cliArgs = process.argv.slice(2);
const firstArg = cliArgs[0];
const rootPromptFlags = new Set(['--prompt', '--yes', '--provider', '--model', '--api-key', '-y', '-v']);
const hasRootPromptFlag = cliArgs.some((arg) => rootPromptFlags.has(arg.split('=')[0] ?? arg));

if (firstArg && deprecatedCommands.has(firstArg)) {
  console.error('Scrimble is conversation-first now. This command has been removed.');
  console.error('Describe the goal instead: `scrimble "<request>"` or `scrimble --prompt "<request>"`.');
  console.error('Example: `scrimble "continue from the last interrupted task"`');
  console.error('Setup/diagnostics commands still available: `scrimble init`, `scrimble config set-ai`, `scrimble doctor`, `scrimble logs`.');
  process.exit(0);
}

if (firstArg && firstArg.startsWith('-') && hasRootPromptFlag) {
  process.argv = [...process.argv.slice(0, 2), 'root', ...cliArgs];
}

if (firstArg && !firstArg.startsWith('-') && !knownTopLevelCommands.has(firstArg)) {
  process.argv = [...process.argv.slice(0, 2), 'root', '--prompt', cliArgs.join(' ')];
}

const currentDir = dirname(fileURLToPath(import.meta.url));
await execute({ dir: dirname(currentDir) });
