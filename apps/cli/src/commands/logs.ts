import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { formatCloudError, listProjectEvents, resolveCloudClientConfig, type CloudProjectEvent } from '../lib/api/index.js';

function summarizeEventData(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const record = data as Record<string, unknown>;
  const prioritizedKeys = [
    'runId',
    'step',
    'attempt',
    'maxAttempts',
    'status',
    'chunkId',
    'chunkTitle',
    'error',
    'message',
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

function renderEventLine(event: CloudProjectEvent): string {
  const timestamp = new Date(event.createdAt).toLocaleString();
  const summary = summarizeEventData(event.data);
  return summary.length > 0
    ? `${chalk.dim(timestamp)} ${chalk.cyan(event.type)} ${chalk.dim(summary)}`
    : `${chalk.dim(timestamp)} ${chalk.cyan(event.type)}`;
}

export default class Logs extends Command {
  static override description = 'Show cloud execution and project events from the canonical event log';

  static override examples = [
    '<%= config.bin %> logs',
    '<%= config.bin %> logs --type generation_step_retrying --limit 50',
    '<%= config.bin %> logs --follow',
  ];

  static override flags = {
    type: Flags.string({
      description: 'Filter by exact cloud event type',
    }),
    since: Flags.string({
      description: 'Only show events at/after this ISO timestamp',
    }),
    limit: Flags.integer({
      description: 'Maximum events to return',
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

    let cloud;
    try {
      cloud = await resolveCloudClientConfig();
    } catch {
      this.log(chalk.red('\nCloud configuration is missing. Run `scrimble init` and `scrimble login` first.\n'));
      this.exit(1);
      return;
    }

    const seenEventIds = new Set<string>();
    let cursorSince = flags.since;
    let shouldStop = false;

    const stop = () => {
      shouldStop = true;
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    const emitEvents = (events: CloudProjectEvent[]) => {
      const ordered = [...events].reverse();
      for (const event of ordered) {
        if (seenEventIds.has(event.id)) {
          continue;
        }
        seenEventIds.add(event.id);
        if (!flags.json) {
          this.log(renderEventLine(event));
        }
      }
      const newest = events[0];
      if (newest) {
        cursorSince = newest.createdAt;
      }
    };

    try {
      if (!flags.follow) {
        const events = await listProjectEvents(cloud, {
          ...(flags.type ? { type: flags.type } : {}),
          ...(flags.since ? { since: flags.since } : {}),
          limit: flags.limit,
        });
        if (flags.json) {
          this.log(JSON.stringify({ projectId: cloud.projectId, events }, null, 2));
          return;
        }
        if (events.length === 0) {
          this.log(chalk.dim('\nNo cloud events found for this project.\n'));
          return;
        }
        this.log('');
        emitEvents(events);
        this.log('');
        return;
      }

      this.log('');
      this.log(chalk.bold(`📡 Streaming cloud events for ${cloud.projectId}`));
      this.log(chalk.dim('Press Ctrl+C to stop.'));
      this.log('');

      while (!shouldStop) {
        const events = await listProjectEvents(cloud, {
          ...(flags.type ? { type: flags.type } : {}),
          ...(cursorSince ? { since: cursorSince } : {}),
          limit: flags.limit,
        });

        if (flags.json) {
          this.log(JSON.stringify({ projectId: cloud.projectId, events }, null, 2));
        } else {
          emitEvents(events);
        }

        await new Promise((resolve) => setTimeout(resolve, flags['poll-interval-ms']));
      }
    } catch (error) {
      this.log(chalk.red(`\nCloud logs request failed: ${formatCloudError(error)}\n`));
      this.exit(1);
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  }
}
