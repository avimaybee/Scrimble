import { describe, expect, it } from 'vitest';
import { generateTaskGraph } from './generator.js';

describe('planning generator', () => {
  it('generates ordered task graph from intent', () => {
    const output = generateTaskGraph({
      intent: {
        id: 'intent-1',
        goal: 'Ship ledger orchestration',
        productAssumptions: ['Use existing TypeScript stack'],
        constraints: ['Do not break existing commands'],
        successCriteria: ['Core scheduling works', 'Verification catches drift'],
        outOfScope: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      repoContext: {
        name: 'scrimble',
        frameworks: ['oclif'],
        keyDirectories: ['apps/cli', 'packages/shared'],
      },
      existingFiles: ['apps/cli/src/commands/run.ts'],
      contextArtifacts: [{ path: 'GEMINI.md', kind: 'gemini_md' }],
      workerPreferences: {
        allowParallel: true,
        maxParallelWorkers: 2,
        defaultWorker: 'gemini',
      },
    });

    expect(output.graph.tasks.length).toBeGreaterThan(0);
    expect(output.graph.edges.length).toBeGreaterThan(0);
    expect(output.graph.phases.length).toBe(3);
    expect(output.graph.metadata.contextSourcesUsed).toEqual(['GEMINI.md']);
  });
});

