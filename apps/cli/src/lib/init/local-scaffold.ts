import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CONFIG_FILE, PROJECT_FILE, RESEARCH_FILE, scrimbleConfigSchema } from '@scrimble/shared';
import { ensureLedgerDirs } from '../ledger/storage.js';
import { writeSecureJson } from '../security.js';
import type { DetectedStack } from './stack-detection.js';

type ParsedScrimbleConfig = ReturnType<typeof scrimbleConfigSchema.parse>;

export interface LocalScaffoldInput {
  cwd: string;
  scrimbleDir: string;
  repoName: string;
  goal?: string;
  stack: DetectedStack;
  config: ParsedScrimbleConfig;
  projectData: Record<string, unknown>;
}

export async function setupLocalScaffold(input: LocalScaffoldInput): Promise<void> {
  await fs.mkdir(input.scrimbleDir, { recursive: true });
  await fs.mkdir(path.join(input.scrimbleDir, 'verification'), { recursive: true });
  await fs.mkdir(path.join(input.scrimbleDir, 'prompts'), { recursive: true });
  await fs.mkdir(path.join(input.scrimbleDir, 'rules'), { recursive: true });

  await ensureLedgerDirs(input.cwd);

  await writeSecureJson(path.join(input.scrimbleDir, CONFIG_FILE), input.config);
  await writeSecureJson(path.join(input.scrimbleDir, PROJECT_FILE), input.projectData);

  const gitignoreContent = `# Scrimble runtime artifacts
runtime/
telemetry.ndjson
*.log
`;
  await fs.writeFile(path.join(input.scrimbleDir, '.gitignore'), gitignoreContent);

  const goal = input.goal ?? 'Not specified yet';
  const capturedAt = new Date().toISOString();
  const agentContext = `# Scrimble Agent Context

This file provides context for AI coding agents working on this project.

## Project
- Name: ${input.repoName}
- Goal: ${goal}

## Stack
- Languages: ${input.stack.languages.join(', ') || 'Unknown'}
- Frameworks: ${input.stack.frameworks.join(', ') || 'None detected'}

## Current Status
Run \`scrimble\` to see the current execution chunk and what to work on next.

## Rules
- Follow the current chunk prompt exactly
- Do not modify files listed in "Do Not Touch"
- Complete the "Done When" conditions before marking complete
`;
  await fs.writeFile(path.join(input.scrimbleDir, 'rules', 'agent-context.md'), agentContext);

  const researchSummary = `# Research Summary

No dedicated research findings captured yet.

## Initial Context
- Goal: ${goal}
- Repository: ${input.repoName}
- Captured At: ${capturedAt}
`;
  await fs.writeFile(path.join(input.scrimbleDir, RESEARCH_FILE), researchSummary);
}
