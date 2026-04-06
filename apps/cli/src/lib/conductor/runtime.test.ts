import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  getRuntimePaths,
  ensureRuntimeDirs,
  loadRuntimeState,
  saveRuntimeState,
  updateRuntimeState,
  setRunStatus,
  loadApprovals,
  approveTrack,
  revokeTrackApproval,
  isTrackApproved,
  appendRuntimeEvent,
  readRuntimeEvents,
  createTaskAttempt,
  loadTaskAttempt,
  listTaskAttempts,
  completeTaskAttempt,
  markAttemptStalled,
} from './runtime.js';

describe('Conductor Runtime', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `conductor-runtime-test-${Date.now()}`);
    await fs.mkdir(path.join(testDir, '.scrimble'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('getRuntimePaths', () => {
    it('returns correct paths', () => {
      const paths = getRuntimePaths(testDir);
      expect(paths.root).toContain('.scrimble');
      expect(paths.root).toContain('runtime');
      expect(paths.state).toContain('run-state.json');
      expect(paths.approvals).toContain('approvals.json');
      expect(paths.events).toContain('events.ndjson');
      expect(paths.attempts).toContain('attempts');
    });
  });

  describe('RuntimeState', () => {
    it('returns default state when file does not exist', async () => {
      const state = await loadRuntimeState(testDir);
      expect(state.status).toBe('idle');
      expect(state.attemptCount).toBe(0);
    });

    it('saves and loads state', async () => {
      const state = {
        status: 'running' as const,
        activeTrackId: 'track-1',
        activeTaskId: 'task-1',
        attemptCount: 3,
        lastActivityAt: new Date().toISOString(),
      };

      await saveRuntimeState(state, testDir);
      const loaded = await loadRuntimeState(testDir);

      expect(loaded.status).toBe('running');
      expect(loaded.activeTrackId).toBe('track-1');
      expect(loaded.attemptCount).toBe(3);
    });

    it('updates state with partial changes', async () => {
      await saveRuntimeState(
        { status: 'idle', attemptCount: 0, lastActivityAt: new Date().toISOString() },
        testDir,
      );

      const updated = await updateRuntimeState({ status: 'running', attemptCount: 1 }, testDir);

      expect(updated.status).toBe('running');
      expect(updated.attemptCount).toBe(1);
    });

    it('setRunStatus sets timestamps correctly', async () => {
      const state = await setRunStatus('running', {
        trackId: 'track-1',
        taskId: 'task-1',
        cwd: testDir,
      });

      expect(state.status).toBe('running');
      expect(state.activeTrackId).toBe('track-1');
      expect(state.startedAt).toBeDefined();

      const completed = await setRunStatus('completed', { cwd: testDir });
      expect(completed.completedAt).toBeDefined();
    });
  });

  describe('Approvals', () => {
    it('returns empty approvals when file does not exist', async () => {
      const state = await loadApprovals(testDir);
      expect(state.approvals).toEqual([]);
    });

    it('approves and checks track approval', async () => {
      await approveTrack('track-1', { cwd: testDir });

      const isApproved = await isTrackApproved('track-1', testDir);
      expect(isApproved).toBe(true);

      const notApproved = await isTrackApproved('track-2', testDir);
      expect(notApproved).toBe(false);
    });

    it('revokes track approval', async () => {
      await approveTrack('track-1', { cwd: testDir });
      await revokeTrackApproval('track-1', testDir);

      const isApproved = await isTrackApproved('track-1', testDir);
      expect(isApproved).toBe(false);
    });

    it('replaces existing approval for same track', async () => {
      await approveTrack('track-1', { scope: 'current_phase', cwd: testDir });
      await approveTrack('track-1', { scope: 'full', cwd: testDir });

      const state = await loadApprovals(testDir);
      expect(state.approvals).toHaveLength(1);
      expect(state.approvals[0]?.scope).toBe('full');
    });
  });

  describe('Events', () => {
    it('appends and reads events', async () => {
      await appendRuntimeEvent('run_started', { trackId: 'track-1' }, testDir);
      await appendRuntimeEvent('task_started', { taskId: 'task-1' }, testDir);

      const events = await readRuntimeEvents({ cwd: testDir });
      expect(events).toHaveLength(2);
      // Events are returned newest first
      expect(events[0]?.type).toBe('task_started');
      expect(events[1]?.type).toBe('run_started');
    });

    it('filters events by type', async () => {
      await appendRuntimeEvent('run_started', {}, testDir);
      await appendRuntimeEvent('task_started', {}, testDir);
      await appendRuntimeEvent('task_completed', {}, testDir);

      const taskEvents = await readRuntimeEvents({
        types: ['task_started', 'task_completed'],
        cwd: testDir,
      });
      expect(taskEvents).toHaveLength(2);
    });

    it('limits event count', async () => {
      await appendRuntimeEvent('run_started', {}, testDir);
      await appendRuntimeEvent('task_started', {}, testDir);
      await appendRuntimeEvent('task_completed', {}, testDir);

      const limited = await readRuntimeEvents({ limit: 2, cwd: testDir });
      expect(limited).toHaveLength(2);
    });

    it('returns empty array when file does not exist', async () => {
      const events = await readRuntimeEvents({ cwd: testDir });
      expect(events).toEqual([]);
    });
  });

  describe('TaskAttempts', () => {
    it('creates and loads task attempt', async () => {
      const attempt = await createTaskAttempt('task-1', 'track-1', 'hash123', testDir);

      expect(attempt.taskId).toBe('task-1');
      expect(attempt.trackId).toBe('track-1');
      expect(attempt.promptHash).toBe('hash123');
      expect(attempt.stalled).toBe(false);

      const loaded = await loadTaskAttempt(attempt.id, testDir);
      expect(loaded?.id).toBe(attempt.id);
    });

    it('increments attempt count in runtime state', async () => {
      await createTaskAttempt('task-1', 'track-1', 'hash1', testDir);
      await createTaskAttempt('task-1', 'track-1', 'hash2', testDir);

      const state = await loadRuntimeState(testDir);
      expect(state.attemptCount).toBe(2);
    });

    it('lists attempts for a task', async () => {
      await createTaskAttempt('task-1', 'track-1', 'hash1', testDir);
      await createTaskAttempt('task-1', 'track-1', 'hash2', testDir);
      await createTaskAttempt('task-2', 'track-1', 'hash3', testDir);

      const attempts = await listTaskAttempts('task-1', testDir);
      expect(attempts).toHaveLength(2);
    });

    it('completes task attempt', async () => {
      const attempt = await createTaskAttempt('task-1', 'track-1', 'hash1', testDir);

      const completed = await completeTaskAttempt(
        attempt.id,
        { exitCode: 0, verificationResult: 'pass' },
        testDir,
      );

      expect(completed.completedAt).toBeDefined();
      expect(completed.exitCode).toBe(0);
      expect(completed.verificationResult).toBe('pass');
    });

    it('marks attempt as stalled', async () => {
      const attempt = await createTaskAttempt('task-1', 'track-1', 'hash1', testDir);

      const stalled = await markAttemptStalled(attempt.id, testDir);
      expect(stalled.stalled).toBe(true);

      // Check event was emitted
      const events = await readRuntimeEvents({ types: ['task_stalled'], cwd: testDir });
      expect(events).toHaveLength(1);
    });

    it('returns null for nonexistent attempt', async () => {
      const loaded = await loadTaskAttempt('nonexistent', testDir);
      expect(loaded).toBeNull();
    });
  });
});
