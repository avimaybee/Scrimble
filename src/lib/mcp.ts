import { auth } from './firebase';

export type MCPServerType = 'brave-search' | 'github' | 'context7' | 'custom';

export interface MCPServer {
  id: string;
  user_id: string;
  server_type: MCPServerType;
  name: string;
  masked_config: string;
  is_active: boolean;
  created_at: string;
}

export type SaveMCPServerPayload =
  | {
      serverType: 'brave-search';
      name?: string;
      config: { apiKey: string };
    }
  | {
      serverType: 'github';
      name?: string;
      config: { token: string };
    }
  | {
      serverType: 'context7';
      name?: string;
      config: { apiKey: string };
    }
  | {
      serverType: 'custom';
      name: string;
      config: { baseUrl: string };
    };

async function getAuthToken() {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }

  return user.getIdToken();
}

async function fetchMCPAPI(path: string, options: RequestInit = {}) {
  const token = await getAuthToken();

  return fetch(`/api/settings/mcp-servers${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

export async function getMCPServers(): Promise<MCPServer[]> {
  const user = auth.currentUser;
  if (!user) {
    return [];
  }

  const token = await user.getIdToken();
  const response = await fetch('/api/settings/mcp-servers', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return [];
  }

  return (await response.json()) as MCPServer[];
}

export async function saveMCPServer(payload: SaveMCPServerPayload) {
  const response = await fetchMCPAPI('', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorBody?.error || 'Failed to connect research tool.');
  }

  return response.json();
}

export async function toggleMCPServer(serverId: string) {
  const response = await fetchMCPAPI(`/${serverId}`, {
    method: 'PATCH',
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorBody?.error || 'Failed to update research tool.');
  }

  return response.json() as Promise<{ success: boolean; is_active: boolean }>;
}

export async function deleteMCPServer(serverId: string) {
  const response = await fetchMCPAPI(`/${serverId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorBody?.error || 'Failed to remove research tool.');
  }

  return response.json();
}
