import type { Bindings } from './types';

export interface UserProfile {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string;
}

export interface UsageStats {
  projects_count: number;
  generations_count: number;
}

export async function getUserProfile(env: Bindings, userId: string): Promise<UserProfile | null> {
  const profile = (await env.DB.prepare('SELECT id, name, email, created_at FROM profiles WHERE id = ?')
    .bind(userId)
    .first()) as UserProfile | null;

  return profile;
}

export async function ensureUserProfile(env: Bindings, userId: string, email?: string): Promise<UserProfile> {
  const existing = await getUserProfile(env, userId);
  if (existing) {
    if (email && existing.email !== email) {
      await env.DB.prepare('UPDATE profiles SET email = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .bind(email, userId)
        .run();
      return { ...existing, email };
    }
    return existing;
  }

  // Create new profile if not exists (lazy creation)
  await env.DB.prepare('INSERT INTO profiles (id, name, email) VALUES (?, ?, ?)')
    .bind(userId, email?.split('@')[0] || 'Builder', email || null)
    .run();

  const profile = await getUserProfile(env, userId);
  if (!profile) throw new Error('Failed to create profile');
  return profile;
}

export async function updateUserProfile(env: Bindings, userId: string, data: { displayName?: string; email?: string }): Promise<UserProfile> {
  const sets: string[] = [];
  const bindings: any[] = [];

  if (data.displayName !== undefined) {
    sets.push('name = ?');
    bindings.push(data.displayName || null);
  }

  if (data.email !== undefined) {
    sets.push('email = ?');
    bindings.push(data.email || null);
  }

  if (sets.length > 0) {
    sets.push('updated_at = datetime(\'now\')');
    const query = `UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`;
    bindings.push(userId);
    await env.DB.prepare(query).bind(...bindings).run();
  }

  const profile = await getUserProfile(env, userId);
  if (!profile) throw new Error('Profile not found');
  return profile;
}

export async function getUserUsageStats(env: Bindings, userId: string): Promise<UsageStats> {
  const [projectsRes, agentRunsRes] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) as count FROM projects WHERE user_id = ?').bind(userId),
    env.DB.prepare('SELECT COUNT(*) as count FROM agent_runs ar JOIN projects p ON ar.project_id = p.id WHERE p.user_id = ?').bind(userId),
  ]);

  return {
    projects_count: (projectsRes.results[0] as { count: number }).count,
    generations_count: (agentRunsRes.results[0] as { count: number }).count,
  };
}
