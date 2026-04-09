import type { TaskItem } from './tasks.js';

export function filterByTag(items: TaskItem[], tag: string): TaskItem[] {
  const normalized = tag.trim().toLowerCase();
  return items.filter((item) => item.tags.some((entry) => entry.toLowerCase() === normalized));
}

