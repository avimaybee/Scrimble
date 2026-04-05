# Scrimble Agent Handoff Context

## Current State

- Repository is a pnpm + Turborepo monorepo.
- Build, lint, and test scripts run successfully from root.
- Core CLI commands implemented: `init`, `doctor`, `status`, `logout`.
- Cloudflare API scaffold and D1 migration are in place.

## Key Decisions Locked In

1. CLI framework: **oclif**
2. Terminal UI foundation: **Ink**
3. Shared validation/types: **Zod + TypeScript package**
4. Backend boundary: **Cloudflare Workers + D1 + R2**
5. AI abstraction: **Vercel AI SDK provider factory**

## AI Provider Support (Implemented)

`apps/cli/src/lib/ai/provider.ts` now supports:
- `openai`
- `anthropic`
- `google`
- `openrouter`
- `github-copilot`
- `azure`
- `groq`
- `together`

## GitHub Copilot Subscription Support

Scrimble can now initialize and use GitHub Copilot as an AI provider with:

```json
{
  "ai": {
    "provider": "github-copilot",
    "model": "gpt-4.1",
    "apiKey": "${GITHUB_COPILOT_TOKEN}",
    "baseUrl": "https://api.githubcopilot.com"
  }
}
```

`scrimble init` supports:
- `--ai-provider github-copilot`
- `--ai-model <model-id>`

## High-Signal Files

- `apps/cli/src/commands/init.ts`
- `apps/cli/src/lib/ai/provider.ts`
- `apps/cli/src/lib/config/load-config.ts`
- `packages/shared/src/types/index.ts`
- `packages/shared/src/schemas/index.ts`
- `docs/plans/master-plan.md`

## TODO Tracking Snapshot

- Done: **12**
- Pending: **31**

Ready pending tasks:
- `p1-9` Device code auth flow
- `p2-2` Architecture prompts
- `p2-3` Chunk planning prompts
- `p2-5` R2 artifact storage
- `p3-3` Verification engine
- `p5-1` File watching
