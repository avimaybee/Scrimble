import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createHash } from 'node:crypto';
import type { ConductorPlan, ConductorTask, ConductorTrack, ConductorWorkspace, RuntimeState } from '@scrimble/shared';
import {
  appendRuntimeEvent,
  completeTaskAttempt,
  createTaskAttempt,
  getActiveTrack,
  getNextTask,
  isTrackApproved,
  loadConductorWorkspace,
  loadRuntimeState,
  parsePlan,
  saveRuntimeState,
  setRunStatus,
  updateTaskStatus,
} from '../lib/conductor/index.js';
import { formatPreflightResult, runPreflight } from '../lib/gemini/index.js';
import {
  buildTaskPrompt,
  getGeminiError,
  isGeminiSuccess,
  runGeminiHeadless,
} from '../lib/gemini/session.js';
import { formatVerificationResult, verifyTask } from '../lib/conductor/verification.js';
import { buildAttemptSummary, determineRecoveryAction } from '../lib/conductor/recovery.js';
import { recordTelemetry } from '../lib/telemetry.js';
import { readTextIfExists } from '../lib/fs/index.js';

interface TrackContext {
  productDescription?: string;
  techStack?: string;
  guidelines?: string;
}

function markTaskStatusInMemory(plan: ConductorPlan, taskId: string, status: ConductorTask['status']): ConductorPlan {
  return {
    ...plan,
    tasks: plan.tasks.map((task) => (task.id === taskId ? { ...task, status } : task)),
  };
}

export default class Run extends Command {
  static override description = 'Run autonomous Conductor task execution';

  static override examples = [
    '<%= config.bin %> run',
    '<%= config.bin %> run --track auth-flow',
    '<%= config.bin %> run --track "Authentication Track"',
    '<%= config.bin %> run --dry-run',
    '<%= config.bin %> run --no-verify',
  ];

  static override flags = {
    track: Flags.string({
      description: 'Specific track ID or exact track title to run',
    }),
    'dry-run': Flags.boolean({
      description: 'Simulate task progression without executing Gemini',
      default: false,
    }),
    verify: Flags.boolean({
      description: 'Run verification after each task',
      default: true,
      allowNo: true,
    }),
    timeout: Flags.integer({
      description: 'Timeout per task in seconds',
      default: 300,
      min: 10,
    }),
    'max-tasks': Flags.integer({
      description: 'Maximum number of tasks to run (0 = unlimited)',
      default: 0,
      min: 0,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Run);

    const preflight = await runPreflight();
    if (!preflight.canProceed) {
      this.log('');
      this.log(chalk.red('Gemini preflight failed:'));
      this.log(formatPreflightResult(preflight));
      this.log('');
      this.exit(1);
      return;
    }

    const workspace = await loadConductorWorkspace();
    if (!workspace.exists) {
      this.log(chalk.red('\nNo Conductor workspace found. Run `scrimble init` first.\n'));
      this.exit(1);
      return;
    }

    const selectedTrack = await this.selectTrack(workspace, flags.track);
    if (!selectedTrack) {
      this.log('');
      if (flags.track) {
        this.log(chalk.yellow(`No track found matching "${flags.track}".`));
        this.log(chalk.dim('Use `scrimble status` to list available tracks.'));
      } else {
        this.log(chalk.yellow('No approved track available to run.'));
        this.log(chalk.dim('Run `scrimble approve <track-id>` to approve a track for execution.'));
      }
      this.log('');
      return;
    }

    const approved = await isTrackApproved(selectedTrack.id);
    if (!approved) {
      this.log('');
      this.log(chalk.yellow(`Track "${selectedTrack.id}" is not approved for autonomous execution.`));
      this.log(chalk.dim(`Run \`scrimble approve ${selectedTrack.id}\` to approve it.`));
      this.log('');
      return;
    }

    if (!selectedTrack.planPath) {
      this.log(chalk.red(`\nTrack "${selectedTrack.id}" has no plan.md.\n`));
      this.exit(1);
      return;
    }

    let plan: ConductorPlan;
    try {
      plan = await parsePlan(selectedTrack.planPath, selectedTrack.id);
    } catch (error) {
      this.log(chalk.red(`\nFailed to parse plan: ${error instanceof Error ? error.message : String(error)}\n`));
      this.exit(1);
      return;
    }

    const trackContext = await this.loadTrackContext(workspace);
    let runtimeState = await loadRuntimeState();

    this.log('');
    this.log(chalk.bold(`Running track: ${selectedTrack.title}`));
    this.log(chalk.dim(`Track ID: ${selectedTrack.id}`));
    this.log(chalk.dim(`Tasks: ${plan.tasks.length}`));
    if (flags['dry-run']) {
      this.log(chalk.dim('Mode: dry-run'));
    }
    this.log('');

    await setRunStatus('running', { trackId: selectedTrack.id });
    await appendRuntimeEvent('run_started', { trackId: selectedTrack.id, dryRun: flags['dry-run'] });

    let tasksCompleted = 0;
    const maxTasks = flags['max-tasks'];

    while (true) {
      if (maxTasks > 0 && tasksCompleted >= maxTasks) {
        this.log(chalk.yellow(`\nReached maximum task limit (${maxTasks}). Pausing.`));
        await setRunStatus('paused', { trackId: selectedTrack.id });
        await appendRuntimeEvent('run_paused', {
          trackId: selectedTrack.id,
          reason: 'max_tasks',
          tasksCompleted,
        });
        break;
      }

      const nextTask = getNextTask(plan);
      if (!nextTask) {
        this.log('');
        this.log(chalk.green('✓ All tasks completed!'));
        await setRunStatus('completed', { trackId: selectedTrack.id });
        await appendRuntimeEvent('track_completed', { trackId: selectedTrack.id });
        await appendRuntimeEvent('run_completed', { trackId: selectedTrack.id, tasksCompleted });
        break;
      }

      if (nextTask.isManualVerification) {
        this.log('');
        this.log(chalk.yellow(`⚠ Manual verification required: ${nextTask.title}`));
        this.log(chalk.dim('Run `scrimble done` after completing manual verification.'));
        await setRunStatus('paused', { trackId: selectedTrack.id, taskId: nextTask.id });
        await appendRuntimeEvent('manual_checkpoint_reached', {
          trackId: selectedTrack.id,
          taskId: nextTask.id,
        });
        await appendRuntimeEvent('run_paused', {
          trackId: selectedTrack.id,
          taskId: nextTask.id,
          reason: 'manual_checkpoint',
        });
        break;
      }

      this.log(chalk.cyan(`\n► Task: ${nextTask.title}`));
      if (nextTask.substeps.length > 0) {
        this.log(chalk.dim(`  Substeps: ${nextTask.substeps.length}`));
      }

      if (flags['dry-run']) {
        this.log(chalk.dim('  [dry-run] Would execute this task and mark complete'));
        plan = markTaskStatusInMemory(plan, nextTask.id, 'completed');
        tasksCompleted++;
        continue;
      }

      const result = await this.executeTask(nextTask, {
        trackId: selectedTrack.id,
        planPath: selectedTrack.planPath,
        runtimeState,
        timeoutMs: flags.timeout * 1000,
        verify: flags.verify,
        trackContext,
      });

      if (!result.success) {
        this.log(chalk.red(`\n✗ Task failed: ${result.error ?? 'Unknown error'}`));
        await setRunStatus('failed', {
          trackId: selectedTrack.id,
          taskId: nextTask.id,
          ...(result.error ? { error: result.error } : {}),
        });
        await appendRuntimeEvent('run_failed', {
          trackId: selectedTrack.id,
          taskId: nextTask.id,
          ...(result.error ? { error: result.error } : {}),
        });
        break;
      }

      tasksCompleted++;
      this.log(chalk.green(`✓ Task completed: ${nextTask.title}`));

      plan = await parsePlan(selectedTrack.planPath, selectedTrack.id);
      runtimeState = await loadRuntimeState();
    }

    this.log('');
    this.log(chalk.bold('Run Summary'));
    this.log(chalk.dim(`  Tasks completed: ${tasksCompleted}`));
    const finalState = await loadRuntimeState();
    this.log(chalk.dim(`  Final status: ${finalState.status}`));
    this.log('');

    await recordTelemetry({
      event: 'conductor_run_completed',
      payload: {
        trackId: selectedTrack.id,
        tasksCompleted,
        finalStatus: finalState.status,
        dryRun: flags['dry-run'],
      },
    });
  }

  private async selectTrack(workspace: ConductorWorkspace, selector: string | undefined): Promise<ConductorTrack | undefined> {
    if (selector) {
      const exactId = workspace.tracks.find((track) => track.id === selector);
      if (exactId) {
        return exactId;
      }

      const exactTitle = workspace.tracks.find(
        (track) => track.title.toLowerCase() === selector.toLowerCase(),
      );
      if (exactTitle) {
        return exactTitle;
      }

      return undefined;
    }

    const activeCandidate = getActiveTrack(workspace);
    if (activeCandidate && (await isTrackApproved(activeCandidate.id))) {
      return activeCandidate;
    }

    for (const track of workspace.tracks) {
      if (await isTrackApproved(track.id)) {
        return track;
      }
    }

    return undefined;
  }

  private async loadTrackContext(workspace: ConductorWorkspace): Promise<TrackContext> {
    const [productDescription, techStack, guidelines] = await Promise.all([
      readTextIfExists(workspace.productPath),
      readTextIfExists(workspace.techStackPath),
      readTextIfExists(workspace.guidelinesPath),
    ]);

    return {
      ...(productDescription ? { productDescription } : {}),
      ...(techStack ? { techStack } : {}),
      ...(guidelines ? { guidelines } : {}),
    };
  }

  private async executeTask(
    task: ConductorTask,
    options: {
      trackId: string;
      planPath: string;
      runtimeState: RuntimeState;
      timeoutMs: number;
      verify: boolean;
      trackContext: TrackContext;
    },
  ): Promise<{ success: boolean; error?: string }> {
    if (task.status === 'pending') {
      await updateTaskStatus(options.planPath, task.id, 'in_progress');
    }
    await setRunStatus('running', { trackId: options.trackId, taskId: task.id });

    const prompt = buildTaskPrompt({
      task: {
        title: task.title,
        description: task.rawMarkdown,
        substeps: task.substeps.map((substep) => substep.text),
        ...(task.phase ? { phase: task.phase } : {}),
      },
      trackContext: options.trackContext,
      doNotTouch: [],
      verificationHints: [],
    });

    const promptHash = createHash('sha256').update(prompt).digest('hex').slice(0, 16);
    const attempt = await createTaskAttempt(task.id, options.trackId, promptHash);

    this.log(chalk.dim('  Executing with Gemini...'));
    const response = await runGeminiHeadless(prompt, { timeout: options.timeoutMs });
    const decision = determineRecoveryAction(response, attempt, options.runtimeState);

    this.log(chalk.dim(`  ${buildAttemptSummary(attempt, response, decision)}`));

    let finalResponse = response;

    if (decision.action === 'stop') {
      await completeTaskAttempt(attempt.id, {
        exitCode: response.exitCode ?? -1,
        verificationResult: 'fail',
      });
      await appendRuntimeEvent('task_failed', { taskId: task.id, error: decision.reason });
      return { success: false, error: decision.reason };
    }

    if (decision.action === 'retry' && decision.continuationPrompt) {
      this.log(chalk.yellow('  Retrying with continuation prompt...'));

      const newState = await loadRuntimeState();
      await saveRuntimeState({
        ...newState,
        attemptCount: (newState.attemptCount ?? 0) + 1,
      });
      await appendRuntimeEvent('task_retried', { taskId: task.id, attemptId: attempt.id });

      const retryResponse = await runGeminiHeadless(decision.continuationPrompt, {
        timeout: options.timeoutMs,
      });
      if (!isGeminiSuccess(retryResponse)) {
        const retryError = getGeminiError(retryResponse);
        await completeTaskAttempt(attempt.id, {
          exitCode: retryResponse.exitCode ?? -1,
          verificationResult: 'fail',
        });
        await appendRuntimeEvent('task_failed', {
          taskId: task.id,
          ...(retryError ? { error: retryError } : {}),
        });
        return { success: false, ...(retryError ? { error: retryError } : {}) };
      }
      finalResponse = retryResponse;
    }

    if (options.verify) {
      this.log(chalk.dim('  Running verification...'));
      await setRunStatus('verifying', { trackId: options.trackId, taskId: task.id });
      await appendRuntimeEvent('verification_started', { taskId: task.id });

      const verification = await verifyTask(task);
      this.log(chalk.dim(`  ${formatVerificationResult(verification)}`));

      if (!verification.passed) {
        await completeTaskAttempt(attempt.id, {
          exitCode: finalResponse.exitCode ?? 0,
          verificationResult: 'fail',
        });
        await appendRuntimeEvent('verification_failed', { taskId: task.id, result: verification });
        return { success: false, error: `Verification failed: ${verification.summary}` };
      }

      await appendRuntimeEvent('verification_passed', { taskId: task.id, result: verification });
    }

    await updateTaskStatus(options.planPath, task.id, 'completed');
    const verificationResult = options.verify ? 'pass' : 'skipped';
    await completeTaskAttempt(attempt.id, {
      exitCode: finalResponse.exitCode ?? 0,
      verificationResult,
    });

    if (verificationResult === 'skipped') {
      await appendRuntimeEvent('task_completed', { taskId: task.id, attemptId: attempt.id });
    }

    return { success: true };
  }
}
