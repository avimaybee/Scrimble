import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseTracks,
  parsePlan,
  loadConductorWorkspace,
  getActiveTrack,
  getNextTask,
  getPlanStats,
} from './parser.js';

describe('Conductor Parser', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `conductor-parser-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('parseTracks', () => {
    it('parses tracks.md with various checkbox states', async () => {
      const conductorDir = path.join(testDir, 'conductor');
      await fs.mkdir(path.join(conductorDir, 'tracks/auth-flow'), { recursive: true });
      await fs.mkdir(path.join(conductorDir, 'tracks/database-schema'), { recursive: true });

      await fs.writeFile(
        path.join(conductorDir, 'tracks.md'),
        `# Tracks

- [x] Auth Flow (auth-flow)
- [~] Database Schema (database-schema)
- [ ] API Routes (api-routes)
- [!] Blocked Feature (blocked-feature)
`,
        'utf8',
      );

      // Create plan.md in auth-flow
      await fs.writeFile(path.join(conductorDir, 'tracks/auth-flow/plan.md'), '# Plan', 'utf8');

      const tracks = await parseTracks(conductorDir);

      expect(tracks).toHaveLength(4);
      expect(tracks[0]).toMatchObject({ id: 'auth-flow', title: 'Auth Flow', status: 'completed' });
      expect(tracks[0]?.planPath).toBeDefined();
      expect(tracks[1]).toMatchObject({
        id: 'database-schema',
        title: 'Database Schema',
        status: 'active',
      });
      expect(tracks[2]).toMatchObject({ id: 'api-routes', title: 'API Routes', status: 'pending' });
      expect(tracks[3]).toMatchObject({
        id: 'blocked-feature',
        title: 'Blocked Feature',
        status: 'blocked',
      });
    });

    it('generates ID from title when not provided', async () => {
      const conductorDir = path.join(testDir, 'conductor');
      await fs.mkdir(conductorDir, { recursive: true });

      await fs.writeFile(
        path.join(conductorDir, 'tracks.md'),
        `# Tracks
- [ ] My Cool Feature
`,
        'utf8',
      );

      const tracks = await parseTracks(conductorDir);
      expect(tracks[0]?.id).toBe('my-cool-feature');
    });

    it('returns empty array when tracks.md does not exist', async () => {
      const conductorDir = path.join(testDir, 'conductor');
      await fs.mkdir(conductorDir, { recursive: true });

      const tracks = await parseTracks(conductorDir);
      expect(tracks).toEqual([]);
    });
  });

  describe('parsePlan', () => {
    it('parses plan.md with phases and tasks', async () => {
      const planPath = path.join(testDir, 'plan.md');
      await fs.writeFile(
        planPath,
        `# Implementation Plan

## Phase 1: Setup

- [ ] Task: Create project structure
- [x] Task: Configure linting

## Phase 2: Core

- [~] Task: Implement auth module
- [ ] Task: Manual verification required [manual]
`,
        'utf8',
      );

      const plan = await parsePlan(planPath, 'test-track');

      expect(plan.trackId).toBe('test-track');
      expect(plan.phases).toHaveLength(2);
      expect(plan.tasks).toHaveLength(4);

      const setupPhase = plan.phases[0];
      expect(setupPhase?.title).toBe('Phase 1: Setup');
      expect(setupPhase?.tasks).toHaveLength(2);

      const firstTask = plan.tasks[0];
      expect(firstTask?.title).toBe('Create project structure');
      expect(firstTask?.status).toBe('pending');

      const completedTask = plan.tasks[1];
      expect(completedTask?.status).toBe('completed');

      const inProgressTask = plan.tasks[2];
      expect(inProgressTask?.status).toBe('in_progress');

      const manualTask = plan.tasks[3];
      expect(manualTask?.isManualVerification).toBe(true);
    });

    it('returns empty plan when file does not exist', async () => {
      const plan = await parsePlan(path.join(testDir, 'nonexistent.md'), 'test');
      expect(plan.phases).toEqual([]);
      expect(plan.tasks).toEqual([]);
    });
  });

  describe('loadConductorWorkspace', () => {
    it('returns exists: false when conductor/ does not exist', async () => {
      const workspace = await loadConductorWorkspace(testDir);
      expect(workspace.exists).toBe(false);
      expect(workspace.tracks).toEqual([]);
    });

    it('loads workspace with all artifacts', async () => {
      const conductorDir = path.join(testDir, 'conductor');
      await fs.mkdir(conductorDir, { recursive: true });

      await fs.writeFile(path.join(conductorDir, 'product.md'), '# Product', 'utf8');
      await fs.writeFile(path.join(conductorDir, 'tech-stack.md'), '# Tech Stack', 'utf8');
      await fs.writeFile(path.join(conductorDir, 'tracks.md'), '- [ ] Track One', 'utf8');

      const workspace = await loadConductorWorkspace(testDir);

      expect(workspace.exists).toBe(true);
      expect(workspace.productPath).toBeDefined();
      expect(workspace.techStackPath).toBeDefined();
      expect(workspace.guidelinesPath).toBeUndefined();
      expect(workspace.tracks).toHaveLength(1);
    });
  });

  describe('getActiveTrack', () => {
    it('returns explicitly active track', () => {
      const workspace = {
        exists: true,
        tracks: [
          { id: 't1', title: 'T1', status: 'completed' as const },
          { id: 't2', title: 'T2', status: 'active' as const },
          { id: 't3', title: 'T3', status: 'pending' as const },
        ],
      };
      const active = getActiveTrack(workspace);
      expect(active?.id).toBe('t2');
    });

    it('falls back to first pending track', () => {
      const workspace = {
        exists: true,
        tracks: [
          { id: 't1', title: 'T1', status: 'completed' as const },
          { id: 't2', title: 'T2', status: 'pending' as const },
        ],
      };
      const active = getActiveTrack(workspace);
      expect(active?.id).toBe('t2');
    });
  });

  describe('getNextTask', () => {
    it('returns in_progress task first', () => {
      const plan = {
        trackId: 'test',
        phases: [],
        tasks: [
          {
            id: 't1',
            title: 'T1',
            status: 'pending' as const,
            substeps: [],
            isManualVerification: false,
            rawMarkdown: '',
          },
          {
            id: 't2',
            title: 'T2',
            status: 'in_progress' as const,
            substeps: [],
            isManualVerification: false,
            rawMarkdown: '',
          },
        ],
      };
      const next = getNextTask(plan);
      expect(next?.id).toBe('t2');
    });

    it('falls back to first pending task', () => {
      const plan = {
        trackId: 'test',
        phases: [],
        tasks: [
          {
            id: 't1',
            title: 'T1',
            status: 'completed' as const,
            substeps: [],
            isManualVerification: false,
            rawMarkdown: '',
          },
          {
            id: 't2',
            title: 'T2',
            status: 'pending' as const,
            substeps: [],
            isManualVerification: false,
            rawMarkdown: '',
          },
        ],
      };
      const next = getNextTask(plan);
      expect(next?.id).toBe('t2');
    });
  });

  describe('getPlanStats', () => {
    it('computes correct statistics', () => {
      const plan = {
        trackId: 'test',
        phases: [],
        tasks: [
          {
            id: 't1',
            title: 'T1',
            status: 'completed' as const,
            substeps: [],
            isManualVerification: false,
            rawMarkdown: '',
          },
          {
            id: 't2',
            title: 'T2',
            status: 'completed' as const,
            substeps: [],
            isManualVerification: false,
            rawMarkdown: '',
          },
          {
            id: 't3',
            title: 'T3',
            status: 'in_progress' as const,
            substeps: [],
            isManualVerification: false,
            rawMarkdown: '',
          },
          {
            id: 't4',
            title: 'T4',
            status: 'pending' as const,
            substeps: [],
            isManualVerification: true,
            rawMarkdown: '',
          },
          {
            id: 't5',
            title: 'T5',
            status: 'skipped' as const,
            substeps: [],
            isManualVerification: false,
            rawMarkdown: '',
          },
        ],
      };

      const stats = getPlanStats(plan);
      expect(stats.total).toBe(5);
      expect(stats.completed).toBe(2);
      expect(stats.inProgress).toBe(1);
      expect(stats.pending).toBe(1);
      expect(stats.skipped).toBe(1);
      expect(stats.manualCheckpoints).toBe(1);
    });
  });
});
