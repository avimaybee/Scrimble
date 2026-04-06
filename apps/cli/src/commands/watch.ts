import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import { createRepoWatcher, evaluateProactiveSignals, type RepoWatchEvent } from '../lib/watch/index.js';
import { runVerification } from '../lib/verify/index.js';
import { loadPlanState, readLatestVerification, type LocalPlanState } from '../lib/local/index.js';
import { getActiveTrack, getNextTask, loadConductorWorkspace, parsePlan } from '../lib/conductor/index.js';
import { loadRuntimeState } from '../lib/conductor/runtime.js';
import { recordTelemetry } from '../lib/telemetry.js';
import { getScrimblePaths } from '../lib/local/index.js';

interface WatchState {
  paused: boolean;
  quietMode: boolean;
  updatedAt: string;
}

function summarizeBatch(events: RepoWatchEvent[]): string {
  const created = events.filter((event) => event.type === 'created').length;
  const changed = events.filter((event) => event.type === 'changed').length;
  const deleted = events.filter((event) => event.type === 'deleted').length;
  return `created ${created} • changed ${changed} • deleted ${deleted}`;
}

async function readWatchState(): Promise<WatchState> {
  const filePath = getScrimblePaths().watchState;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<WatchState>;
    return {
      paused: parsed.paused ?? false,
      quietMode: parsed.quietMode ?? false,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return {
      paused: false,
      quietMode: false,
      updatedAt: new Date().toISOString(),
    };
  }
}

async function writeWatchState(state: WatchState): Promise<void> {
  const filePath = getScrimblePaths().watchState;
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export default class Watch extends Command {
  static override description = 'Run resident mode and proactively surface next actions while files change';

  static override examples = [
    '<%= config.bin %> watch',
    '<%= config.bin %> watch --verify --notify',
    '<%= config.bin %> watch --pause',
    '<%= config.bin %> watch --resume',
  ];

  static override flags = {
    json: Flags.boolean({
      description: 'Emit change batches as JSON',
      default: false,
    }),
    quiet: Flags.boolean({
      description: 'Suppress per-file events and print only summaries',
      default: false,
    }),
    verify: Flags.boolean({
      description: 'Run verification after each file-change batch',
      default: true,
    }),
    'verify-command': Flags.string({
      description: 'Verification command (repeatable)',
      multiple: true,
    }),
    notify: Flags.boolean({
      description: 'Emit proactive notifications with terminal bell for warnings',
      default: true,
      allowNo: true,
    }),
    pause: Flags.boolean({
      description: 'Pause proactive notifications and exit',
      default: false,
    }),
    resume: Flags.boolean({
      description: 'Resume proactive notifications and exit',
      default: false,
    }),
    'debounce-ms': Flags.integer({
      description: 'Batch debounce duration in milliseconds',
      default: 300,
      min: 50,
    }),
    'max-alerts-per-minute': Flags.integer({
      description: 'Alert throttle to avoid notification spam',
      default: 6,
      min: 1,
    }),
    'signal-cooldown-ms': Flags.integer({
      description: 'Minimum time between repeating the same proactive signal',
      default: 15000,
      min: 1000,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Watch);
    const persistedState = await readWatchState();

    if (flags.pause && flags.resume) {
      this.log(chalk.red('\nUse either --pause or --resume, not both.\n'));
      this.exit(1);
    }

    if (flags.pause) {
      await writeWatchState({
        ...persistedState,
        paused: true,
        quietMode: flags.quiet || persistedState.quietMode,
        updatedAt: new Date().toISOString(),
      });
      this.log(chalk.yellow('\nProactive watch notifications paused.\n'));
      return;
    }

    if (flags.resume) {
      await writeWatchState({
        ...persistedState,
        paused: false,
        quietMode: flags.quiet ? true : false,
        updatedAt: new Date().toISOString(),
      });
      this.log(chalk.green('\nProactive watch notifications resumed.\n'));
      return;
    }

    if (persistedState.paused) {
      this.log(chalk.yellow('\nWatch mode is currently paused. Run `scrimble watch --resume` first.\n'));
      return;
    }

    let verificationInFlight = false;
    let planCache: LocalPlanState = await loadPlanState();
    const conductorWorkspace = await loadConductorWorkspace();
    let alertsInWindow = 0;
    let alertWindowStartedAt = Date.now();
    const lastSignalAt = new Map<string, number>();

    const watcher = createRepoWatcher({
      debounceMs: flags['debounce-ms'],
      onEvent: (event) => {
        if (flags.quiet || flags.json || persistedState.quietMode) return;
        const icon =
          event.type === 'created'
            ? chalk.green('+')
            : event.type === 'deleted'
              ? chalk.red('-')
              : chalk.cyan('~');
        this.log(`${icon} ${event.relativePath}`);
      },
      onBatch: async (events) => {
        try {
          if (flags.json) {
            this.log(JSON.stringify({ type: 'batch', events }, null, 2));
          } else {
            this.log(chalk.dim(`[watch] ${summarizeBatch(events)}`));
          }

          let verificationResult = await readLatestVerification();
          if (flags.verify && !verificationInFlight) {
            verificationInFlight = true;
            try {
              const result = await runVerification({
                ...(flags['verify-command'] ? { commands: flags['verify-command'] } : {}),
              });
              verificationResult = result;
              const color =
                result.status === 'pass'
                  ? chalk.green
                  : result.status === 'fail'
                    ? chalk.red
                    : chalk.yellow;
              this.log(color(`[verify] ${result.status.toUpperCase()} (${Math.round(result.confidence * 100)}%)`));
            } catch (error) {
              this.log(chalk.yellow(`[verify] failed: ${error instanceof Error ? error.message : String(error)}`));
            } finally {
              verificationInFlight = false;
            }
          }

          planCache = await loadPlanState();
          const proactiveSignals = evaluateProactiveSignals({
            events,
            plan: planCache,
            verificationResult,
          });

          const now = Date.now();
          if (now - alertWindowStartedAt > 60_000) {
            alertWindowStartedAt = now;
            alertsInWindow = 0;
          }

          for (const signal of proactiveSignals) {
            if (alertsInWindow >= flags['max-alerts-per-minute']) {
              break;
            }

            const signalKey = `${signal.type}:${signal.suggestedCommand}`;
            const lastSeen = lastSignalAt.get(signalKey);
            if (lastSeen && now - lastSeen < flags['signal-cooldown-ms']) {
              continue;
            }
            lastSignalAt.set(signalKey, now);

            const color = signal.severity === 'warn' ? chalk.yellow : chalk.cyan;
            this.log(
              color(
                `[proactive] ${signal.message} (suggested: ${signal.suggestedCommand}, confidence ${Math.round(signal.confidence * 100)}%)`,
              ),
            );
            alertsInWindow += 1;

            if (flags.notify && signal.severity === 'warn') {
              this.log('\u0007');
            }

            await recordTelemetry({
              event: 'proactive_signal',
              payload: {
                type: signal.type,
                severity: signal.severity,
                suggestedCommand: signal.suggestedCommand,
                confidence: signal.confidence,
              },
            });
          }

          if (conductorWorkspace.exists) {
            const runtimeState = await loadRuntimeState();
            const activeTrack =
              (runtimeState.activeTrackId
                ? conductorWorkspace.tracks.find((track) => track.id === runtimeState.activeTrackId)
                : undefined) ?? getActiveTrack(conductorWorkspace);

            const conductorSignals: Array<{
              key: string;
              message: string;
              suggestedCommand: string;
              severity: 'warn' | 'info';
              type: string;
            }> = [];

            if (runtimeState.status === 'stuck' || runtimeState.status === 'failed') {
              conductorSignals.push({
                key: `runtime:${runtimeState.status}`,
                type: 'run_status',
                severity: 'warn',
                message: `Conductor run is ${runtimeState.status}.`,
                suggestedCommand: 'scrimble logs',
              });
            }

            if (activeTrack?.planPath) {
              const trackPlan = await parsePlan(activeTrack.planPath, activeTrack.id);
              const nextTask = getNextTask(trackPlan);

              if (
                nextTask &&
                nextTask.isManualVerification &&
                (nextTask.status === 'in_progress' || runtimeState.status === 'paused')
              ) {
                conductorSignals.push({
                  key: `manual:${activeTrack.id}:${nextTask.id}`,
                  type: 'manual_checkpoint',
                  severity: 'warn',
                  message: `Manual checkpoint pending: ${nextTask.title}`,
                  suggestedCommand: 'scrimble done',
                });
              }

              if (
                events.length > 0 &&
                (runtimeState.status === 'running' || runtimeState.status === 'verifying')
              ) {
                conductorSignals.push({
                  key: `drift:${activeTrack.id}:${runtimeState.status}`,
                  type: 'task_drift',
                  severity: 'warn',
                  message: 'Repository changed while autonomous run is active.',
                  suggestedCommand: 'scrimble verify',
                });
              }
            }

            if (verificationResult) {
              const latestBatchTimestamp = events.reduce((latest, event) => {
                if (event.timestamp > latest) {
                  return event.timestamp;
                }
                return latest;
              }, '');
              if (latestBatchTimestamp && latestBatchTimestamp > verificationResult.timestamp) {
                conductorSignals.push({
                  key: `verification:stale:${latestBatchTimestamp}`,
                  type: 'stale_verification',
                  severity: 'info',
                  message: 'Code changed after last verification result.',
                  suggestedCommand: 'scrimble verify',
                });
              }
            }

            for (const signal of conductorSignals) {
              if (alertsInWindow >= flags['max-alerts-per-minute']) {
                break;
              }

              const lastSeen = lastSignalAt.get(signal.key);
              if (lastSeen && now - lastSeen < flags['signal-cooldown-ms']) {
                continue;
              }
              lastSignalAt.set(signal.key, now);

              const color = signal.severity === 'warn' ? chalk.yellow : chalk.cyan;
              this.log(
                color(
                  `[conductor] ${signal.message} (suggested: ${signal.suggestedCommand})`,
                ),
              );
              alertsInWindow += 1;

              if (flags.notify && signal.severity === 'warn') {
                this.log('\u0007');
              }

              await recordTelemetry({
                event: 'conductor_watch_signal',
                payload: {
                  type: signal.type,
                  severity: signal.severity,
                  suggestedCommand: signal.suggestedCommand,
                },
              });
            }
          }
        } catch (error) {
          this.log(chalk.yellow(`[watch] batch processing failed: ${error instanceof Error ? error.message : String(error)}`));
        }
      },
    });

    this.log('');
    this.log(chalk.bold('👀 Scrimble proactive watch mode started'));
    this.log(chalk.dim(`Debounce: ${flags['debounce-ms']}ms`));
    this.log(chalk.dim(`Verification on change: ${flags.verify ? 'enabled' : 'disabled'}`));
    this.log(chalk.dim(`Alert throttle: ${flags['max-alerts-per-minute']} alerts/minute`));
    this.log(chalk.dim(`Signal cooldown: ${flags['signal-cooldown-ms']}ms`));
    if (conductorWorkspace.exists) {
      this.log(chalk.dim('Conductor-aware signals: enabled'));
    }
    this.log(chalk.dim('Press Ctrl+C to stop.'));
    this.log('');

    await new Promise<void>((resolve) => {
      const shutdown = async (): Promise<void> => {
        await watcher.close();
        resolve();
      };

      process.on('SIGINT', () => {
        void shutdown();
      });
      process.on('SIGTERM', () => {
        void shutdown();
      });
    });

    this.log(chalk.dim('Watch mode stopped.'));
  }
}
