import chokidar, { type FSWatcher } from 'chokidar';
import * as path from 'node:path';

export type RepoWatchEventType = 'created' | 'changed' | 'deleted';

export interface RepoWatchEvent {
  type: RepoWatchEventType;
  absolutePath: string;
  relativePath: string;
  timestamp: string;
}

export interface RepoWatchOptions {
  cwd?: string;
  includeGlobs?: string[];
  ignoreGlobs?: string[];
  debounceMs?: number;
  onEvent?: (event: RepoWatchEvent) => void;
  onBatch?: (events: RepoWatchEvent[]) => void;
}

const DEFAULT_INCLUDE_GLOBS = ['**/*'];
const DEFAULT_IGNORE_GLOBS = [
  '**/.git/**',
  '**/node_modules/**',
  '**/.turbo/**',
  '**/dist/**',
  '**/.wrangler/**',
];

function toRelativePath(cwd: string, targetPath: string): string {
  return path.relative(cwd, targetPath).replaceAll('\\', '/');
}

function mapWatchEvent(rawEvent: 'add' | 'change' | 'unlink'): RepoWatchEventType {
  if (rawEvent === 'add') return 'created';
  if (rawEvent === 'unlink') return 'deleted';
  return 'changed';
}

export interface RepoWatcher {
  close: () => Promise<void>;
  isReady: () => boolean;
}

export function createRepoWatcher(options: RepoWatchOptions = {}): RepoWatcher {
  const cwd = options.cwd ?? process.cwd();
  const includeGlobs = options.includeGlobs ?? DEFAULT_INCLUDE_GLOBS;
  const ignoreGlobs = options.ignoreGlobs ?? DEFAULT_IGNORE_GLOBS;
  const debounceMs = options.debounceMs ?? 300;

  const bufferedEvents = new Map<string, RepoWatchEvent>();
  let flushTimer: NodeJS.Timeout | undefined;
  let ready = false;

  const flush = (): void => {
    if (bufferedEvents.size === 0) return;
    const events = [...bufferedEvents.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    bufferedEvents.clear();
    options.onBatch?.(events);
  };

  const queueEvent = (event: RepoWatchEvent): void => {
    bufferedEvents.set(`${event.type}:${event.relativePath}`, event);
    options.onEvent?.(event);

    if (flushTimer) {
      clearTimeout(flushTimer);
    }
    flushTimer = setTimeout(flush, debounceMs);
  };

  const watcher: FSWatcher = chokidar.watch(includeGlobs, {
    cwd,
    ignored: ignoreGlobs,
    ignoreInitial: true,
    persistent: true,
  });

  const emit = (eventType: 'add' | 'change' | 'unlink', filePath: string): void => {
    const absolutePath = path.resolve(cwd, filePath);
    queueEvent({
      type: mapWatchEvent(eventType),
      absolutePath,
      relativePath: toRelativePath(cwd, absolutePath),
      timestamp: new Date().toISOString(),
    });
  };

  watcher.on('add', (filePath) => emit('add', filePath));
  watcher.on('change', (filePath) => emit('change', filePath));
  watcher.on('unlink', (filePath) => emit('unlink', filePath));
  watcher.on('ready', () => {
    ready = true;
  });

  return {
    close: async () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
      }
      flush();
      await watcher.close();
    },
    isReady: () => ready,
  };
}
