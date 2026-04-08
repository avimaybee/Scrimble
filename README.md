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
│   └── api/                    # Legacy backend package (not required for local-first CLI flows)
│       └── src/                # API routes and handlers
├── packages/
│   ├── shared/                 # Shared types and schemas
│   └── db/                     # Legacy DB package
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
| `scrimble login` | Compatibility shim: Scrimble is local-first and has no product login |
| `scrimble approve` | Approve a track/task scope for autonomous execution |
| `scrimble` | Run local onboarding checks, then show runtime overview and next action |
| `scrimble run` | Execute native ledger tasks with worker routing (`--worker auto|gemini|copilot`) |
| `scrimble workers` | Show Gemini/Copilot worker preflight health and capabilities |
| `scrimble assign` | Manually assign a pending ledger task to a worker |
| `scrimble retry` | Reset a failed/blocked ledger task back to pending |
| `scrimble conflicts` | Show blocked/conflicted tasks and lease conflicts |
| `scrimble prompt` | Print the current active task prompt |
| `scrimble verify` | Run local verification checks |
| `scrimble done` | Complete current task/chunk |
| `scrimble doctor` | Check local configuration and worker readiness |
| `scrimble status` | Show local intent, task graph progress, assignments, workers, and leases |
| `scrimble logs` | Show local runtime ledger events |
| `scrimble next` | Preview or activate next pending task |
| `scrimble skip` | Skip active task with risk acknowledgement |
| `scrimble update` | Apply targeted plan updates |
| `scrimble replan` | Local alias for `scrimble generate --replan` |
| `scrimble sync` | Compatibility shim: local-first mode has no Scrimble sync workflow |
| `scrimble watch` | Run proactive resident mode with alerts |
| `scrimble logout` | Compatibility shim: local-first mode has no Scrimble logout |

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

# Run CLI tests
pnpm --filter @scrimble/cli test
```

## Technology Stack

- **CLI**: oclif + TypeScript
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

## Local-first mode

Scrimble CLI is local-first for planning and orchestration: `.scrimble/` is the canonical state, and core command flows do not require Scrimble-owned network access. `login`, `logout`, and `sync` remain as compatibility shims that print migration guidance.

## License

MIT
