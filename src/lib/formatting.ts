export function formatNumberWithCommas(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function roundPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value);
}

export function formatStepCount(completed: number, total: number): string {
  return `${completed} / ${total} steps`;
}

export function formatRelativeTimestamp(value: string | Date): string {
  const target = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(target.getTime())) {
    return 'just now';
  }

  const nowMs = Date.now();
  const diffMs = Math.max(0, nowMs - target.getTime());
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < minuteMs) {
    return 'just now';
  }

  if (diffMs < hourMs) {
    const minutes = Math.floor(diffMs / minuteMs);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  if (diffMs < dayMs) {
    const hours = Math.floor(diffMs / hourMs);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  if (diffMs <= 6 * dayMs) {
    const days = Math.floor(diffMs / dayMs);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(target);
}

export function maskApiKeyPreview(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '••••••••';
  }

  if (trimmed.length <= 12) {
    const prefixLength = Math.max(1, Math.min(4, trimmed.length - 4));
    const prefix = trimmed.slice(0, prefixLength);
    const suffix = trimmed.slice(-4);
    const maskLength = Math.max(4, trimmed.length - prefix.length - suffix.length);
    return `${prefix}${'•'.repeat(maskLength)}${suffix}`;
  }

  const prefix = trimmed.slice(0, 8);
  const suffix = trimmed.slice(-4);
  const maskLength = Math.max(8, trimmed.length - prefix.length - suffix.length);
  return `${prefix}${'•'.repeat(maskLength)}${suffix}`;
}
