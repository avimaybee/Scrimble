interface CloudApiErrorLike extends Error {
  parseBody?: <T>() => T | undefined;
}

function isCloudApiErrorLike(error: unknown): error is CloudApiErrorLike {
  return error instanceof Error && typeof (error as CloudApiErrorLike).parseBody === 'function';
}

export function formatCloudError(error: unknown): string {
  if (isCloudApiErrorLike(error)) {
    const parsed = error.parseBody?.<{
      error?: unknown;
      message?: unknown;
      issues?: Array<{ message?: unknown }>;
    }>();

    if (parsed) {
      const errorMessage = typeof parsed.error === 'string' ? parsed.error : undefined;
      const message = typeof parsed.message === 'string' ? parsed.message : undefined;
      const details = Array.isArray(parsed.issues)
        ? parsed.issues
            .map((issue) => (typeof issue.message === 'string' ? issue.message : undefined))
            .filter((value): value is string => Boolean(value))
        : [];

      if (errorMessage && details.length > 0) {
        return `${errorMessage} ${details.join(' ')}`;
      }

      if (errorMessage && message && !message.includes(errorMessage)) {
        return `${errorMessage}: ${message}`;
      }

      if (errorMessage) {
        return errorMessage;
      }

      if (message) {
        return message;
      }
    }

    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
}
