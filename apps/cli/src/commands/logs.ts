import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import type { LedgerEvent, LedgerEventType } from '@scrimble/shared';
import { readLedgerEvents } from '../lib/ledger/records.js';

function summarizeData(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const record = data as Record<string, unknown>;
  const keys = ['taskId', 'worker', 'attemptId', 'error', 'status', 'reason'];
  const parts: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    parts.push(`${key}=${String(value)}`);
  }
  return parts.join(' ');
}

function renderEventLine(event: LedgerEvent): string {
  const timestamp = new Date(event.timestamp).toLocaleString();
  const summary = summarizeData(event.data);
  return summary.length > 0
    ? `${chalk.dim(timestamp)} ${chalk.cyan(event.type)} ${chalk.dim(summary)}`
    : `${chalk.dim(timestamp)} ${chalk.cyan(event.type)}`;
}

function parseTypeFilter(value: string | undefined): LedgerEventType[] | undefined {
  if (!value) {
    return undefined;
  }
  return [value as LedgerEventType];
}

export default class Logs extends Command {
  static override description = 'Show local runtime ledger events';

  static override examples = [
    '<%= config.bin %> logs',
    '<%= config.bin %> logs --type task_failed --limit 50',
    '<%= config.bin %> logs --follow',
  ];

  static override flags = {
    type: Flags.string({
      description: 'Filter by exact event type',
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
    const types = parseTypeFilter(flags.type);
    const seenIds = new Set<string>();
    let since = flags.since;
    let shouldStop = false;

    const stop = () => {
      shouldStop = true;
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    const emitEvents = (events: LedgerEvent[]) => {
      const ordered = [...events].reverse();
      for (const event of ordered) {
        if (seenIds.has(event.id)) {
          continue;
        }
        seenIds.add(event.id);
        if (!flags.json) {
          this.log(renderEventLine(event));
        }
      }
      const newest = events[0];
      if (newest) {
        since = newest.timestamp;
      }
    };

    try {
      if (!flags.follow) {
        const events = await readLedgerEvents({
          limit: flags.limit,
          ...(types ? { types } : {}),
          ...(flags.since ? { since: flags.since } : {}),
        });

        if (flags.json) {
          this.log(JSON.stringify({ localEvents: events }, null, 2));
          return;
        }

        if (events.length === 0) {
          this.log(chalk.dim('\nNo local runtime events found.\n'));
          return;
        }

        this.log('');
        for (const event of [...events].reverse()) {
          this.log(renderEventLine(event));
        }
        this.log('');
        return;
      }

      this.log('');
      this.log(chalk.bold('📡 Streaming local events'));
      this.log(chalk.dim('Press Ctrl+C to stop.'));
      this.log('');

      while (!shouldStop) {
        const events = await readLedgerEvents({
          limit: flags.limit,
          ...(types ? { types } : {}),
          ...(since ? { since } : {}),
        });
        if (flags.json) {
          this.log(JSON.stringify({ source: 'local', events }, null, 2));
        } else {
          emitEvents(events);
        }
        await new Promise((resolve) => setTimeout(resolve, flags['poll-interval-ms']));
      }
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  }
}

