/**
 * Structured Logger
 *
 * Provides level-gated structured logging for runtime paths.
 * Replaces ad-hoc console.log/warn/error with a consistent contract.
 *
 * Log levels (in order of severity):
 *   debug < info < warn < error
 *
 * Configure via LOG_LEVEL environment variable (defaults to 'info' in production).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_LOG_LEVEL: LogLevel = 'info';

let configuredLevel: LogLevel | null = null;

function getLogLevel(env?: { LOG_LEVEL?: string; ENVIRONMENT?: string }): LogLevel {
  if (configuredLevel) {
    return configuredLevel;
  }

  const envLevel = env?.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVEL_PRIORITY) {
    return envLevel as LogLevel;
  }

  // Default to 'debug' in development, 'info' in production
  if (env?.ENVIRONMENT === 'development') {
    return 'debug';
  }

  return DEFAULT_LOG_LEVEL;
}

export function setLogLevel(level: LogLevel): void {
  configuredLevel = level;
}

export function resetLogLevel(): void {
  configuredLevel = null;
}

function shouldLog(level: LogLevel, env?: { LOG_LEVEL?: string; ENVIRONMENT?: string }): boolean {
  const threshold = getLogLevel(env);
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[threshold];
}

export interface LogContext {
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  tag: string;
  timestamp: string;
  message?: string;
  context?: LogContext;
}

function formatLogEntry(entry: LogEntry): string {
  const parts = [
    `[${entry.tag}]`,
    entry.message || '',
  ].filter(Boolean);

  if (entry.context && Object.keys(entry.context).length > 0) {
    return `${parts.join(' ')} ${JSON.stringify(entry.context)}`;
  }

  return parts.join(' ');
}

function emitLog(entry: LogEntry): void {
  const formatted = formatLogEntry(entry);

  switch (entry.level) {
    case 'debug':
    case 'info':
      console.log(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    case 'error':
      console.error(formatted);
      break;
  }
}

/**
 * Log a message with structured context.
 *
 * @param level - Log severity level
 * @param tag - Semantic tag for categorization (e.g., 'ai-retry', 'checkpoint-save')
 * @param message - Optional human-readable message
 * @param context - Optional structured context data
 * @param env - Optional environment bindings for log level resolution
 */
export function log(
  level: LogLevel,
  tag: string,
  message?: string | LogContext,
  context?: LogContext,
  env?: { LOG_LEVEL?: string; ENVIRONMENT?: string },
): void {
  if (!shouldLog(level, env)) {
    return;
  }

  // Allow calling log(level, tag, context) without message
  let finalMessage: string | undefined;
  let finalContext: LogContext | undefined;

  if (typeof message === 'object' && message !== null) {
    finalContext = message;
  } else if (typeof message === 'string') {
    finalMessage = message;
    finalContext = context;
  }

  const entry: LogEntry = {
    level,
    tag,
    timestamp: new Date().toISOString(),
    message: finalMessage,
    context: finalContext,
  };

  emitLog(entry);
}

// Convenience helpers

export function debug(tag: string, message?: string | LogContext, context?: LogContext, env?: { LOG_LEVEL?: string; ENVIRONMENT?: string }): void {
  log('debug', tag, message, context, env);
}

export function info(tag: string, message?: string | LogContext, context?: LogContext, env?: { LOG_LEVEL?: string; ENVIRONMENT?: string }): void {
  log('info', tag, message, context, env);
}

export function warn(tag: string, message?: string | LogContext, context?: LogContext, env?: { LOG_LEVEL?: string; ENVIRONMENT?: string }): void {
  log('warn', tag, message, context, env);
}

export function error(tag: string, message?: string | LogContext, context?: LogContext, env?: { LOG_LEVEL?: string; ENVIRONMENT?: string }): void {
  log('error', tag, message, context, env);
}

/**
 * Create a logger bound to specific environment bindings.
 * Useful for request-scoped logging where env is always available.
 */
export function createLogger(env: { LOG_LEVEL?: string; ENVIRONMENT?: string }) {
  return {
    debug: (tag: string, message?: string | LogContext, context?: LogContext) => debug(tag, message, context, env),
    info: (tag: string, message?: string | LogContext, context?: LogContext) => info(tag, message, context, env),
    warn: (tag: string, message?: string | LogContext, context?: LogContext) => warn(tag, message, context, env),
    error: (tag: string, message?: string | LogContext, context?: LogContext) => error(tag, message, context, env),
  };
}
