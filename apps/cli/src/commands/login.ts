import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  CONFIG_FILE,
  SCRIMBLE_DIR,
  SESSION_FILE,
  authConfigSchema,
  authProviderSchema,
} from '@scrimble/shared';
import { loadScrimbleConfig } from '../lib/config/load-config.js';
import { pollDeviceCodeToken, startDeviceCode } from '../lib/auth/device-flow.js';
import { getAuthStatus } from '../lib/onboarding.js';
import { writeSecureJson } from '../lib/security.js';
import { recordTelemetry } from '../lib/telemetry.js';

type ParsedAuthConfig = ReturnType<typeof authConfigSchema.parse>;

function defaultCustomAuth(cloudEndpoint?: string): Omit<ParsedAuthConfig, 'provider'> {
  const endpoint = cloudEndpoint ?? 'https://api.scrimble.dev';
  return {
    clientId: 'scrimble-cli',
    deviceCodeEndpoint: `${endpoint}/oauth/device/code`,
    tokenEndpoint: `${endpoint}/oauth/token`,
    scope: 'scrimble:cli',
  };
}

function resolveAuthConfig(
  providerInput: string,
  flags: {
    'client-id'?: string | undefined;
    'device-endpoint'?: string | undefined;
    'token-endpoint'?: string | undefined;
    scope?: string | undefined;
    audience?: string | undefined;
  },
  configFromFile?: Awaited<ReturnType<typeof loadScrimbleConfig>>,
): ParsedAuthConfig {
  const provider = authProviderSchema.parse(providerInput);
  const configAuth = configFromFile?.auth;

  const fallback = defaultCustomAuth(configFromFile?.cloudEndpoint);
  const audience = flags.audience ?? configAuth?.audience;
  const scope = flags.scope ?? configAuth?.scope ?? fallback.scope;
  
  return authConfigSchema.parse({
    provider,
    clientId: flags['client-id'] ?? configAuth?.clientId ?? fallback.clientId,
    deviceCodeEndpoint:
      flags['device-endpoint'] ?? configAuth?.deviceCodeEndpoint ?? fallback.deviceCodeEndpoint,
    tokenEndpoint: flags['token-endpoint'] ?? configAuth?.tokenEndpoint ?? fallback.tokenEndpoint,
    ...(scope ? { scope } : {}),
    ...(audience ? { audience } : {}),
  });
}

export default class Login extends Command {
  static override description = 'Authenticate CLI session using OAuth 2.0 device flow';

  static override examples = [
    '<%= config.bin %> login',
    '<%= config.bin %> login --provider firebase',
  ];

  static override flags = {
    provider: Flags.string({
      description: 'Auth provider',
      options: [...authProviderSchema.options],
      default: 'custom',
    }),
    'client-id': Flags.string({
      description: 'OAuth client_id override (defaults to config or scrimble-cli)',
    }),
    'device-endpoint': Flags.string({
      description: 'OAuth device authorization endpoint override',
    }),
    'token-endpoint': Flags.string({
      description: 'OAuth token endpoint override',
    }),
    scope: Flags.string({
      description: 'Requested OAuth scope',
    }),
    audience: Flags.string({
      description: 'OAuth audience (for custom providers)',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Login);
    const cwd = process.cwd();
    const configPath = path.join(cwd, SCRIMBLE_DIR, CONFIG_FILE);
    const authStatus = await getAuthStatus(cwd);
    if (authStatus.isAuthenticated) {
      this.log(chalk.dim('\nExisting authenticated session detected; this login will replace it.\n'));
    }

    let configFromFile: Awaited<ReturnType<typeof loadScrimbleConfig>> | undefined;
    try {
      await fs.access(configPath);
      configFromFile = await loadScrimbleConfig(cwd);
    } catch {
      configFromFile = undefined;
    }

    const authConfig = resolveAuthConfig(flags.provider, flags, configFromFile);
    const startResult = await startDeviceCode(authConfig);

    this.log('');
    this.log(chalk.bold('🔐 Device Login Started'));
    this.log(chalk.dim(`Provider: ${authConfig.provider}`));
    this.log('');
    this.log(`1. Open: ${chalk.cyan(startResult.verificationUri)}`);
    this.log(`2. Enter code: ${chalk.bold(startResult.userCode)}`);
    if (startResult.verificationUriComplete) {
      this.log(chalk.dim(`   Direct link: ${startResult.verificationUriComplete}`));
    }
    this.log(chalk.dim('Waiting for authorization...'));

    const session = await pollDeviceCodeToken(authConfig, startResult);

    const sessionDir = path.join(cwd, SCRIMBLE_DIR);
    await fs.mkdir(sessionDir, { recursive: true });
    await writeSecureJson(path.join(sessionDir, SESSION_FILE), session);
    await recordTelemetry({
      event: 'auth_login_success',
      payload: { provider: session.provider },
    });

    this.log('');
    this.log(chalk.green('✓ Login successful. Session saved to .scrimble/session.json'));
    if (session.expiresAt) {
      this.log(chalk.dim(`  Expires: ${new Date(session.expiresAt).toLocaleString()}`));
    }
    this.log('');
  }
}
