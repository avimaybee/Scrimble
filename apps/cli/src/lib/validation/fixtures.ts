import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateLegacyLedgerIfPresent } from '../ledger/legacy-migration.js';
import type { ValidationFixtureName, ValidationScenarioDefinition } from './types.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_BASE_CANDIDATES = [
  path.resolve(currentDir, 'fixtures', 'repos'),
  path.resolve(process.cwd(), 'src', 'lib', 'validation', 'fixtures', 'repos'),
];

export const CANONICAL_VALIDATION_SCENARIOS: ValidationScenarioDefinition[] = [
  {
    name: 'greenfield_build',
    description: 'Near-empty repository where user asks Scrimble to create a small product from intent.',
    fixtureName: 'greenfield_build',
    prompt: 'Build a small CLI notes tool with create/list/delete and basic verification coverage.',
    discovery: {
      shellMode: 'interactive',
      interactiveAnswers: {
        projectName: 'TaskSprout',
        goal: 'Create a tiny CLI notes experience for solo developers',
        productVision: 'Fast local notes capture and retrieval from the terminal',
        targetUsers: 'Solo developers and makers',
        successCriteria: [
          'User can add, list, and delete notes from CLI commands',
          'Generated tasks include explicit ownership and verification commands',
        ],
        nonGoals: ['No cloud sync', 'No multi-user account system'],
        qualityPreference: 'prototype',
        timeline: 'asap',
        productConstraints: ['Keep implementation local-first'],
        technicalConstraints: ['Use the existing TypeScript toolchain'],
        designDirection: 'Minimal terminal-first UX with concise status output',
      },
    },
    shellFlow: {},
    oneShotFlow: {
      autoApproveDiscovery: true,
      autoConfirmExecution: true,
    },
    expected: {
      foundationStatus: 'approved',
      minTaskCount: 1,
      minOwnershipCoverage: 0.5,
      minVerificationCoverage: 0.5,
    },
  },
  {
    name: 'brownfield_feature',
    description: 'Existing repository where user asks for a targeted feature addition.',
    fixtureName: 'brownfield_feature',
    prompt: 'Add project-level tagging to tasks and allow filtering by tag in the dashboard.',
    discovery: {
      shellMode: 'autogenerate',
    },
    shellFlow: {
      pauseAtFirstExecutionBoundary: true,
    },
    oneShotFlow: {
      autoApproveDiscovery: true,
      autoConfirmExecution: true,
    },
    expected: {
      foundationStatus: 'approved',
      minTaskCount: 1,
      minOwnershipCoverage: 0.8,
      minVerificationCoverage: 0.8,
      requireResumePath: true,
    },
  },
  {
    name: 'brownfield_repair',
    description: 'Existing repository where user asks for bugfix/refactor and recovery-oriented behavior.',
    fixtureName: 'brownfield_repair',
    prompt: 'Fix config persistence bugs and harden the settings loader without broad rewrites.',
    discovery: {
      shellMode: 'custom',
      customBrief: [
        'Stabilize settings persistence and recover cleanly from stale runtime state.',
        'Prioritize deterministic recovery signals and scoped file ownership.',
      ].join(' '),
    },
    shellFlow: {
      injectConsistencyMismatch: true,
    },
    oneShotFlow: {
      autoApproveDiscovery: true,
      autoConfirmExecution: true,
    },
    expected: {
      foundationStatus: 'approved',
      minTaskCount: 1,
      minOwnershipCoverage: 0.8,
      minVerificationCoverage: 0.8,
      requireRecoveryPath: true,
    },
  },
  {
    name: 'provider_no_active_profile',
    description: 'Workspace has no active profile and should steer to setup before model-backed work.',
    fixtureName: 'greenfield_build',
    prompt: 'continue with planning',
    providerSetup: {
      clearProfiles: true,
    },
    envOverrides: {
      OPENAI_API_KEY: undefined,
    },
    discovery: {
      shellMode: 'autogenerate',
    },
    shellFlow: {},
    oneShotFlow: {
      autoApproveDiscovery: true,
      autoConfirmExecution: true,
    },
    expected: {
      foundationStatus: 'approved',
      minTaskCount: 0,
      minOwnershipCoverage: 0,
      minVerificationCoverage: 0,
      provider: {
        requireUsableProfile: false,
        expectEarlyGate: true,
      },
    },
  },
  {
    name: 'provider_stale_capabilities',
    description: 'Stale capability cache should be refreshed by validation surfaces.',
    fixtureName: 'greenfield_build',
    prompt: 'show setup status and continue',
    providerSetup: {
      provider: 'openai',
      authStrategy: 'api_key',
      modelStrategy: 'explicit',
      model: 'gpt-4o',
      seedStaleCapabilities: true,
    },
    envOverrides: {
      OPENAI_API_KEY: 'validation-openai-key',
    },
    discovery: {
      shellMode: 'autogenerate',
    },
    shellFlow: {},
    oneShotFlow: {
      autoApproveDiscovery: true,
      autoConfirmExecution: true,
    },
    expected: {
      foundationStatus: 'approved',
      minTaskCount: 0,
      minOwnershipCoverage: 0,
      minVerificationCoverage: 0,
      provider: {
        requireUsableProfile: true,
        requireFreshValidation: true,
      },
    },
  },
  {
    name: 'provider_invalid_copilot_auth',
    description: 'Copilot profile without valid credentials should be flagged unusable with setup guidance.',
    fixtureName: 'greenfield_build',
    prompt: 'continue with execution',
    providerSetup: {
      provider: 'github-copilot',
      authStrategy: 'env_token',
      modelStrategy: 'auto',
    },
    envOverrides: {
      COPILOT_GITHUB_TOKEN: undefined,
      GH_TOKEN: undefined,
      GITHUB_TOKEN: undefined,
    },
    discovery: {
      shellMode: 'autogenerate',
    },
    shellFlow: {},
    oneShotFlow: {
      autoApproveDiscovery: true,
      autoConfirmExecution: true,
    },
    expected: {
      foundationStatus: 'approved',
      minTaskCount: 0,
      minOwnershipCoverage: 0,
      minVerificationCoverage: 0,
      provider: {
        requireUsableProfile: false,
        expectEarlyGate: true,
      },
    },
  },
  {
    name: 'provider_copilot_env_token',
    description: 'Copilot env-token credential path resolves and is reported consistently.',
    fixtureName: 'greenfield_build',
    prompt: 'continue planning',
    providerSetup: {
      provider: 'github-copilot',
      authStrategy: 'env_token',
      modelStrategy: 'auto',
    },
    envOverrides: {
      COPILOT_GITHUB_TOKEN: 'validation-copilot-token',
      GH_TOKEN: undefined,
      GITHUB_TOKEN: undefined,
    },
    discovery: {
      shellMode: 'autogenerate',
    },
    shellFlow: {},
    oneShotFlow: {
      autoApproveDiscovery: true,
      autoConfirmExecution: true,
    },
    expected: {
      foundationStatus: 'approved',
      minTaskCount: 0,
      minOwnershipCoverage: 0,
      minVerificationCoverage: 0,
      provider: {
        requireUsableProfile: true,
        expectedAuthSource: 'env:COPILOT_GITHUB_TOKEN',
      },
    },
  },
  {
    name: 'provider_explicit_model_unavailable',
    description: 'Explicit Copilot model unavailable while auto remains viable should be surfaced early.',
    fixtureName: 'greenfield_build',
    prompt: 'continue execution',
    providerSetup: {
      provider: 'github-copilot',
      authStrategy: 'env_token',
      modelStrategy: 'explicit',
      model: 'model-not-on-plan',
      seedStaleCapabilities: true,
    },
    envOverrides: {
      COPILOT_GITHUB_TOKEN: 'validation-copilot-token',
      GH_TOKEN: undefined,
      GITHUB_TOKEN: undefined,
    },
    discovery: {
      shellMode: 'autogenerate',
    },
    shellFlow: {},
    oneShotFlow: {
      autoApproveDiscovery: true,
      autoConfirmExecution: true,
    },
    expected: {
      foundationStatus: 'approved',
      minTaskCount: 0,
      minOwnershipCoverage: 0,
      minVerificationCoverage: 0,
      provider: {
        requireUsableProfile: false,
        expectEarlyGate: true,
      },
    },
  },
];

async function fixtureSourcePath(name: ValidationFixtureName): Promise<string> {
  for (const candidate of FIXTURE_BASE_CANDIDATES) {
    const source = path.join(candidate, name);
    try {
      await fs.access(source);
      await fs.access(path.join(source, 'README.md'));
      return source;
    } catch {
      // Continue searching fallback candidates.
    }
  }
  throw new Error(`Validation fixture not found for scenario "${name}".`);
}

export async function materializeScenarioFixture(name: ValidationFixtureName): Promise<string> {
  const source = await fixtureSourcePath(name);
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `scrimble-validation-${name}-`));
  await fs.cp(source, workspace, { recursive: true, force: true });
  await fs.mkdir(path.join(workspace, '.git'), { recursive: true });
  await migrateLegacyLedgerIfPresent(workspace);
  return workspace;
}
