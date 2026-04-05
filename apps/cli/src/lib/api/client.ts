import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CONFIG_FILE, PROJECT_FILE, SCRIMBLE_DIR, SESSION_FILE } from '@scrimble/shared';
import { loadScrimbleConfig } from '../config/load-config.js';

export interface CloudClientConfig {
  baseUrl: string;
  projectId: string;
  accessToken?: string;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-_.]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function resolveCloudClientConfig(cwd = process.cwd()): Promise<CloudClientConfig> {
  const scrimbleDir = path.join(cwd, SCRIMBLE_DIR);
  const configPath = path.join(scrimbleDir, CONFIG_FILE);
  const projectPath = path.join(scrimbleDir, PROJECT_FILE);
  const sessionPath = path.join(scrimbleDir, SESSION_FILE);

  await fs.access(configPath);
  const config = await loadScrimbleConfig(cwd);
  const project = await readJson<Record<string, unknown>>(projectPath, {});
  const session = await readJson<Record<string, unknown>>(sessionPath, {});

  const projectIdRaw =
    (typeof config.projectId === 'string' ? config.projectId : undefined) ??
    (typeof project['id'] === 'string' ? project['id'] : undefined) ??
    (typeof project['name'] === 'string' ? project['name'] : undefined) ??
    path.basename(cwd);

  return {
    baseUrl: config.cloudEndpoint ?? 'https://api.scrimble.dev',
    projectId: slug(projectIdRaw),
    ...(typeof session['accessToken'] === 'string' ? { accessToken: session['accessToken'] } : {}),
  };
}

async function requestJson<T>(
  client: CloudClientConfig,
  endpoint: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (client.accessToken) {
    headers.set('authorization', `Bearer ${client.accessToken}`);
  }

  const response = await fetch(`${client.baseUrl}${endpoint}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cloud API request failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<T>;
}

export async function uploadArtifact(
  client: CloudClientConfig,
  type: string,
  payload: unknown,
  metadata?: Record<string, string>,
): Promise<{ key: string; bytes: number }> {
  return requestJson(client, '/v1/artifacts', {
    method: 'POST',
    body: JSON.stringify({
      projectId: client.projectId,
      type,
      payload,
      ...(metadata ? { metadata } : {}),
    }),
  });
}

export async function listArtifacts(
  client: CloudClientConfig,
  type: string,
  limit = 20,
): Promise<Array<{ key: string; size: number; uploaded: string }>> {
  const params = new URLSearchParams({
    projectId: client.projectId,
    type,
    limit: String(limit),
  });
  const result = await requestJson<{ artifacts: Array<{ key: string; size: number; uploaded: string }> }>(
    client,
    `/v1/artifacts/list?${params.toString()}`,
    { method: 'GET' },
  );
  return result.artifacts;
}

export async function readArtifact<T>(client: CloudClientConfig, key: string): Promise<T> {
  const params = new URLSearchParams({ key });
  const result = await requestJson<{ artifact: T }>(client, `/v1/artifacts?${params.toString()}`, {
    method: 'GET',
  });
  return result.artifact;
}

export async function startReplan(
  client: CloudClientConfig,
  payload: { updateRequest: string; currentPlanSummary?: string; aiConfig?: Record<string, unknown> },
): Promise<{ instanceId: string; status: string }> {
  return requestJson(client, '/v1/replan/start', {
    method: 'POST',
    body: JSON.stringify({
      projectId: client.projectId,
      updateRequest: payload.updateRequest,
      ...(payload.currentPlanSummary ? { currentPlanSummary: payload.currentPlanSummary } : {}),
      ...(payload.aiConfig ? { aiConfig: payload.aiConfig } : {}),
    }),
  });
}

export async function getReplanStatus(
  client: CloudClientConfig,
  instanceId: string,
): Promise<Record<string, unknown>> {
  return requestJson(client, `/v1/replan/${instanceId}`, { method: 'GET' });
}

export async function getGenerationStatus(
  client: CloudClientConfig,
  instanceId: string,
): Promise<Record<string, unknown>> {
  return requestJson(client, `/v1/generation/${instanceId}`, { method: 'GET' });
}
