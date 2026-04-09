export interface TaskItem {
  id: string;
  title: string;
  completed: boolean;
  tags: string[];
}

export function listTasks(items: TaskItem[]): TaskItem[] {
  return items.filter((item) => !item.completed);
}

