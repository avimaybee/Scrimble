# Scrimble

> CLI-resident execution companion for solo AI-native builders

Scrimble helps you finish what you start by acting as a calm, repo-native operator that:
- Understands your goal in plain language
- Checks setup and current progress automatically
- Proposes a short next-step plan before mutating work
- Executes through the local ledger runtime after confirmation
- Summarizes outcomes and what to do next

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
├── packages/
│   └── shared/                 # Shared types and schemas
├── docs/                       # Documentation
└── turbo.json                  # Turborepo configuration
```

## Conversational Entry

Scrimble now defaults to a conversation-first workflow:

```bash
# interactive operator shell (TTY)
scrimble

# one-shot request
scrimble --prompt "inspect current state and propose an execution plan"
scrimble "implement the next milestone"
```

In interactive TTY mode, `scrimble` launches a full-screen operator shell with a startup context panel, status strip, transcript, approval card, and bottom composer. One-shot and non-TTY usage stay text based.
For mutating requests, Scrimble selects one bounded next action, asks at policy boundaries, executes, observes the result, and loops until done, blocked, redirected, or paused. Runs are resumable: if a session ends mid-run, the next interactive launch can continue from the active run state (including pending approval boundaries).

## Interaction Modes

Scrimble stores a persistent interaction preference in `.scrimble/config.json`:

- `guide` (default): plan-first and confirmation-heavy
- `balanced`: plans automatically and confirms before execution
- `operator`: handles routine setup/planning automatically and pauses for higher-risk changes

If no config exists yet, Scrimble uses `guide` by default until you save your preferred mode in `.scrimble/config.json` (for example through `scrimble config set-ai`).

Permission checks are policy-based at action boundaries:
- read-only inspection/status actions run automatically
- setup/config changes pause unless explicitly confirmed
- task-graph updates follow your interaction mode
- conversational execution is always one bounded active task step (`parallel=1`, `maxTasks=1`)

## Visible Commands (Phase 1)

| Command | Description |
|---------|-------------|
| `scrimble` | Main conversational orchestrator (interactive operator shell in TTY, one-shot with `--prompt` or quoted request) |
| `scrimble init` | Initialize Scrimble in current repository |
| `scrimble config set-ai` | Launch provider setup studio (TTY) or apply profile flags non-interactively |
| `scrimble doctor` | Check local configuration and worker readiness |
| `scrimble logs` | Show local runtime ledger events |

Deprecated workflow commands are removed from the command surface. Invoking an old command prints migration guidance to use conversational `scrimble` requests.

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

## Default Conversational Output

By default, Scrimble reports in a human workflow shape:
1. **Understand** your goal
2. **Orient** with setup/progress context
3. **Choose** the next bounded action
4. **Confirm or proceed** based on interaction mode
5. **Report** what changed and what is next

Use `--verbose` to include technical tool-level detail.
At confirmation boundaries in interactive mode, you can also type a new direction to redirect orchestration mid-flight.

## Execution Safety Model

Scrimble runs one active executable task step at a time in the default operator path. Safety is enforced by task ownership scope: each task declares `ownedFiles`, and out-of-scope edits are treated as conflicts that block completion.

## Development

```bash
# Build shared package
pnpm --filter @scrimble/shared run build

# Build CLI
pnpm --filter scrimble run build

# Run CLI tests
pnpm --filter scrimble test
```

## Technology Stack

- **CLI**: oclif + TypeScript
- **AI**: Vercel AI SDK (multi-provider support)

## AI Provider Profiles

Scrimble now stores provider setup as profiles in `.scrimble/config.json`:

```json
{
  "activeProfileId": "openai-main",
  "profiles": [
    {
      "id": "openai-main",
      "name": "OpenAI Main",
      "provider": "openai",
      "modelStrategy": "explicit",
      "model": "gpt-4o",
      "auth": {
        "strategy": "api_key",
        "apiKey": "${OPENAI_API_KEY}"
      }
    }
  ]
}
```

GitHub Copilot subscription-backed profile example:

```json
{
  "activeProfileId": "copilot-main",
  "profiles": [
    {
      "id": "copilot-main",
      "name": "Copilot Main",
      "provider": "github-copilot",
      "modelStrategy": "auto",
      "auth": {
        "strategy": "copilot_login"
      }
    }
  ]
}
```

Copilot auth strategies:
- `copilot_login` (recommended interactive path)
- `env_token` (`COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`)
- `gh_cli` (GitHub CLI fallback)
- `personal_access_token` (advanced/manual)

Supported providers:
- OpenAI (GPT-4, GPT-4o, etc.)
- Anthropic (Claude 3.5, Claude 4)
- Google (Gemini Pro, Flash)
- OpenRouter (any model)
- GitHub Copilot subscriptions (via Copilot token)
- Azure OpenAI
- Groq, Together AI, etc.

## Local-first mode

Scrimble CLI is local-first for planning and orchestration: `.scrimble/` is the canonical state, and core command flows do not require Scrimble-owned network access.

## License

MIT
