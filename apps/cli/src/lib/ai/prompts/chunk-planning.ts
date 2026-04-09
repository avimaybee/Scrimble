import type { RepoContext } from '@scrimble/shared/types/legacy';

export interface ChunkPlanningPromptInput {
  projectGoal: string;
  architectureSummary: string;
  repoContext?: RepoContext;
  completedWorkSummary?: string;
  chunkCountTarget?: number;
}

function repoSnapshot(repoContext?: RepoContext): string {
  if (!repoContext) {
    return 'Repository context unavailable. Plan conservatively and surface assumptions.';
  }

  const languages = repoContext.stack.languages.join(', ') || 'Unknown';
  const frameworks = repoContext.stack.frameworks.join(', ') || 'None detected';

  return [
    `Repo: ${repoContext.name}`,
    `Languages: ${languages}`,
    `Frameworks: ${frameworks}`,
    `Existing files listed: ${(repoContext.existingFiles ?? []).length}`,
  ].join('\n');
}

export function buildChunkPlanningPrompt(input: ChunkPlanningPromptInput): string {
  const chunkCountTarget = input.chunkCountTarget ?? 8;

  return `You are generating implementation chunks for Scrimble.

## Project Context
Goal: ${input.projectGoal}

Architecture Summary:
${input.architectureSummary}

Repository Snapshot:
${repoSnapshot(input.repoContext)}

Completed Work Summary:
${input.completedWorkSummary ?? 'No prior completed work summary provided.'}

## Your Job Right Now
Generate a sequenced chunk plan with exactly one active chunk at a time and explicit completion evidence.

## Requirements
1. Produce around ${chunkCountTarget} chunks (merge/split only when necessary).
2. Each chunk must be independently executable in this codebase.
3. Each chunk must include:
   - Project Context
   - Your Job Right Now
   - Requirements
   - Do Not Touch
   - Done When
   - Verification Signals
4. Keep chunk scope tight enough for one focused coding session.
5. Preserve completed work; never re-open already completed chunks unless absolutely required.

## Do Not Touch
- Do not emit vague chunks (for example "improve architecture").
- Do not emit chunks without verification signals.
- Do not emit chunks that require hidden assumptions.

## Done When
- Every chunk has clear boundaries and measurable done conditions.
- Dependencies between chunks are explicit.
- Sequence supports re-entry after interruption.

## Verification Signals
- Each chunk has at least 2 objective checks.
- Ambiguous checks are marked as heuristic/manual-review.
- Do-not-touch boundaries are concrete (files/modules/behaviors).

## Output Format
Return JSON only with this shape:
{
  "summary": "string",
  "chunks": [
    {
      "id": "chunk-001",
      "sequence": 1,
      "title": "string",
      "projectContext": "string",
      "job": "string",
      "requirements": ["string"],
      "doNotTouch": ["string"],
      "doneWhen": ["string"],
      "verificationSignals": ["string"],
      "dependsOn": ["chunk-000"]
    }
  ]
}`;
}
