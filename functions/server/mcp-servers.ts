import { z } from 'zod';
import { decrypt, encrypt } from '../utils/crypto';
import type { Bindings } from './types';

export const MCP_SERVER_TYPES = ['brave-search', 'github', 'context7', 'custom'] as const;

export type MCPServerType = (typeof MCP_SERVER_TYPES)[number];

const braveSearchConfigSchema = z.object({
  apiKey: z.string().trim().min(1),
});

const githubConfigSchema = z.object({
  token: z.string().trim().min(1),
});

const context7ConfigSchema = z.object({
  apiKey: z.string().trim().min(1),
});

const customMCPConfigSchema = z.object({
  baseUrl: z.string().trim().url(),
});

const mcpConfigSchemas = {
  'brave-search': braveSearchConfigSchema,
  github: githubConfigSchema,
  context7: context7ConfigSchema,
  custom: customMCPConfigSchema,
} as const;

export const mcpServerPayloadSchema = z.discriminatedUnion('serverType', [
  z.object({
    serverType: z.literal('brave-search'),
    name: z.string().trim().optional(),
    config: braveSearchConfigSchema,
  }),
  z.object({
    serverType: z.literal('github'),
    name: z.string().trim().optional(),
    config: githubConfigSchema,
  }),
  z.object({
    serverType: z.literal('context7'),
    name: z.string().trim().optional(),
    config: context7ConfigSchema,
  }),
  z.object({
    serverType: z.literal('custom'),
    name: z.string().trim().min(1),
    config: customMCPConfigSchema,
  }),
]);

export type MCPServerPayload = z.infer<typeof mcpServerPayloadSchema>;

type MCPConfigByServerType = {
  'brave-search': z.infer<typeof braveSearchConfigSchema>;
  github: z.infer<typeof githubConfigSchema>;
  context7: z.infer<typeof context7ConfigSchema>;
  custom: z.infer<typeof customMCPConfigSchema>;
};

type RawMCPServerRow = Record<string, unknown>;

export type MaskedMCPServer = {
  id: string;
  user_id: string;
  server_type: MCPServerType;
  name: string;
  masked_config: string;
  is_active: boolean;
  created_at: string;
};

export type ActiveMCPServer<T extends MCPServerType = MCPServerType> = {
  id: string;
  user_id: string;
  server_type: T;
  name: string;
  config: MCPConfigByServerType[T];
  is_active: boolean;
  created_at: string;
};

const MCP_SERVER_NAMES: Record<MCPServerType, string> = {
  'brave-search': 'Brave Search',
  github: 'GitHub',
  context7: 'Context7',
  custom: 'Custom MCP',
};

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function asMCPServerType(value: unknown): MCPServerType | null {
  if (typeof value !== 'string') {
    return null;
  }

  return MCP_SERVER_TYPES.includes(value as MCPServerType) ? (value as MCPServerType) : null;
}

function maskSecret(secret: string) {
  const trimmed = secret.trim();
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

export function getMCPServerDisplayName(serverType: MCPServerType, providedName?: string) {
  if (serverType === 'custom') {
    return providedName?.trim() || MCP_SERVER_NAMES.custom;
  }

  return MCP_SERVER_NAMES[serverType];
}

export function maskMCPServerConfig<T extends MCPServerType>(
  serverType: T,
  config: MCPConfigByServerType[T],
) {
  if (serverType === 'github' && 'token' in config) {
    return `Read-only token ${maskSecret(config.token)}`;
  }

  if (serverType === 'custom' && 'baseUrl' in config) {
    return config.baseUrl;
  }

  if ('apiKey' in config) {
    return `API key ${maskSecret(config.apiKey)}`;
  }

  return 'Encrypted config saved';
}

async function decryptMCPConfig<T extends MCPServerType>(
  serverType: T,
  configEnc: string,
  encryptionKey: string,
): Promise<MCPConfigByServerType[T]> {
  const decrypted = await decrypt(configEnc, encryptionKey);
  const parsed = JSON.parse(decrypted) as unknown;
  return mcpConfigSchemas[serverType].parse(parsed) as MCPConfigByServerType[T];
}

export async function listUserMCPServers(env: Bindings, userId: string): Promise<MaskedMCPServer[]> {
  const rows = await env.DB.prepare(`
    SELECT id, user_id, server_type, name, config_enc, is_active, created_at
    FROM mcp_servers
    WHERE user_id = ?
    ORDER BY is_active DESC, created_at ASC
  `)
    .bind(userId)
    .all();

  return Promise.all(
    (rows.results as RawMCPServerRow[]).map(async (row) => {
      const serverType = asMCPServerType(row.server_type);
      if (!serverType) {
        return null;
      }

      const baseRecord = {
        id: asText(row.id),
        user_id: asText(row.user_id),
        server_type: serverType,
        name: getMCPServerDisplayName(serverType, asText(row.name)),
        is_active: toBoolean(row.is_active),
        created_at: asText(row.created_at, new Date().toISOString()),
      };

      try {
        const config = await decryptMCPConfig(serverType, asText(row.config_enc), env.ENCRYPTION_KEY);
        return {
          ...baseRecord,
          masked_config: maskMCPServerConfig(serverType, config),
        } satisfies MaskedMCPServer;
      } catch {
        return {
          ...baseRecord,
          masked_config: serverType === 'custom' ? 'Saved endpoint' : 'Encrypted config saved',
        } satisfies MaskedMCPServer;
      }
    }),
  ).then((servers) => servers.filter((server): server is MaskedMCPServer => Boolean(server)));
}

export async function getConnectedResearchTools(env: Bindings, userId: string) {
  const rows = await env.DB.prepare(`
    SELECT server_type
    FROM mcp_servers
    WHERE user_id = ? AND is_active = 1
  `)
    .bind(userId)
    .all();

  const connected = new Set(
    (rows.results as RawMCPServerRow[])
      .map((row) => asMCPServerType(row.server_type))
      .filter((serverType): serverType is MCPServerType => Boolean(serverType)),
  );

  return {
    has_brave_search: connected.has('brave-search'),
    has_github_token: connected.has('github'),
    has_context7: connected.has('context7'),
    has_custom_mcp: connected.has('custom'),
  };
}

export async function getActiveMCPServer<T extends MCPServerType>(
  env: Bindings,
  userId: string,
  serverType: T,
): Promise<ActiveMCPServer<T> | null> {
  const row = await env.DB.prepare(`
    SELECT id, user_id, server_type, name, config_enc, is_active, created_at
    FROM mcp_servers
    WHERE user_id = ? AND server_type = ? AND is_active = 1
    ORDER BY created_at ASC
    LIMIT 1
  `)
    .bind(userId, serverType)
    .first();

  if (!row) {
    return null;
  }

  const config = await decryptMCPConfig(serverType, asText(row.config_enc), env.ENCRYPTION_KEY);

  return {
    id: asText(row.id),
    user_id: asText(row.user_id),
    server_type: serverType,
    name: getMCPServerDisplayName(serverType, asText(row.name)),
    config,
    is_active: toBoolean(row.is_active),
    created_at: asText(row.created_at, new Date().toISOString()),
  };
}

export async function upsertUserMCPServer(
  env: Bindings,
  userId: string,
  payload: MCPServerPayload,
): Promise<{ id: string }> {
  const existing = await env.DB.prepare(`
    SELECT id
    FROM mcp_servers
    WHERE user_id = ? AND server_type = ?
    ORDER BY created_at ASC
    LIMIT 1
  `)
    .bind(userId, payload.serverType)
    .first();

  const id = asText(existing?.id) || crypto.randomUUID();
  const name = getMCPServerDisplayName(payload.serverType, payload.name);
  const encryptedConfig = await encrypt(JSON.stringify(payload.config), env.ENCRYPTION_KEY);

  if (existing?.id) {
    await env.DB.prepare(`
      UPDATE mcp_servers
      SET name = ?, config_enc = ?, is_active = 1
      WHERE id = ? AND user_id = ?
    `)
      .bind(name, encryptedConfig, id, userId)
      .run();

    return { id };
  }

  await env.DB.prepare(`
    INSERT INTO mcp_servers (id, user_id, server_type, name, config_enc, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `)
    .bind(id, userId, payload.serverType, name, encryptedConfig)
    .run();

  return { id };
}
