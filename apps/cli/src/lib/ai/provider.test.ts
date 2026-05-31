import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PROVIDER_VALIDATION_CACHE_FILE,
  SCRIMBLE_DIR,
  type ProfileValidationCacheEntry,
  type ScrimbleConfig,
} from '@scrimble/shared';
import { buildProviderProfile, upsertProfile, buildDefaultScrimbleConfig } from './profiles.js';
import { evaluateProfileHealth, hasValidActiveProfile, refreshProfileHealth } from './provider.js';

describe('provider health resolution', () => {
  let cwd: string;
  let previousOpenAi: string | undefined;
  let previousCopilot: string | undefined;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'scrimble-provider-health-'));
    await fs.mkdir(path.join(cwd, SCRIMBLE_DIR), { recursive: true });
    previousOpenAi = process.env['OPENAI_API_KEY'];
    previousCopilot = process.env['COPILOT_GITHUB_TOKEN'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['COPILOT_GITHUB_TOKEN'];
  });

  afterEach(async () => {
    if (previousOpenAi === undefined) {
      delete process.env['OPENAI_API_KEY'];
    } else {
      process.env['OPENAI_API_KEY'] = previousOpenAi;
    }
    if (previousCopilot === undefined) {
      delete process.env['COPILOT_GITHUB_TOKEN'];
    } else {
      process.env['COPILOT_GITHUB_TOKEN'] = previousCopilot;
    }
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('marks BYOK profile unusable when auth is missing and writes cache', async () => {
    const profile = buildProviderProfile({
      id: 'openai-profile',
      provider: 'openai',
      modelStrategy: 'explicit',
      model: 'gpt-4o',
      authStrategy: 'api_key',
      apiKey: '${OPENAI_API_KEY}',
      interactive: false,
    });

    const health = evaluateProfileHealth(profile, { cwd });
    expect(health.usableNow).toBe(false);
    expect(health.status).toBe('missing');
    expect(health.capabilitySource).toBe('fallback');
    expect(health.usabilityIssues.length).toBeGreaterThan(0);

    const cachePath = path.join(cwd, SCRIMBLE_DIR, PROVIDER_VALIDATION_CACHE_FILE);
    const cache = JSON.parse(await fs.readFile(cachePath, 'utf8')) as { profiles: Record<string, unknown> };
    expect(cache.profiles[profile.id]).toBeDefined();
  });

  it('marks profile usable when env auth resolves and validates active profile', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-openai';
    const profile = buildProviderProfile({
      id: 'openai-profile',
      provider: 'openai',
      modelStrategy: 'explicit',
      model: 'gpt-4o',
      authStrategy: 'api_key',
      apiKey: '${OPENAI_API_KEY}',
      interactive: false,
    });
    const health = evaluateProfileHealth(profile, { cwd });
    expect(health.usableNow).toBe(true);
    expect(health.authSource).toBe('env:OPENAI_API_KEY');

    let config: ScrimbleConfig = buildDefaultScrimbleConfig('guide', 'openai');
    config = upsertProfile(config, profile, true);
    expect(hasValidActiveProfile(config, { cwd })).toBe(true);
  });

  it('refreshes stale cached capability data to fresh fallback for BYOK profiles', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-openai';
    const profile = buildProviderProfile({
      id: 'openai-profile',
      provider: 'openai',
      modelStrategy: 'explicit',
      model: 'gpt-4o',
      authStrategy: 'api_key',
      apiKey: '${OPENAI_API_KEY}',
      interactive: false,
    });
    const staleAt = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000)).toISOString();
    const staleEntry: ProfileValidationCacheEntry = {
      profileId: profile.id,
      provider: profile.provider,
      authStrategy: profile.auth.strategy,
      authStatus: 'ready',
      authSource: 'env:OPENAI_API_KEY',
      modelStrategy: profile.modelStrategy,
      model: profile.model,
      modelAvailability: 'available',
      capability: {
        source: 'cached',
        availableModels: ['stale-model'],
        validatedAt: staleAt,
        stale: true,
      },
      issues: [],
      usabilityIssues: [],
      validatedAt: staleAt,
    };
    await fs.writeFile(
      path.join(cwd, SCRIMBLE_DIR, PROVIDER_VALIDATION_CACHE_FILE),
      `${JSON.stringify({
        version: 1,
        updatedAt: staleAt,
        profiles: { [profile.id]: staleEntry },
      }, null, 2)}\n`,
      'utf8',
    );

    const refreshed = await refreshProfileHealth(profile, { cwd });
    expect(refreshed.capabilitySource).toBe('fallback');
    expect(refreshed.validationFreshness).toBe('fresh');
  });

  it('flags explicit Copilot model unavailable when cached capabilities do not include it', async () => {
    process.env['COPILOT_GITHUB_TOKEN'] = 'validation-copilot-token';
    const profile = buildProviderProfile({
      id: 'copilot-profile',
      provider: 'github-copilot',
      modelStrategy: 'explicit',
      model: 'model-not-on-plan',
      authStrategy: 'env_token',
      interactive: false,
    });
    const now = new Date().toISOString();
    const cachedEntry: ProfileValidationCacheEntry = {
      profileId: profile.id,
      provider: profile.provider,
      authStrategy: profile.auth.strategy,
      authStatus: 'ready',
      authSource: 'env:COPILOT_GITHUB_TOKEN',
      modelStrategy: profile.modelStrategy,
      model: profile.model,
      modelAvailability: 'available',
      capability: {
        source: 'cached',
        availableModels: ['gpt-4.1', 'gpt-4o'],
        validatedAt: now,
      },
      issues: [],
      usabilityIssues: [],
      validatedAt: now,
    };
    await fs.writeFile(
      path.join(cwd, SCRIMBLE_DIR, PROVIDER_VALIDATION_CACHE_FILE),
      `${JSON.stringify({
        version: 1,
        updatedAt: now,
        profiles: { [profile.id]: cachedEntry },
      }, null, 2)}\n`,
      'utf8',
    );

    const health = evaluateProfileHealth(profile, { cwd });
    expect(health.modelAvailability).toBe('unavailable');
    expect(health.usableNow).toBe(false);
  });
});
