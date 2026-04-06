import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import {
  formatCloudError,
  listProjectEvents,
  resolveCloudClientConfig,
  type CloudClientConfig,
  type CloudProjectEvent,
} from '../lib/api/index.js';
import { readRuntimeEvents } from '../lib/conductor/runtime.js';
import type { RuntimeEvent, RuntimeEventType } from '@scrimble/shared';

const RUNTIME_EVENT_TYPES: RuntimeEventType[] = [
  'run_started',
  'run_completed',
  'run_failed',
  'run_paused',
  'run_resumed',
  'task_started',
  'task_completed',
  'task_skipped',
  'task_failed',
  'task_stalled',
  'task_retried',
  'verification_started',
  'verification_passed',
  'verification_failed',
  'track_approved',
  'track_completed',
  'track_creation_started',
  'track_creation_completed',
  'manual_checkpoint_reached',
];

function summarizeData(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const record = data as Record<string, unknown>;
  const prioritizedKeys = [
    'runId',
    'trackId',
    'taskId',
    'step',
    'attempt',
    'maxAttempts',
    'status',
    'chunkId',
    'chunkTitle',
    'error',
    'message',
    'reason',
    'source',
  ];
  const parts: string[] = [];
  for (const key of prioritizedKeys) {
    const value = record[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    parts.push(`${key}=${String(value)}`);
  }

  if (parts.length > 0) {
    return parts.join(' ');
  }

  const fallback = JSON.stringify(data);
  return fallback.length > 180 ? `${fallback.slice(0, 177)}...` : fallback;
}

function renderCloudEventLine(event: CloudProjectEvent): string {
  const timestamp = new Date(event.createdAt).toLocaleString();
  const summary = summarizeData(event.data);
  return summary.length > 0
    ? `${chalk.dim(timestamp)} ${chalk.cyan(event.type)} ${chalk.dim(summary)}`
    : `${chalk.dim(timestamp)} ${chalk.cyan(event.type)}`;
}

function renderRuntimeEventLine(event: RuntimeEvent): string {
  const timestamp = new Date(event.timestamp).toLocaleString();
  const summary = summarizeData(event.data);
  return summary.length > 0
    ? `${chalk.dim(timestamp)} ${chalk.magenta(event.type)} ${chalk.dim(summary)}`
    : `${chalk.dim(timestamp)} ${chalk.magenta(event.type)}`;
}

function parseRuntimeTypeFilter(value: string | undefined): RuntimeEventType[] | undefined {
  if (!value) {
    return undefined;
  }
  if (RUNTIME_EVENT_TYPES.includes(value as RuntimeEventType)) {
    return [value as RuntimeEventType];
  }
  return undefined;
}

export default class Logs extends Command {
  static override description = 'Show local runtime events first, then cloud execution/project events';

  static override examples = [
    '<%= config.bin %> logs',
    '<%= config.bin %> logs --source local',
    '<%= config.bin %> logs --type task_failed --limit 50',
    '<%= config.bin %> logs --follow',
  ];

  static override flags = {
    source: Flags.string({
      description: 'Event source to query',
      options: ['all', 'local', 'cloud'],
      default: 'all',
    }),
    type: Flags.string({
      description: 'Filter by exact event type',
    }),
    since: Flags.string({
      description: 'Only show events at/after this ISO timestamp',
    }),
    limit: Flags.integer({
      description: 'Maximum events to return per source',
      default: 40,
      min: 1,
      max: 500,
    }),
    follow: Flags.boolean({
      description: 'Poll for new events continuously',
      default: false,
    }),
    'poll-interval-ms': Flags.integer({
      description: 'Follow polling interval in milliseconds',
      default: 2000,
      min: 500,
    }),
    json: Flags.boolean({
      description: 'Emit raw JSON payload',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Logs);
    const includeLocal = flags.source !== 'cloud';
    const includeCloud = flags.source !== 'local';
    const runtimeTypes = parseRuntimeTypeFilter(flags.type);

    let cloudConfig: CloudClientConfig | null = null;
    if (includeCloud) {
      try {
        cloudConfig = await resolveCloudClientConfig();
      } catch (error) {
        if (!includeLocal) {
          this.log(chalk.red(`\nCloud configuration is missing: ${formatCloudError(error)}\n`));
          this.exit(1);
          return;
        }
        this.log(chalk.yellow(`\nCloud configuration unavailable: ${formatCloudError(error)}`));
        this.log(chalk.dim('Continuing with local runtime events only.\n'));
      }
    }

    const seenRuntimeIds = new Set<string>();
    const seenCloudIds = new Set<string>();
    let runtimeSince = flags.since;
    let cloudSince = flags.since;
    let shouldStop = false;

    const stop = () => {
      shouldStop = true;
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    const emitRuntime = (events: RuntimeEvent[]) => {
      const ordered = [...events].reverse();
      for (const event of ordered) {
        if (seenRuntimeIds.has(event.id)) {
          continue;
        }
        seenRuntimeIds.add(event.id);
        if (!flags.json) {
          this.log(renderRuntimeEventLine(event));
        }
      }
      const newest = events[0];
      if (newest) {
        runtimeSince = newest.timestamp;
      }
    };

    const emitCloud = (events: CloudProjectEvent[]) => {
      const ordered = [...events].reverse();
      for (const event of ordered) {
        if (seenCloudIds.has(event.id)) {
          continue;
        }
        seenCloudIds.add(event.id);
        if (!flags.json) {
          this.log(renderCloudEventLine(event));
        }
      }
      const newest = events[0];
      if (newest) {
        cloudSince = newest.createdAt;
      }
    };

    try {
      if (!flags.follow) {
        const runtimeEvents = includeLocal
          ? await readRuntimeEvents({
            limit: flags.limit,
            ...(runtimeTypes ? { types: runtimeTypes } : {}),
            ...(flags.since ? { since: flags.since } : {}),
          })
          : [];
        const cloudEvents = includeCloud && cloudConfig
          ? await listProjectEvents(cloudConfig, {
            ...(flags.type ? { type: flags.type } : {}),
            ...(flags.since ? { since: flags.since } : {}),
            limit: flags.limit,
          })
          : [];

        if (flags.json) {
          this.log(
            JSON.stringify(
              {
                projectId: cloudConfig?.projectId ?? null,
                localEvents: runtimeEvents,
                cloudEvents,
              },
              null,
              2,
            ),
          );
          return;
        }

        if (runtimeEvents.length === 0 && cloudEvents.length === 0) {
          this.log(chalk.dim('\nNo events found for the selected source(s).\n'));
          return;
        }

        this.log('');
        if (includeLocal) {
          this.log(chalk.bold('Local runtime events:'));
          if (runtimeEvents.length === 0) {
            this.log(chalk.dim('  (none)'));
          } else {
            emitRuntime(runtimeEvents);
          }
          this.log('');
        }

        if (includeCloud) {
          this.log(chalk.bold('Cloud events:'));
          if (!cloudConfig) {
            this.log(chalk.dim('  (unavailable: no cloud configuration)'));
          } else if (cloudEvents.length === 0) {
            this.log(chalk.dim('  (none)'));
          } else {
            emitCloud(cloudEvents);
          }
          this.log('');
        }
        return;
      }

      this.log('');
      this.log(chalk.bold('📡 Streaming events'));
      this.log(chalk.dim(`Source: ${flags.source}`));
      this.log(chalk.dim('Press Ctrl+C to stop.'));
      this.log('');

      while (!shouldStop) {
        if (includeLocal) {
          const runtimeEvents = await readRuntimeEvents({
            limit: flags.limit,
            ...(runtimeTypes ? { types: runtimeTypes } : {}),
            ...(runtimeSince ? { since: runtimeSince } : {}),
          });
          if (flags.json) {
            this.log(
              JSON.stringify(
                {
                  source: 'local',
                  events: runtimeEvents,
                },
                null,
                2,
              ),
            );
          } else {
            emitRuntime(runtimeEvents);
          }
        }

        if (includeCloud && cloudConfig) {
          const cloudEvents = await listProjectEvents(cloudConfig, {
            ...(flags.type ? { type: flags.type } : {}),
            ...(cloudSince ? { since: cloudSince } : {}),
            limit: flags.limit,
          });
          if (flags.json) {
            this.log(
              JSON.stringify(
                {
                  source: 'cloud',
                  projectId: cloudConfig.projectId,
                  events: cloudEvents,
                },
                null,
                2,
              ),
            );
          } else {
            emitCloud(cloudEvents);
          }
        }

        await new Promise((resolve) => setTimeout(resolve, flags['poll-interval-ms']));
      }
    } catch (error) {
      this.log(chalk.red(`\nLogs request failed: ${formatCloudError(error)}\n`));
      this.exit(1);
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  }
}
