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
    'Cloudflare-only backend boundary is mandatory.',
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
Produce an architecture proposal that can be implemented incrementally and safely in this repository.

## Requirements
1. Keep CLI-first user experience as the primary surface.
2. Keep local-first state in .scrimble/ with cloud sync support.
3. Preserve one-active-chunk execution model.
4. Include durable generation/replan orchestration on Cloudflare.
5. Include explicit boundaries between local CLI runtime and cloud services.

## Do Not Touch
- Do not introduce non-Cloudflare backend infrastructure.
- Do not convert this into a dashboard-first architecture.
- Do not propose team-collaboration scope for V1.

## Done When
- Architecture includes components, data flow, and failure/recovery strategy.
- Architecture names concrete implementation seams for Phase 1/2 work.
- Risks and mitigations are explicit and tied to this repo context.

## Verification Signals
- Proposal references existing repo constraints and stack.
- Proposal has no contradictory runtime assumptions.
- Proposal contains migration-safe sequence, not a big-bang rewrite.

## Output Format
Return exactly these sections:
1. Architecture Summary
2. Runtime Components
3. Data Model and Storage
4. Local-Cloud Sync Model
5. Failure Modes and Recovery
6. Incremental Implementation Plan
7. Open Questions`;
}
