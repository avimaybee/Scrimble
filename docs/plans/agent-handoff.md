# Scrimble Agent Handoff Context

## Current State

- Repository is a pnpm + Turborepo monorepo.
- Build, lint, and test scripts run successfully from root.
- Core CLI commands implemented: `init`, `doctor`, `status`, `logout`.
- OAuth device auth command implemented: `login`.
- Architecture/chunk prompt templates implemented.
- R2 artifact persistence surface implemented in API (`/v1/artifacts*`).
- Cloudflare API scaffold and D1 migration are in place.
- Generation and replan workflow start/status API surfaces are implemented.
- Generation progress streaming is implemented via Durable Object + SSE/poll routes.
- Full CLI execution/recovery/proactive command surface is now implemented.

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

## OAuth Device Flow Support

Device-code login is implemented via:
- `apps/cli/src/lib/auth/device-flow.ts`
- `apps/cli/src/commands/login.ts`

`scrimble login` now supports:
- `--provider custom|github`
- OAuth endpoint overrides (`--device-endpoint`, `--token-endpoint`)
- `--client-id`, `--scope`, `--audience`

Session material is written to `.scrimble/session.json` and checked by `scrimble doctor`.

## Prompt Template Support

Prompt templates are now implemented in:
- `apps/cli/src/lib/ai/prompts/architecture.ts`
- `apps/cli/src/lib/ai/prompts/chunk-planning.ts`

These templates enforce the PRD prompt contract:
- Project Context
- Your Job Right Now
- Requirements
- Do Not Touch
- Done When
- Verification Signals

## R2 Artifact Support

Artifact persistence now exists in API:
- `POST /v1/artifacts` store JSON artifact payloads in R2
- `GET /v1/artifacts?key=...` read a specific artifact
- `GET /v1/artifacts/list?projectId=...&type=...` list artifact keys

Implementation files:
- `apps/api/src/lib/storage.ts`
- `apps/api/src/index.ts`

## Progress Streaming Support

Progress transport now exists for generation workflow:
- Durable Object: `apps/api/src/durable-objects/generation-progress.ts`
- Poll endpoint: `GET /v1/generation/:id/progress?since=<sequence>`
- Stream endpoint: `GET /v1/generation/:id/stream?since=<sequence>` (SSE)
- Workflow publishes progress stages from `apps/api/src/workflows/generation-workflow.ts`

## Execution Loop + Recovery Surface (Implemented)

Commands now implemented:
- `import`, `approve`, `prompt`, `next`, `skip`
- `update`, `replan`, `sync`
- enhanced default `scrimble` command + enhanced `status`, `done`, `watch`, `doctor`

Supporting runtime additions:
- Local plan/state engine: `apps/cli/src/lib/local/state.ts`
- Cloud artifact/replan client: `apps/cli/src/lib/api/client.ts`
- Proactive signal engine: `apps/cli/src/lib/watch/proactive.ts`
- Stale-state detection: `apps/cli/src/lib/staleness.ts`
- Telemetry pipeline: `apps/cli/src/lib/telemetry.ts`
- Security utility for sensitive writes: `apps/cli/src/lib/security.ts`
- CLI runtime startup warning removed by moving default command to `root` and forcing clean emit path.

## High-Signal Files

- `apps/cli/src/commands/init.ts`
- `apps/cli/src/commands/login.ts`
- `apps/cli/src/lib/ai/provider.ts`
- `apps/cli/src/lib/ai/prompts/architecture.ts`
- `apps/cli/src/lib/ai/prompts/chunk-planning.ts`
- `apps/cli/src/lib/auth/device-flow.ts`
- `apps/cli/src/lib/config/load-config.ts`
- `apps/cli/src/lib/local/state.ts`
- `apps/cli/src/lib/api/client.ts`
- `apps/cli/src/lib/watch/proactive.ts`
- `apps/cli/src/lib/staleness.ts`
- `apps/cli/src/lib/telemetry.ts`
- `apps/cli/src/lib/security.ts`
- `apps/cli/src/commands/root.ts`
- `apps/cli/bin/run.js`
- `apps/cli/package.json`
- `apps/api/src/lib/storage.ts`
- `apps/api/src/index.ts`
- `apps/api/src/durable-objects/generation-progress.ts`
- `apps/api/src/workflows/generation-workflow.ts`
- `apps/api/src/workflows/replan-workflow.ts`
- `apps/api/wrangler.toml`
- `packages/shared/src/types/index.ts`
- `packages/shared/src/schemas/index.ts`
- `docs/plans/master-plan.md`

## TODO Tracking Snapshot

- Done: **43**
- Pending: **0**

Ready pending tasks:
- none (roadmap todos complete)
