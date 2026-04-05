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
| `scrimble doctor` | Check configuration and health |
| `scrimble status` | Show project status and progress |
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

## License

MIT
