/**
 * Client-Side Logger
 *
 * Provides level-gated logging for frontend code.
 * Mirrors the server logger API for consistency.
 *
 * Log levels (in order of severity):
 *   debug < info < warn < error
 *
 * In production builds, only warn and error are shown by default.
 * Set localStorage.setItem('LOG_LEVEL', 'debug') to see all logs.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getLogLevel(): LogLevel {
  // Check localStorage for override
  if (typeof window !== 'undefined' && window.localStorage) {
    const stored = localStorage.getItem('LOG_LEVEL')?.toLowerCase();
    if (stored && stored in LOG_LEVEL_PRIORITY) {
      return stored as LogLevel;
    }
  }

  // Default to 'warn' in production, 'debug' in development
  // Use try/catch for Vite env access safety
  try {
    // @ts-expect-error Vite-specific import.meta.env
    if (import.meta.env?.DEV) {
      return 'debug';
    }
  } catch {
    // Not in Vite context
  }

  return 'warn';
}

function shouldLog(level: LogLevel): boolean {
  const threshold = getLogLevel();
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[threshold];
}

export interface LogContext {
  [key: string]: unknown;
}

function formatLog(tag: string, message?: string, context?: LogContext): string {
  const parts = [`[${tag}]`, message || ''].filter(Boolean);

  if (context && Object.keys(context).length > 0) {
    return `${parts.join(' ')} ${JSON.stringify(context)}`;
  }

  return parts.join(' ');
}

/**
 * Log a debug message. Only visible when LOG_LEVEL is 'debug'.
 */
export function debug(tag: string, message?: string | LogContext, context?: LogContext): void {
  if (!shouldLog('debug')) return;

  let finalMessage: string | undefined;
  let finalContext: LogContext | undefined;

  if (typeof message === 'object' && message !== null) {
    finalContext = message;
  } else if (typeof message === 'string') {
    finalMessage = message;
    finalContext = context;
  }

  console.log(formatLog(tag, finalMessage, finalContext));
}

/**
 * Log an info message. Visible when LOG_LEVEL is 'info' or lower.
 */
export function info(tag: string, message?: string | LogContext, context?: LogContext): void {
  if (!shouldLog('info')) return;

  let finalMessage: string | undefined;
  let finalContext: LogContext | undefined;

  if (typeof message === 'object' && message !== null) {
    finalContext = message;
  } else if (typeof message === 'string') {
    finalMessage = message;
    finalContext = context;
  }

  console.log(formatLog(tag, finalMessage, finalContext));
}

/**
 * Log a warning. Always visible in production.
 */
export function warn(tag: string, message?: string | LogContext, context?: LogContext): void {
  if (!shouldLog('warn')) return;

  let finalMessage: string | undefined;
  let finalContext: LogContext | undefined;

  if (typeof message === 'object' && message !== null) {
    finalContext = message;
  } else if (typeof message === 'string') {
    finalMessage = message;
    finalContext = context;
  }

  console.warn(formatLog(tag, finalMessage, finalContext));
}

/**
 * Log an error. Always visible.
 */
export function error(tag: string, message?: string | LogContext, context?: LogContext): void {
  if (!shouldLog('error')) return;

  let finalMessage: string | undefined;
  let finalContext: LogContext | undefined;

  if (typeof message === 'object' && message !== null) {
    finalContext = message;
  } else if (typeof message === 'string') {
    finalMessage = message;
    finalContext = context;
  }

  console.error(formatLog(tag, finalMessage, finalContext));
}
