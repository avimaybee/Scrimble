import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
  CONDUCTOR_DIR,
  SCRIMBLE_DIR,
  type DiscoveryMode,
  type DiscoveryStep,
  type Intent,
  type IntentDiscoveryState,
  type RepoScanSummary,
} from '@scrimble/shared';
import { detectStack } from '../init/stack-detection.js';
import {
  approveDiscoveryFoundation,
  hasApprovedOrSkippedFoundation,
  loadIntentState,
  markDiscoveryInProgress,
  normalizeIntent,
  saveDiscoveryDraft,
  saveDiscoveryState,
  skipDiscoveryFoundation,
} from '../planning/intent.js';

const execFileAsync = promisify(execFile);

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toList(value: string): string[] {
  return dedupe(
    value
      .split(/\r?\n|;/)
      .map((entry) => entry.trim()),
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function detectBranch(cwd: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      windowsHide: true,
      timeout: 1_500,
      maxBuffer: 16 * 1024,
    });
    const branch = result.stdout.trim();
    if (!branch || branch === 'HEAD') {
      return undefined;
    }
    return branch;
  } catch {
    return undefined;
  }
}

async function detectPackageManager(cwd: string): Promise<string | undefined> {
  const checks: Array<{ file: string; value: string }> = [
    { file: 'pnpm-lock.yaml', value: 'pnpm' },
    { file: 'yarn.lock', value: 'yarn' },
    { file: 'package-lock.json', value: 'npm' },
    { file: 'bun.lockb', value: 'bun' },
    { file: 'go.mod', value: 'go' },
    { file: 'Cargo.toml', value: 'cargo' },
  ];
  for (const check of checks) {
    if (await pathExists(path.join(cwd, check.file))) {
      return check.value;
    }
  }
  return undefined;
}

async function summarizeReadme(cwd: string): Promise<string | undefined> {
  const candidates = ['README.md', 'readme.md'];
  for (const candidate of candidates) {
    const absolutePath = path.join(cwd, candidate);
    try {
      const content = await fs.readFile(absolutePath, 'utf8');
      const summary = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .slice(0, 4)
        .join(' ');
      if (summary) {
        return summary;
      }
    } catch {
      // ignore missing README candidates
    }
  }
  return undefined;
}

async function summarizeConfig(cwd: string): Promise<string[]> {
  const summary: string[] = [];
  const packageJsonPath = path.join(cwd, 'package.json');
  try {
    const content = await fs.readFile(packageJsonPath, 'utf8');
    const parsed = JSON.parse(content) as { name?: string; scripts?: Record<string, string> };
    if (parsed.name) {
      summary.push(`package: ${parsed.name}`);
    }
    if (parsed.scripts) {
      const scripts = Object.keys(parsed.scripts).slice(0, 5);
      if (scripts.length > 0) {
        summary.push(`scripts: ${scripts.join(', ')}`);
      }
    }
  } catch {
    // ignore when package.json is missing or malformed
  }
  return summary;
}

async function loadConductorArtifacts(cwd: string): Promise<{ files: string[]; content: Record<string, string> }> {
  const candidates = [
    'product.md',
    'product-guidelines.md',
    'tech-stack.md',
  ];
  const files: string[] = [];
  const content: Record<string, string> = {};
  for (const candidate of candidates) {
    const absolutePath = path.join(cwd, CONDUCTOR_DIR, candidate);
    try {
      const value = await fs.readFile(absolutePath, 'utf8');
      files.push(path.join(CONDUCTOR_DIR, candidate).replaceAll('\\', '/'));
      content[candidate] = value;
    } catch {
      // ignore missing conductor artifact
    }
  }
  return { files, content };
}

export interface DiscoveryBootstrap {
  requiresDiscovery: boolean;
  state: IntentDiscoveryState;
  scan: RepoScanSummary;
  currentIntent: Intent | null;
}

export async function scanRepositoryContext(cwd: string): Promise<RepoScanSummary> {
  const stack = await detectStack(cwd);
  const packageManager = await detectPackageManager(cwd);
  const readmeSummary = await summarizeReadme(cwd);
  const configSummary = await summarizeConfig(cwd);
  const conductor = await loadConductorArtifacts(cwd);
  const hasScrimbleDir = await pathExists(path.join(cwd, SCRIMBLE_DIR));
  const branch = await detectBranch(cwd);
  const repoName = path.basename(cwd);
  const hasSourceMarkers = await Promise.all([
    pathExists(path.join(cwd, 'src')),
    pathExists(path.join(cwd, 'apps')),
    pathExists(path.join(cwd, 'package.json')),
    pathExists(path.join(cwd, '.git')),
  ]);
  const projectType = hasSourceMarkers.some(Boolean) ? 'brownfield' : 'greenfield';

  return {
    projectType,
    repoName,
    repoPath: cwd,
    ...(branch ? { branch } : {}),
    languages: stack.languages,
    frameworks: stack.frameworks,
    ...(packageManager ? { packageManager } : {}),
    ...(readmeSummary ? { readmeSummary } : {}),
    configSummary,
    hasScrimbleDir,
    hasConductorArtifacts: conductor.files.length > 0,
    conductorArtifacts: conductor.files,
  };
}

export async function loadDiscoveryBootstrap(cwd: string): Promise<DiscoveryBootstrap> {
  const intentState = await loadIntentState(cwd);
  const existingScan = intentState.discovery.scan;
  const scan = existingScan ?? await scanRepositoryContext(cwd);
  const hydratedState: IntentDiscoveryState = existingScan
    ? intentState.discovery
    : {
      ...intentState.discovery,
      ...(intentState.discovery.status === 'not_started' ? { step: 'scan_summary' as const } : {}),
      scan,
      updatedAt: new Date().toISOString(),
    };
  if (!existingScan) {
    await saveDiscoveryState(hydratedState, cwd);
  }

  return {
    requiresDiscovery: !(await hasApprovedOrSkippedFoundation(cwd)),
    state: hydratedState,
    scan,
    currentIntent: intentState.intent,
  };
}

export interface FoundationAnswers {
  projectName: string;
  goal: string;
  productVision: string;
  targetUsers: string;
  successCriteria: string[];
  nonGoals: string[];
  qualityPreference: Intent['qualityPreference'];
  timeline: Intent['timeline'];
  productConstraints: string[];
  technicalConstraints: string[];
  designDirection?: string;
}

function applyConductorHints(base: Intent, conductorContent: Record<string, string>): Intent {
  const assumptions = [...base.productAssumptions];
  if (conductorContent['product.md']) {
    assumptions.push('Imported context from conductor/product.md');
  }
  if (conductorContent['product-guidelines.md']) {
    assumptions.push('Imported context from conductor/product-guidelines.md');
  }
  if (conductorContent['tech-stack.md']) {
    assumptions.push('Imported context from conductor/tech-stack.md');
  }
  return {
    ...base,
    productAssumptions: dedupe(assumptions),
    updatedAt: new Date().toISOString(),
  };
}

export async function buildAutogeneratedFoundation(
  cwd: string,
  scan: RepoScanSummary,
  goal: string,
  previousIntent?: Intent | null,
): Promise<Intent> {
  const conductor = await loadConductorArtifacts(cwd);
  const baseline = normalizeIntent({
    initialGoal: goal,
    repoContext: {
      name: scan.repoName,
      path: scan.repoPath,
      ...(scan.branch ? { branch: scan.branch } : {}),
      projectType: scan.projectType,
      ...(scan.languages[0] ? { primaryLanguage: scan.languages[0] } : {}),
      frameworks: scan.frameworks,
      ...(scan.packageManager ? { packageManager: scan.packageManager } : {}),
      ...(scan.readmeSummary ? { readmeSummary: scan.readmeSummary } : {}),
      keyDirectories: [],
    },
    ...(previousIntent ? { previousIntent } : {}),
  });

  const successCriteria = baseline.successCriteria.length > 0
    ? baseline.successCriteria
    : [`Deliver ${goal}`, 'Core workflows pass verification'];
  const nonGoals = baseline.nonGoals.length > 0
    ? baseline.nonGoals
    : ['Do not rewrite unrelated modules'];
  const technicalConstraints = dedupe([
    ...baseline.technicalConstraints,
    ...(scan.packageManager ? [`Use ${scan.packageManager} workflow`] : []),
    ...(scan.languages.length > 0 ? [`Primary languages: ${scan.languages.join(', ')}`] : []),
  ]);

  return applyConductorHints(
    {
      ...baseline,
      projectName: baseline.projectName || scan.repoName,
      productVision: baseline.productVision || goal,
      goal,
      targetUsers: baseline.targetUsers || 'Primary users of this repository',
      successCriteria,
      nonGoals,
      outOfScope: nonGoals,
      qualityPreference: baseline.qualityPreference ?? (scan.projectType === 'greenfield' ? 'prototype' : 'production'),
      timeline: baseline.timeline ?? 'flexible',
      productConstraints: baseline.productConstraints.length > 0
        ? baseline.productConstraints
        : scan.projectType === 'brownfield'
          ? ['Preserve existing repository behavior while iterating.']
          : [],
      technicalConstraints,
      constraints: technicalConstraints,
      inferredStack: {
        projectType: scan.projectType,
        repoName: scan.repoName,
        repoPath: scan.repoPath,
        ...(scan.branch ? { branch: scan.branch } : {}),
        languages: scan.languages,
        frameworks: scan.frameworks,
        ...(scan.packageManager ? { packageManager: scan.packageManager } : {}),
      },
      discoveryMode: 'autogenerate',
      updatedAt: new Date().toISOString(),
    },
    conductor.content,
  );
}

export async function buildCustomFoundation(
  cwd: string,
  scan: RepoScanSummary,
  brief: string,
  previousIntent?: Intent | null,
): Promise<Intent> {
  const goalLine = brief.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? 'Define project goal';
  const draft = await buildAutogeneratedFoundation(cwd, scan, goalLine, previousIntent);
  return {
    ...draft,
    productVision: brief.trim(),
    productAssumptions: dedupe([...draft.productAssumptions, 'Custom brief supplied by user']),
    discoveryMode: 'custom',
    updatedAt: new Date().toISOString(),
  };
}

export async function buildInteractiveFoundation(
  cwd: string,
  scan: RepoScanSummary,
  answers: FoundationAnswers,
  previousIntent?: Intent | null,
): Promise<Intent> {
  const baseline = await buildAutogeneratedFoundation(cwd, scan, answers.goal, previousIntent);
  const productConstraints = dedupe(answers.productConstraints);
  const technicalConstraints = dedupe(answers.technicalConstraints);
  const nonGoals = dedupe(answers.nonGoals);
  return {
    ...baseline,
    projectName: answers.projectName.trim() || baseline.projectName,
    goal: answers.goal.trim() || baseline.goal,
    productVision: answers.productVision.trim() || baseline.productVision,
    targetUsers: answers.targetUsers.trim() || baseline.targetUsers,
    successCriteria: dedupe(answers.successCriteria),
    nonGoals,
    outOfScope: nonGoals,
    qualityPreference: answers.qualityPreference,
    timeline: answers.timeline,
    productConstraints,
    technicalConstraints,
    constraints: technicalConstraints,
    ...(answers.designDirection?.trim() ? { designDirection: answers.designDirection.trim() } : {}),
    discoveryMode: 'interactive',
    updatedAt: new Date().toISOString(),
  };
}

export async function persistDiscoveryDraft(
  cwd: string,
  draft: Intent,
  mode: DiscoveryMode,
  scan: RepoScanSummary,
): Promise<void> {
  await saveDiscoveryDraft(draft, {
    mode,
    step: 'draft_review',
    scan,
    cwd,
  });
}

export async function persistDiscoveryProgress(
  cwd: string,
  mode: DiscoveryMode,
  step: DiscoveryStep,
  scan: RepoScanSummary,
  draft?: Intent,
  questionIndex?: number,
): Promise<void> {
  await markDiscoveryInProgress({
    mode,
    step,
    ...(typeof questionIndex === 'number' ? { questionIndex } : {}),
    scan,
    ...(draft ? { draft } : {}),
    cwd,
  });
}

export async function approveFoundation(
  cwd: string,
  draft: Intent,
  mode: DiscoveryMode,
  scan: RepoScanSummary,
): Promise<void> {
  await approveDiscoveryFoundation(
    {
      ...draft,
      discoveryMode: mode,
      updatedAt: new Date().toISOString(),
    },
    {
      mode,
      scan,
      cwd,
      reason: 'project_foundation_approved',
    },
  );
  await writeDerivedContextArtifacts(cwd, draft);
}

export async function skipFoundation(cwd: string): Promise<void> {
  await skipDiscoveryFoundation(cwd);
}

export async function writeDerivedContextArtifacts(cwd: string, intent: Intent): Promise<void> {
  const contextDir = path.join(cwd, SCRIMBLE_DIR, 'context');
  await fs.mkdir(contextDir, { recursive: true });

  const product = [
    `# ${intent.projectName}`,
    '',
    `## Goal`,
    intent.goal,
    '',
    `## Product Vision`,
    intent.productVision,
    '',
    `## Target Users`,
    intent.targetUsers,
    '',
    `## Success Criteria`,
    ...intent.successCriteria.map((entry) => `- ${entry}`),
    '',
    `## Non-goals`,
    ...intent.nonGoals.map((entry) => `- ${entry}`),
    '',
    `## Timeline`,
    `- ${intent.timeline}`,
    '',
    `## Quality Bar`,
    `- ${intent.qualityPreference}`,
    '',
  ].join('\n');

  const productGuidelines = [
    '# Product Guidelines',
    '',
    '## Product Constraints',
    ...(intent.productConstraints.length > 0 ? intent.productConstraints.map((entry) => `- ${entry}`) : ['- None specified']),
    '',
    '## Technical Constraints',
    ...(intent.technicalConstraints.length > 0 ? intent.technicalConstraints.map((entry) => `- ${entry}`) : ['- None specified']),
    '',
    ...(intent.designDirection ? ['## Design / UX Direction', intent.designDirection, ''] : []),
  ].join('\n');

  const techStack = [
    '# Tech Stack',
    '',
    `- Project Type: ${intent.inferredStack.projectType}`,
    `- Repository: ${intent.inferredStack.repoName}`,
    `- Branch: ${intent.inferredStack.branch ?? '-'}`,
    `- Languages: ${intent.inferredStack.languages.join(', ') || 'unknown'}`,
    `- Frameworks: ${intent.inferredStack.frameworks.join(', ') || 'none detected'}`,
    `- Package Manager: ${intent.inferredStack.packageManager ?? 'unknown'}`,
    '',
    '## Discovery Notes',
    `- Discovery mode: ${intent.discoveryMode}`,
    `- Updated: ${intent.updatedAt}`,
    '',
  ].join('\n');

  await Promise.all([
    fs.writeFile(path.join(contextDir, 'product.md'), `${product}\n`, 'utf8'),
    fs.writeFile(path.join(contextDir, 'product-guidelines.md'), `${productGuidelines}\n`, 'utf8'),
    fs.writeFile(path.join(contextDir, 'tech-stack.md'), `${techStack}\n`, 'utf8'),
  ]);
}

export async function foundationIsReady(cwd: string): Promise<boolean> {
  return hasApprovedOrSkippedFoundation(cwd);
}
