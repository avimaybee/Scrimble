import { describe, expect, it } from 'vitest';
import { generateTaskGraph } from './generator.js';

describe('planning generator', () => {
  it('generates ordered task graph from intent', () => {
    const output = generateTaskGraph({
      intent: {
        id: 'intent-1',
        projectName: 'scrimble',
        goal: 'Ship ledger orchestration',
        productVision: 'Make Scrimble a reliable local orchestrator',
        productAssumptions: ['Use existing TypeScript stack'],
        productConstraints: [],
        technicalConstraints: ['Do not break existing commands'],
        constraints: ['Do not break existing commands'],
        successCriteria: ['Core scheduling works', 'Verification catches drift'],
        nonGoals: [],
        outOfScope: [],
        targetUsers: 'CLI maintainers',
        timeline: 'flexible',
        qualityPreference: 'production',
        inferredStack: {
          projectType: 'brownfield',
          repoName: 'scrimble',
          repoPath: '.',
          languages: ['TypeScript'],
          frameworks: ['oclif'],
          packageManager: 'pnpm',
        },
        discoveryMode: 'autogenerate',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      repoContext: {
        name: 'scrimble',
        frameworks: ['oclif'],
        keyDirectories: ['apps/cli', 'packages/shared'],
      },
      existingFiles: ['apps/cli/src/commands/run.ts'],
      foundationContext: [
        { path: '.scrimble/context/product.md', content: '# Product\nGoal details' },
      ],
      scriptCatalog: {
        packageManager: 'pnpm',
        rootScripts: ['lint', 'build', 'test'],
        workspaceScripts: [{ path: 'apps/cli', name: 'scrimble', scripts: ['lint', 'test', 'build'] }],
      },
      contextArtifacts: [{ path: 'GEMINI.md', kind: 'gemini_md' }],
      workerPreferences: {
        allowParallel: true,
        maxParallelWorkers: 2,
        defaultWorker: 'gemini',
      },
    });

    expect(output.graph.tasks.length).toBeGreaterThan(0);
    expect(output.graph.edges.length).toBeGreaterThan(0);
    expect(output.graph.phases.length).toBeGreaterThan(0);
    expect(output.graph.tasks.every((task) => task.ownedFiles.length > 0)).toBe(true);
    expect(output.graph.tasks.every((task) => typeof task.rationale === 'string' && task.rationale.length > 0)).toBe(true);
    expect(output.graph.metadata.contextSourcesUsed).toEqual(['GEMINI.md', '.scrimble/context/product.md']);
    expect(output.qualityWarnings.length).toBeGreaterThanOrEqual(0);
  });
});

