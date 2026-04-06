# Scrimble

> CLI-resident execution companion for solo AI-native builders

Scrimble helps you finish what you start by becoming a repo-native execution companion that:
- Understands current project reality
- Plans in sequenced chunks
- Constrains focus to one active chunk
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
| `scrimble generate` | Create a Conductor track from a goal (or use `--cloud` for legacy cloud generation) |
| `scrimble config set-ai` | Run the AI provider/model/key setup wizard |
| `scrimble login` | Authenticate using OAuth device flow |
| `scrimble approve` | Approve a Conductor track for autonomous execution |
| `scrimble` | Auto-run onboarding, then show Conductor runtime overview and next action |
| `scrimble prompt` | Print the current Conductor task prompt (legacy chunk prompt fallback) |
| `scrimble verify` | Run local verification checks |
| `scrimble done` | Complete current Conductor task (legacy chunk completion fallback) |
| `scrimble doctor` | Check configuration and health |
| `scrimble status` | Show project status and progress |
| `scrimble logs` | Show local runtime events first, then cloud execution/project events |
| `scrimble next` | Preview or activate next pending Conductor task |
| `scrimble skip` | Skip active Conductor task with risk acknowledgement |
| `scrimble update` | Apply targeted plan updates |
| `scrimble replan` | Rebuild remaining plan while preserving completed chunks |
| `scrimble sync` | Reconcile local/cloud plan state using canonical D1 registry |
| `scrimble watch` | Run proactive resident mode with alerts |
| `scrimble logout` | Clear local session |

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
