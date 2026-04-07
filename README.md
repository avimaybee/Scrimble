# Scrimble

> CLI-resident execution companion for solo AI-native builders

Scrimble helps you finish what you start by becoming a repo-native execution companion that:
- Understands current project reality
- Captures intent and builds a native task graph
- Routes work to Gemini/Copilot workers
- Constrains execution by explicit file leases
- Verifies progress honestly
- Adapts as the project changes

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Run CLI (development)
node apps/cli/bin/run.js --help
```

## Repository Structure

```
scrimble/
├── apps/
│   ├── cli/                    # CLI application (oclif + TypeScript)
│   │   ├── src/commands/       # CLI commands
│   │   └── bin/                # Entry points
│   └── api/                    # Cloudflare Workers backend
│       └── src/                # API routes and handlers
├── packages/
│   ├── shared/                 # Shared types and schemas
│   └── db/                     # Database migrations
├── docs/                       # Documentation
└── turbo.json                  # Turborepo configuration
```

## Available Commands

| Command | Description |
|---------|-------------|
| `scrimble init` | Initialize Scrimble in current repository |
| `scrimble import` | Compatibility alias for `scrimble init` (brownfield adoption path) |
| `scrimble generate` | Generate a native task graph from captured intent and repo context |
| `scrimble config set-ai` | Run the AI provider/model/key setup wizard |
| `scrimble login` | Authenticate using OAuth device flow |
| `scrimble approve` | Approve a track/task scope for autonomous execution |
| `scrimble` | Auto-run onboarding, then show runtime overview and next action |
| `scrimble run` | Execute native ledger tasks with worker routing (`--worker auto|gemini|copilot`) |
| `scrimble workers` | Show Gemini/Copilot worker preflight health and capabilities |
| `scrimble assign` | Manually assign a pending ledger task to a worker |
| `scrimble retry` | Reset a failed/blocked ledger task back to pending |
| `scrimble conflicts` | Show blocked/conflicted tasks and lease conflicts |
| `scrimble prompt` | Print the current active task prompt |
| `scrimble verify` | Run local verification checks |
| `scrimble done` | Complete current task/chunk |
| `scrimble doctor` | Check configuration and health |
| `scrimble status` | Show project status and progress |
| `scrimble logs` | Show local runtime events first, then cloud execution/project events |
| `scrimble next` | Preview or activate next pending task |
| `scrimble skip` | Skip active task with risk acknowledgement |
| `scrimble update` | Apply targeted plan updates |
| `scrimble replan` | Rebuild remaining plan while preserving completed chunks |
| `scrimble sync` | Reconcile local/cloud plan state using canonical D1 registry |
| `scrimble watch` | Run proactive resident mode with alerts |
| `scrimble logout` | Clear local session |

## Native Ledger Runtime

Scrimble stores canonical orchestration state in `.scrimble/`:

```text
.scrimble/
  intent.json
  ledger.json
  runtime/
    workers.json
    attempts/
    events.ndjson
```

Provider artifacts (`GEMINI.md`, `AGENTS.md`, `.github/copilot/settings.json`, `conductor/`) are treated as supplemental context, not scheduler truth.

## Parallel Execution Safety (Experimental)

Parallel mode currently uses **single workspace + file lease ownership** and is considered experimental. Scrimble rejects parallel dispatch when ownership is missing or overlapping, and flags edits outside leased paths as conflicts requiring intervention.

## Development

```bash
# Build shared package
pnpm --filter @scrimble/shared run build

# Build CLI
pnpm --filter @scrimble/cli run build

# Run API locally (requires Cloudflare account)
pnpm --filter @scrimble/api run dev
```

## Technology Stack

- **CLI**: oclif + TypeScript
- **Backend**: Cloudflare Workers + Hono
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2
- **AI**: Vercel AI SDK (multi-provider support)

## AI Provider Configuration

Configure your AI provider in `.scrimble/config.json`:

```json
{
  "ai": {
    "provider": "openai",
    "model": "gpt-4o",
    "apiKey": "${OPENAI_API_KEY}"
  }
}
```

GitHub Copilot subscription example:

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

Supported providers:
- OpenAI (GPT-4, GPT-4o, etc.)
- Anthropic (Claude 3.5, Claude 4)
- Google (Gemini Pro, Flash)
- OpenRouter (any model)
- GitHub Copilot subscriptions (via Copilot token)
- Azure OpenAI
- Groq, Together AI, etc.

## Authentication

Cloud API routes under `/v1/*` require a bearer token managed by the CLI.

Run the login flow to authenticate your session:

```bash
# Start the standard OAuth device flow (Firebase-linked)
scrimble login
```

After login, `scrimble init --from-cloud` can bootstrap local project/plan state from the cloud registry.

## License

MIT
