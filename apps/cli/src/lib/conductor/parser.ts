/**
 * Conductor artifact parser.
 * Parses conductor/ directory structure to extract tracks, plans, and tasks.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  CONDUCTOR_DIR,
  CONDUCTOR_PRODUCT_FILE,
  CONDUCTOR_GUIDELINES_FILE,
  CONDUCTOR_TECH_STACK_FILE,
  CONDUCTOR_WORKFLOW_FILE,
  CONDUCTOR_TRACKS_FILE,
  CONDUCTOR_TRACKS_DIR,
} from '@scrimble/shared';
import type {
  ConductorTrack,
  ConductorTrackStatus,
  ConductorTask,
  ConductorTaskStatus,
  ConductorSubstep,
  ConductorPhase,
  ConductorPlan,
  ConductorWorkspace,
} from '@scrimble/shared';

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/** Generate a deterministic ID from text. */
function generateTaskId(phase: string, title: string): string {
  const hash = createHash('sha256')
    .update(`${phase}:${title}`)
    .digest('hex')
    .slice(0, 8);
  return `task-${hash}`;
}

/** Parse track status from tracks.md checkbox syntax. */
function parseTrackStatus(line: string): ConductorTrackStatus {
  if (line.includes('[x]') || line.includes('[X]')) return 'completed';
  if (line.includes('[ ]')) return 'pending';
  if (line.includes('[~]')) return 'active';
  if (line.includes('[!]')) return 'blocked';
  return 'pending';
}

/** Parse task status from plan.md checkbox syntax. */
function parseTaskStatus(line: string): ConductorTaskStatus {
  if (line.includes('[x]') || line.includes('[X]')) return 'completed';
  if (line.includes('[~]')) return 'in_progress';
  if (line.includes('[-]')) return 'skipped';
  return 'pending';
}

/** Check if a task title indicates manual verification. */
function isManualVerificationTask(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return (
    lowerTitle.includes('manual verification') ||
    lowerTitle.includes('manual review') ||
    lowerTitle.includes('human review') ||
    lowerTitle.includes('verify manually') ||
    lowerTitle.includes('[manual]')
  );
}

/** Parse conductor/tracks.md to extract track list. */
export async function parseTracks(conductorDir: string): Promise<ConductorTrack[]> {
  const tracksPath = path.join(conductorDir, CONDUCTOR_TRACKS_FILE);
  const content = await readFileIfExists(tracksPath);
  if (!content) return [];

  const tracks: ConductorTrack[] = [];
  const lines = content.split('\n');
  const tracksDir = path.join(conductorDir, CONDUCTOR_TRACKS_DIR);

  for (const line of lines) {
    // Match lines like: - [x] Track Title (track-id)
    // Or: - [ ] **Track Title** `track-id`
    const trackMatch = line.match(
      /^\s*[-*]\s*\[[ xX~!]\]\s*(?:\*\*)?(.+?)(?:\*\*)?\s*(?:\(([^)]+)\)|`([^`]+)`)?$/,
    );
    if (!trackMatch) continue;

    const title = trackMatch[1]?.trim() ?? '';
    // Extract ID from parentheses, backticks, or generate from title
    let id = trackMatch[2]?.trim() || trackMatch[3]?.trim();
    if (!id) {
      id = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50);
    }

    const status = parseTrackStatus(line);
    const trackDir = path.join(tracksDir, id);

    const specExists = await fileExists(path.join(trackDir, 'spec.md'));
    const planExists = await fileExists(path.join(trackDir, 'plan.md'));
    const metaExists = await fileExists(path.join(trackDir, 'metadata.json'));

    tracks.push({
      id,
      title,
      status,
      ...(specExists ? { specPath: path.join(trackDir, 'spec.md') } : {}),
      ...(planExists ? { planPath: path.join(trackDir, 'plan.md') } : {}),
      ...(metaExists ? { metadataPath: path.join(trackDir, 'metadata.json') } : {}),
    });
  }

  return tracks;
}

/** Parse conductor/tracks/<id>/plan.md to extract phases and tasks. */
export async function parsePlan(planPath: string, trackId: string): Promise<ConductorPlan> {
  const content = await readFileIfExists(planPath);
  if (!content) {
    return { trackId, phases: [], tasks: [] };
  }

  const phases: ConductorPhase[] = [];
  const allTasks: ConductorTask[] = [];
  let currentPhase: ConductorPhase | null = null;
  let currentTask: ConductorTask | null = null;
  let currentTaskLines: string[] = [];

  const lines = content.split('\n');

  const finalizeTask = () => {
    if (currentTask && currentPhase) {
      currentTask.rawMarkdown = currentTaskLines.join('\n');
      currentPhase.tasks.push(currentTask);
      allTasks.push(currentTask);
    }
    currentTask = null;
    currentTaskLines = [];
  };

  const finalizePhase = () => {
    finalizeTask();
    if (currentPhase && currentPhase.tasks.length > 0) {
      phases.push(currentPhase);
    }
    currentPhase = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Phase heading (## Phase Title or # Phase Title)
    const phaseMatch = line.match(/^#{1,2}\s+(.+)$/);
    if (phaseMatch && !line.match(/^#{3,}/)) {
      finalizePhase();
      const phaseTitle = phaseMatch[1]?.trim() ?? '';
      currentPhase = {
        id: phaseTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        title: phaseTitle,
        tasks: [],
      };
      continue;
    }

    // Task line: - [ ] Task: Description or - [ ] **Task:** Description
    const taskMatch = line.match(
      /^\s*[-*]\s*\[[ xX~-]\]\s*(?:\*\*)?(?:Task:\s*)?(.+?)(?:\*\*)?$/,
    );
    if (taskMatch && !line.match(/^\s{4,}/)) {
      finalizeTask();
      const taskTitle = taskMatch[1]?.trim() ?? '';
      const phaseTitle = currentPhase?.title;
      currentTask = {
        id: generateTaskId(currentPhase?.id ?? 'default', taskTitle),
        title: taskTitle,
        status: parseTaskStatus(line),
        ...(phaseTitle ? { phase: phaseTitle } : {}),
        substeps: [],
        isManualVerification: isManualVerificationTask(taskTitle),
        rawMarkdown: '',
      };
      currentTaskLines = [line];
      continue;
    }

    // Substep line: indented checkbox
    const substepMatch = line.match(/^\s{2,}[-*]\s*\[[ xX]\]\s*(.+)$/);
    if (substepMatch && currentTask) {
      const text = substepMatch[1]?.trim() ?? '';
      const completed = line.includes('[x]') || line.includes('[X]');
      currentTask.substeps.push({ text, completed });
      currentTaskLines.push(line);
      continue;
    }

    // Continuation of current task (non-empty, indented content)
    if (currentTask && line.trim() && (line.startsWith('  ') || line.startsWith('\t'))) {
      currentTaskLines.push(line);
    }
  }

  // Finalize any remaining task/phase
  finalizePhase();

  return { trackId, phases, tasks: allTasks };
}

/** Load the complete Conductor workspace state. */
export async function loadConductorWorkspace(
  cwd: string = process.cwd(),
): Promise<ConductorWorkspace> {
  const conductorPath = path.join(cwd, CONDUCTOR_DIR);
  const exists = await fileExists(conductorPath);

  if (!exists) {
    return { exists: false, tracks: [] };
  }

  const [productExists, guidelinesExists, techStackExists, workflowExists, tracksFileExists] =
    await Promise.all([
      fileExists(path.join(conductorPath, CONDUCTOR_PRODUCT_FILE)),
      fileExists(path.join(conductorPath, CONDUCTOR_GUIDELINES_FILE)),
      fileExists(path.join(conductorPath, CONDUCTOR_TECH_STACK_FILE)),
      fileExists(path.join(conductorPath, CONDUCTOR_WORKFLOW_FILE)),
      fileExists(path.join(conductorPath, CONDUCTOR_TRACKS_FILE)),
    ]);

  const tracks = await parseTracks(conductorPath);

  return {
    exists: true,
    ...(productExists ? { productPath: path.join(conductorPath, CONDUCTOR_PRODUCT_FILE) } : {}),
    ...(guidelinesExists
      ? { guidelinesPath: path.join(conductorPath, CONDUCTOR_GUIDELINES_FILE) }
      : {}),
    ...(techStackExists
      ? { techStackPath: path.join(conductorPath, CONDUCTOR_TECH_STACK_FILE) }
      : {}),
    ...(workflowExists ? { workflowPath: path.join(conductorPath, CONDUCTOR_WORKFLOW_FILE) } : {}),
    ...(tracksFileExists ? { tracksPath: path.join(conductorPath, CONDUCTOR_TRACKS_FILE) } : {}),
    tracks,
  };
}

/** Get the active or next pending track. */
export function getActiveTrack(workspace: ConductorWorkspace): ConductorTrack | undefined {
  // First look for explicitly active track
  const active = workspace.tracks.find((t) => t.status === 'active');
  if (active) return active;

  // Fall back to first pending track
  return workspace.tracks.find((t) => t.status === 'pending');
}

/** Get the next pending task in a plan. */
export function getNextTask(plan: ConductorPlan): ConductorTask | undefined {
  // First look for in_progress task
  const inProgress = plan.tasks.find((t) => t.status === 'in_progress');
  if (inProgress) return inProgress;

  // Fall back to first pending task
  return plan.tasks.find((t) => t.status === 'pending');
}

/** Get completion stats for a plan. */
export function getPlanStats(plan: ConductorPlan): {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  skipped: number;
  manualCheckpoints: number;
} {
  const tasks = plan.tasks;
  return {
    total: tasks.length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    skipped: tasks.filter((t) => t.status === 'skipped').length,
    manualCheckpoints: tasks.filter((t) => t.isManualVerification).length,
  };
}

/** Update task checkbox in plan.md file. */
export async function updateTaskStatus(
  planPath: string,
  taskId: string,
  newStatus: ConductorTaskStatus,
): Promise<void> {
  const content = await readFileIfExists(planPath);
  if (!content) {
    throw new Error(`Plan file not found: ${planPath}`);
  }

  // Re-parse to find the exact task
  const trackId = path.basename(path.dirname(planPath));
  const plan = await parsePlan(planPath, trackId);
  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  // Find and replace the checkbox in the raw content
  const statusChar = {
    completed: 'x',
    in_progress: '~',
    skipped: '-',
    pending: ' ',
  }[newStatus];

  const lines = content.split('\n');
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // Match task line by title (approximate match)
    if (
      line.includes(task.title.slice(0, 30)) &&
      line.match(/^\s*[-*]\s*\[[ xX~-]\]/)
    ) {
      lines[i] = line.replace(/\[[ xX~-]\]/, `[${statusChar}]`);
      found = true;
      break;
    }
  }

  if (!found) {
    throw new Error(`Could not find task line in plan for: ${task.title}`);
  }

  await fs.writeFile(planPath, lines.join('\n'), 'utf8');
}
