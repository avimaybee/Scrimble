# Scrimble — Greenfield Architecture Plan

## Problem Statement

Scrimble is a **CLI-resident execution companion** for solo AI-native builders who struggle to finish projects. It tackles context loss, scope drift, weak execution discipline, and poor re-entry after breaks.

**North-star behavior**: A builder opens their repo, runs Scrimble, gets one clear next step, executes it, and keeps moving until the project is finished.

---

## Hard Constraints

1. **Cloudflare-only backend** — All infrastructure on Cloudflare
2. **CLI-first** — Terminal is the primary interface
3. **Repo-native** — Lives in `.scrimble/` directory
4. **User's own AI provider** — OpenAI, Anthropic, OpenRouter, GitHub Copilot, etc.
5. **Single-user, single-repo** — No team features in V1

---

## Recommended Technology Stack

### CLI Layer (Local)

| Component | Recommendation | Rationale |
|-----------|---------------|-----------|
| **CLI Framework** | **oclif** (Salesforce Open CLI Framework) | Battle-tested by Heroku CLI, Salesforce CLI, Cloudflare Wrangler. Plugin architecture, TypeScript-native, auto-generated help, excellent testing support. |
| **UI Components** | **Ink** (React for CLI) | Used by Claude Code, Gemini CLI, GitHub Copilot CLI, Cloudflare Wrangler. Rich interactive UIs, familiar React paradigm, flexbox layouts. |
| **Language** | **TypeScript** | Type safety, great DX, same language as backend Workers. |
| **Package Manager** | **pnpm** | Fast, efficient disk space, excellent monorepo support. |
| **File Watching** | **chokidar** | Industry standard for file system watching (resident mode). |

### AI Provider Abstraction

| Component | Recommendation | Rationale |
|-----------|---------------|-----------|
| **AI SDK** | **Vercel AI SDK** | Unified API across 30+ providers (OpenAI, Anthropic, Google, OpenRouter, etc.). Streaming, tool calling, structured outputs. Provider-agnostic by design. |
| **Fallback** | Direct provider SDKs | For edge cases where AI SDK doesn't cover a provider. |

**Why Vercel AI SDK for multi-provider support:**
```typescript
// Same code, different providers
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

// User configures once, code works everywhere
const model = getConfiguredModel(); // Returns openai('gpt-4') or anthropic('claude-3') etc.
const result = await generateText({ model, prompt: '...' });
```

### Backend Layer (Cloudflare)

| Component | Service | Purpose |
|-----------|---------|---------|
| **API** | **Cloudflare Workers** | Serverless API endpoints, fast cold starts |
| **Database** | **Cloudflare D1** | SQLite-compatible, serverless SQL for project/plan state |
| **File Storage** | **Cloudflare R2** | Large artifact storage (architecture docs, research) |
| **Long-running Jobs** | **Cloudflare Workflows** | Generation, replanning (durable execution with retries) |
| **AI Gateway** | **Cloudflare AI Gateway** | Optional proxy for caching, rate limiting, observability |
| **Auth Sessions** | **Workers KV** | Session token storage with TTL |
| **Real-time Events** | **Durable Objects** | WebSocket connections for live progress updates |

### Authentication Strategy

| Method | Use Case |
|--------|----------|
| **Device Code Flow (OAuth 2.0)** | Primary auth — browser-based login, CLI receives token |
| **API Key** | Alternative for advanced users / CI environments |
| **Session Tokens** | Short-lived JWTs stored locally, refreshable |

---

## Repository Structure

```
scrimble/
├── apps/
│   └── cli/                    # CLI application (oclif + Ink)
│       ├── src/
│       │   ├── commands/       # oclif commands
│       │   │   ├── init.ts
│       │   │   ├── import.ts
│       │   │   ├── index.ts    # Default command (show current chunk)
│       │   │   ├── prompt.ts
│       │   │   ├── verify.ts
│       │   │   ├── done.ts
│       │   │   ├── status.ts
│       │   │   ├── next.ts
│       │   │   ├── skip.ts
│       │   │   ├── update.ts
│       │   │   ├── replan.ts
│       │   │   ├── sync.ts
│       │   │   ├── doctor.ts
│       │   │   ├── watch.ts    # Resident proactive mode
│       │   │   └── logout.ts
│       │   ├── components/     # Ink React components
│       │   │   ├── ChunkDisplay.tsx
│       │   │   ├── PromptView.tsx
│       │   │   ├── VerificationResult.tsx
│       │   │   ├── StatusBar.tsx
│       │   │   └── Progress.tsx
│       │   ├── lib/
│       │   │   ├── ai/         # AI provider abstraction
│       │   │   │   ├── provider.ts
│       │   │   │   └── prompts/
│       │   │   ├── auth/       # Authentication
│       │   │   ├── config/     # Configuration management
│       │   │   ├── local/      # .scrimble/ management
│       │   │   ├── api/        # Backend client
│       │   │   ├── repo/       # Repository analysis
│       │   │   ├── verify/     # Verification engine
│       │   │   └── watch/      # File watching for resident mode
│       │   └── hooks/          # oclif lifecycle hooks
│       ├── bin/
│       │   ├── run.js          # Development entry
│       │   └── run.cmd         # Windows entry
│       └── package.json
│
├── apps/
│   └── api/                    # Cloudflare Workers backend
│       ├── src/
│       │   ├── index.ts        # Worker entry
│       │   ├── routes/
│       │   │   ├── auth.ts
│       │   │   ├── projects.ts
│       │   │   ├── generations.ts
│       │   │   ├── chunks.ts
│       │   │   └── events.ts
│       │   ├── workflows/
│       │   │   ├── generation.ts    # Architecture + chunk generation
│       │   │   └── replan.ts        # Replan workflow
│       │   ├── lib/
│       │   │   ├── db.ts            # D1 helpers
│       │   │   ├── storage.ts       # R2 helpers
│       │   │   └── session.ts       # Session management
│       │   └── types/
│       ├── wrangler.toml
│       └── package.json
│
├── packages/
│   ├── shared/                 # Shared types and utilities
│   │   ├── src/
│   │   │   ├── types/          # API contracts, entities
│   │   │   ├── schemas/        # Zod schemas for validation
│   │   │   └── constants/
│   │   └── package.json
│   └── db/                     # Database schema and migrations
│       ├── migrations/
│       └── package.json
│
├── pnpm-workspace.yaml
├── turbo.json                  # Turborepo for monorepo builds
└── package.json
```

---

## Local `.scrimble/` Structure

```
.scrimble/
├── config.json              # User/project settings
├── project.json             # Project identity, cloud link
├── plan.json                # Current execution plan
├── current-chunk.md         # Active chunk (human-readable)
├── architecture.md          # Generated architecture
├── research-summary.md      # Research findings
├── activity.log             # Local activity history
├── session.json             # Auth session (gitignored)
├── verification/
│   └── latest.json          # Most recent verification result
├── prompts/
│   ├── chunk-001.md         # Historical prompts
│   └── chunk-002.md
└── rules/
    └── agent-context.md     # Context for coding agents
```

---

## Database Schema (D1)

```sql
-- Users (linked to auth provider)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Projects
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  repo_url TEXT,
  goal TEXT,
  status TEXT DEFAULT 'active', -- active, paused, completed, abandoned
  current_chunk_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Plan revisions (immutable snapshots)
CREATE TABLE plan_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL,
  plan_data TEXT NOT NULL, -- JSON blob of full plan
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, version)
);

-- Chunks
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  plan_revision_id TEXT NOT NULL REFERENCES plan_revisions(id),
  sequence INTEGER NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  done_condition TEXT NOT NULL,
  do_not_touch TEXT,
  verification_hints TEXT,
  status TEXT DEFAULT 'pending', -- pending, active, completed, skipped
  completed_at TEXT,
  skip_reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Generation runs
CREATE TABLE generation_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL, -- 'initial', 'replan', 'update'
  status TEXT DEFAULT 'pending', -- pending, running, completed, failed
  input_data TEXT, -- JSON: user input, context
  output_data TEXT, -- JSON: generated artifacts
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Events (audit trail)
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL, -- 'chunk_completed', 'verification_passed', 'replan', etc.
  data TEXT, -- JSON payload
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- CLI Sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT UNIQUE NOT NULL,
  device_name TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

---

## AI Provider Configuration

Users configure their AI provider in `.scrimble/config.json`:

```json
{
  "ai": {
    "provider": "openai",           // openai | anthropic | openrouter | google | azure | github-copilot
    "model": "gpt-4o",              // Model ID
    "apiKey": "${OPENAI_API_KEY}",  // Env var reference
    "baseUrl": null,                // Custom endpoint (for OpenRouter, Azure, etc.)
    "options": {
      "temperature": 0.7,
      "maxTokens": 4096
    }
  }
}
```

**Supported providers via Vercel AI SDK:**
- OpenAI (GPT-4, GPT-4o, etc.)
- Anthropic (Claude 3.5, Claude 4, etc.)
- Google (Gemini Pro, Gemini Flash)
- OpenRouter (any model on their platform)
- Azure OpenAI
- Groq, Together AI, Fireworks, etc.

**For GitHub Copilot:**
- Users can route through OpenRouter's GitHub provider
- Or use local Copilot tokens if available

---

## Implementation Phases

### Phase 1 — CLI Foundation
**Goal**: Working CLI skeleton with auth and local state

- [ ] `p1-1` Monorepo setup (pnpm + Turborepo)
- [ ] `p1-2` oclif CLI scaffold with TypeScript
- [ ] `p1-3` Ink component foundation
- [ ] `p1-4` `.scrimble/` local state management
- [ ] `p1-5` Configuration system (config.json)
- [ ] `p1-6` Repository analysis utilities
- [ ] `p1-7` Cloudflare Workers API scaffold
- [ ] `p1-8` D1 database schema + migrations
- [ ] `p1-9` Device code auth flow
- [ ] `p1-10` `scrimble init` command
- [ ] `p1-11` `scrimble doctor` command
- [ ] `p1-12` `scrimble logout` command

### Phase 2 — Generation Core
**Goal**: Generate architecture and first chunks

- [ ] `p2-1` AI provider abstraction (Vercel AI SDK integration)
- [ ] `p2-2` Prompt templates for architecture synthesis
- [ ] `p2-3` Prompt templates for chunk planning
- [ ] `p2-4` Cloudflare Workflow for generation
- [ ] `p2-5` R2 storage for large artifacts
- [ ] `p2-6` Generation progress streaming (Durable Objects)
- [ ] `p2-7` Architecture approval flow (CLI)
- [ ] `p2-8` `scrimble import` command (existing repos)

### Phase 3 — Execution Loop
**Goal**: Daily workflow working end-to-end

- [ ] `p3-1` Default `scrimble` command (show current chunk)
- [ ] `p3-2` `scrimble prompt` command
- [ ] `p3-3` Verification engine (local checks)
- [ ] `p3-4` `scrimble verify` command
- [ ] `p3-5` `scrimble done` command
- [ ] `p3-6` `scrimble status` command
- [ ] `p3-7` `scrimble next` command
- [ ] `p3-8` `scrimble skip` command
- [ ] `p3-9` Chunk progression sync

### Phase 4 — Updates and Recovery
**Goal**: Plan evolution and error recovery

- [ ] `p4-1` `scrimble update` command
- [ ] `p4-2` `scrimble replan` command
- [ ] `p4-3` Replan workflow (preserves completed work)
- [ ] `p4-4` `scrimble sync` command
- [ ] `p4-5` Stale state detection
- [ ] `p4-6` Conflict resolution flows

### Phase 5 — Proactive + Hardening
**Goal**: Resident mode and production readiness

- [ ] `p5-1` File watching infrastructure
- [ ] `p5-2` `scrimble watch` command (resident mode)
- [ ] `p5-3` Proactive triggers (completion detection)
- [ ] `p5-4` Proactive notifications (terminal alerts)
- [ ] `p5-5` Quiet/pause controls
- [ ] `p5-6` Observability (telemetry)
- [ ] `p5-7` Security hardening
- [ ] `p5-8` Performance tuning

---

## Key Architecture Decisions

### 1. Why oclif over Commander.js?
- Plugin architecture for extensibility
- Auto-generated help and man pages
- Built-in testing utilities
- Used by production CLIs (Heroku, Salesforce, Cloudflare)
- Better structure for 15+ commands

### 2. Why Ink for terminal UI?
- React paradigm familiar to most developers
- Used by Claude Code, Gemini CLI, GitHub Copilot CLI
- Rich component ecosystem
- Interactive elements (spinners, progress, prompts)
- Flexbox layouts for complex displays

### 3. Why Vercel AI SDK for multi-provider?
- Single unified API across providers
- Streaming, tool calling, structured outputs built-in
- Active maintenance, wide provider support
- Type-safe with TypeScript
- Easy to add new providers

### 4. Why Cloudflare Workflows over Durable Objects for generation?
- Automatic retries and error handling
- Built for long-running operations (minutes to hours)
- Step-based execution with persistence
- Better fit for generation/replan jobs

### 5. Why D1 over KV for project state?
- Relational data (projects → chunks → events)
- Complex queries (find next chunk, event history)
- SQL semantics familiar to developers
- Time Travel for point-in-time recovery

### 6. Local-first with cloud sync
- CLI reads from `.scrimble/` for instant response
- Background sync to cloud for durability
- Conflict detection when local/cloud diverge
- Cloud is authoritative for cross-device scenarios

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| AI provider rate limits | Cloudflare AI Gateway caching + rate limiting |
| Long generation times | Workflows with progress streaming |
| Network failures | Local-first design, offline-capable for reads |
| Token expiration | Auto-refresh with device code flow |
| Large context windows | Chunked prompts, R2 for large artifacts |
| Provider API changes | Vercel AI SDK abstracts provider specifics |

---

## Success Metrics (Phase 1)

- [ ] `scrimble init` works in any Node.js project
- [ ] Auth flow completes in < 30 seconds
- [ ] `.scrimble/` created with valid structure
- [ ] `scrimble doctor` validates setup
- [ ] Backend deployed to Cloudflare

---

## Next Steps

1. **Confirm stack choices** — Review recommendations above
2. **Initialize monorepo** — pnpm + Turborepo
3. **Scaffold CLI** — oclif generate
4. **Set up Cloudflare** — Workers + D1 + R2
5. **Build Phase 1** — Foundation commands

---

*Plan created: 2026-04-05*

---

## Progress Update (2026-04-05)

### Completed foundation work
- Monorepo setup (pnpm workspace + turbo).
- CLI scaffold with working `init`, `doctor`, `status`, `logout`.
- OAuth device flow login command (`scrimble login`) with session persistence.
- Shared types/schemas package and D1 initial migration.
- API scaffold on Cloudflare Workers + Hono.
- Ink component foundation files created in `apps/cli/src/components/`.

### AI provider abstraction delivered
- Added provider factory in `apps/cli/src/lib/ai/provider.ts`.
- Added config loader with env interpolation in `apps/cli/src/lib/config/load-config.ts`.
- `scrimble init` now supports `--ai-provider` and `--ai-model`.
- Added first-class support for **GitHub Copilot subscriptions** via:
  - `provider: "github-copilot"`
  - `apiKey: "${GITHUB_COPILOT_TOKEN}"`
  - `baseUrl: "https://api.githubcopilot.com"`

### Prompt templates delivered
- Added architecture synthesis prompt template in `apps/cli/src/lib/ai/prompts/architecture.ts`.
- Added chunk planning prompt template in `apps/cli/src/lib/ai/prompts/chunk-planning.ts`.
- Prompt templates enforce the PRD mandatory prompt contract sections.

### R2 artifact storage delivered
- Added storage helper in `apps/api/src/lib/storage.ts`.
- Added API routes for artifact create/read/list under `/v1/artifacts*`.

### Workflow surfaces expanded
- Added generation workflow start/status routes under `/v1/generation/*`.
- Added replan workflow scaffold in `apps/api/src/workflows/replan-workflow.ts`.
- Added replan workflow start/status routes under `/v1/replan/*`.
- Added `REPLAN_WORKFLOW` binding in `apps/api/wrangler.toml`.

### Generation progress streaming delivered
- Added `GenerationProgressHub` Durable Object for progress event fanout and retention.
- Generation workflow now publishes stage updates to progress hub during execution.
- Added progress APIs:
  - `GET /v1/generation/:id/progress` (poll/backfill events)
  - `GET /v1/generation/:id/stream` (SSE stream)

### Plan artifacts saved in repo for agent handoff
- `docs/plans/master-plan.md` (full architecture/implementation plan copy)
- `docs/plans/agent-handoff.md` (current state, decisions, and next steps)

### Execution loop and recovery delivered
- Added architecture approval flow via `scrimble approve`.
- Added import/re-entry/navigation commands:
  - `scrimble import`, `scrimble prompt`, `scrimble next`, `scrimble skip`
  - enhanced default `scrimble` and `scrimble status`
- Added completion sync semantics:
  - `scrimble done` now records completion sync events and performs optional immediate cloud sync.
- Added plan evolution + integrity commands:
  - `scrimble update`, `scrimble replan`, `scrimble sync`
  - stale-state checks in `status`/`doctor`
  - conflict resolution strategy in `sync` (`manual|local|cloud`)

### Proactive mode + hardening delivered
- `scrimble watch` now evaluates proactive triggers and emits suggested next actions with confidence.
- Added proactive notifications + alert throttling + pause/resume controls.
- Added observability telemetry stream in `.scrimble/telemetry.ndjson`.
- Added security helper for sensitive local JSON writes (session/config paths).
- Added verification performance tuning by parallelizing local checks.

### Roadmap completion status
- All SQL-tracked roadmap todos (`p1-*` through `p5-*`) are marked **done**.

### Post-completion runtime hardening
- Removed oclif startup warning path by moving default command implementation from `index` to hidden `root` command.
- Updated CLI build script to `tsc -b --force` to ensure dist artifacts are emitted even after no-emit lint passes.
