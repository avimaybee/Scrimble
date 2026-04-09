import type { RepoContext } from '@scrimble/shared';

export interface ArchitecturePromptInput {
  projectGoal: string;
  repoContext?: RepoContext;
  stackHints?: string[];
  constraints?: string[];
}

function formatRepoContext(repoContext?: RepoContext): string {
  if (!repoContext) {
    return 'No repository context was provided. You must clearly mark assumptions as assumptions.';
  }

  const languages = repoContext.stack.languages.join(', ') || 'Unknown';
  const frameworks = repoContext.stack.frameworks.join(', ') || 'None detected';
  const packageManager = repoContext.stack.packageManager ?? 'Unknown';
  const fileSamples = (repoContext.existingFiles ?? []).slice(0, 20);

  return [
    `Repository: ${repoContext.name}`,
    `Path: ${repoContext.path}`,
    `Languages: ${languages}`,
    `Frameworks: ${frameworks}`,
    `Package manager: ${packageManager}`,
    fileSamples.length > 0 ? `File samples: ${fileSamples.join(', ')}` : 'File samples: none provided',
  ].join('\n');
}

export function buildArchitecturePrompt(input: ArchitecturePromptInput): string {
  const constraints = [
    'Local-first runtime boundary is mandatory (.scrimble is the source of truth).',
    'No Scrimble-owned backend service calls in default flows.',
    ...(input.constraints ?? []),
  ];

  const stackHints = input.stackHints?.length ? input.stackHints.join(', ') : 'No additional stack hints.';

  return `You are designing architecture for Scrimble, a CLI-resident execution companion.

## Product Goal
${input.projectGoal}

## Repository Context
${formatRepoContext(input.repoContext)}

## Constraints
${constraints.map((constraint) => `- ${constraint}`).join('\n')}

## Stack Hints
${stackHints}

## Your Job Right Now
Propose the smallest set of code changes that solves the goal safely in this repository.

## Requirements
1. Keep it stupidly simple.
2. Prefer the fewest moving parts and the fewest files changed.
3. Keep conversational CLI-first flow and local .scrimble state as the product boundary.
4. Do not invent abstractions, extension points, or speculative architecture.

## Do Not Touch
- Do not introduce Scrimble backend service dependencies.
- Do not convert this into a dashboard-first architecture.
- Do not propose team-collaboration scope for V1.

## Output Format
Return exactly:
- Smallest viable change (2-4 sentences).
- Files to edit (bullet list with one-line reason each).
- Why this is enough (1-3 bullets).
- Risks/unknowns (say "None" if none).`;
}
