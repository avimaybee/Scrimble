import * as path from 'node:path';
import {
  CONFIG_FILE,
  PROJECT_FILE,
  scrimbleConfigSchema,
} from '@scrimble/shared';
import {
  CloudApiError,
  formatCloudError,
  getPlanRegistryState,
  getProject,
  listProjects,
  resolveCloudClientConfig,
} from '../api/index.js';
import { type LocalPlanState, savePlanState, writeCurrentChunkFromPlan } from '../local/index.js';
import { writeSecureJson } from '../security.js';

export interface CloudBootstrapSummary {
  projectId: string;
  importedPlan: boolean;
}

export interface CloudBootstrapInput {
  cwd: string;
  scrimbleDir: string;
  enabled: boolean;
  explicitProjectId?: string;
  config: ReturnType<typeof scrimbleConfigSchema.parse>;
  projectData: Record<string, unknown>;
}

export interface CloudBootstrapResult {
  config: ReturnType<typeof scrimbleConfigSchema.parse>;
  projectData: Record<string, unknown>;
  summary?: CloudBootstrapSummary;
  warning?: string;
}

function isLocalPlanState(value: unknown): value is LocalPlanState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { version?: unknown; chunks?: unknown };
  return typeof candidate.version === 'number' && Array.isArray(candidate.chunks);
}

export async function maybeBootstrapFromCloud(input: CloudBootstrapInput): Promise<CloudBootstrapResult> {
  if (!input.enabled) {
    return { config: input.config, projectData: input.projectData };
  }

  try {
    const cloud = await resolveCloudClientConfig(input.cwd);
    if (!cloud.accessToken) {
      return {
        config: input.config,
        projectData: input.projectData,
        warning: 'Cloud bootstrap skipped (no active session). Run `scrimble login` first.',
      };
    }

    let targetProjectId = input.explicitProjectId ?? cloud.projectId;
    let cloudProject: Awaited<ReturnType<typeof getProject>> | undefined;

    try {
      cloudProject = await getProject(cloud, targetProjectId);
    } catch (error) {
      const notFound = error instanceof CloudApiError && error.status === 404;
      if (!notFound || input.explicitProjectId) {
        throw error;
      }

      const cloudProjects = await listProjects(cloud);
      if (cloudProjects.length === 1) {
        const [onlyProject] = cloudProjects;
        if (!onlyProject) {
          throw new Error('Cloud project lookup returned an empty result.');
        }
        targetProjectId = onlyProject.id;
        cloudProject = onlyProject;
      } else if (cloudProjects.length > 1) {
        const projectIds = cloudProjects.map((project) => project.id).join(', ');
        return {
          config: input.config,
          projectData: input.projectData,
          warning: `Cloud bootstrap skipped (multiple projects found: ${projectIds}). Re-run with --project-id <id>.`,
        };
      } else {
        return {
          config: input.config,
          projectData: input.projectData,
          warning: 'Cloud bootstrap skipped (no cloud projects found for this account).',
        };
      }
    }

    if (!cloudProject) {
      return { config: input.config, projectData: input.projectData };
    }

    const config = scrimbleConfigSchema.parse({
      ...input.config,
      projectId: targetProjectId,
    });
    await writeSecureJson(path.join(input.scrimbleDir, CONFIG_FILE), config);

    const projectData = {
      ...input.projectData,
      id: cloudProject.id,
      name: cloudProject.name,
      goal: cloudProject.goal ?? input.projectData['goal'] ?? null,
      status: cloudProject.status,
      bootstrappedFromCloudAt: new Date().toISOString(),
    };
    await writeSecureJson(path.join(input.scrimbleDir, PROJECT_FILE), projectData);

    const registry = await getPlanRegistryState({
      ...cloud,
      projectId: targetProjectId,
    });

    let importedPlan = false;
    if (registry.latest && isLocalPlanState(registry.latest.plan)) {
      await savePlanState(registry.latest.plan, input.cwd);
      await writeCurrentChunkFromPlan(registry.latest.plan, input.cwd);
      importedPlan = true;
    }

    return {
      config,
      projectData,
      summary: {
        projectId: targetProjectId,
        importedPlan,
      },
    };
  } catch (error) {
    return {
      config: input.config,
      projectData: input.projectData,
      warning: `Cloud bootstrap skipped: ${formatCloudError(error)}`,
    };
  }
}
