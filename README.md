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
| `scrimble import` | Adopt an existing repo and generate a reality-based chunk plan |
| `scrimble login` | Authenticate using OAuth device flow |
| `scrimble approve` | Approve/reject architecture before execution |
| `scrimble` | Show active chunk context and quick actions |
| `scrimble prompt` | Print the raw active-chunk prompt |
| `scrimble verify` | Run local verification checks |
| `scrimble done` | Complete current chunk and sync completion event |
| `scrimble doctor` | Check configuration and health |
| `scrimble status` | Show project status and progress |
| `scrimble next` | Preview or activate next pending chunk |
| `scrimble skip` | Skip active chunk with risk acknowledgement |
| `scrimble update` | Apply targeted plan updates |
| `scrimble replan` | Rebuild remaining plan while preserving completed chunks |
| `scrimble sync` | Reconcile local/cloud state and resolve conflicts |
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

Use device login for a local CLI session:

```bash
# default custom provider (from .scrimble/config.json auth block)
node apps/cli/bin/run.js login

# GitHub OAuth device flow
node apps/cli/bin/run.js login --provider github --client-id <oauth-client-id>
```

## License

MIT
