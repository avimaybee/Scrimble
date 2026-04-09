# Scrimble Product Guidelines

## Core Principles
- **Transparency First:** All actions, plans, and state changes must be clearly reported to the user.
- **Local Sovereignty:** Prefer local processing and storage; respect user's data privacy and local-first workflow.
- **Calm Execution:** Avoid flashing or overwhelming UIs; focus on providing calm, structured feedback through the CLI.
- **Verifiability:** Ensure every step in a plan can be independently verified.

## UX & UI Guidelines (CLI)
- **Clear Information Hierarchy:** Use consistent formatting (e.g., bolding, colors, indentation) to distinguish between headings, tasks, and status information.
- **Incremental Feedback:** Provide progress updates during long-running tasks to keep the user informed.
- **Interaction Modes:** Respect the user's preferred interaction level (`guide`, `balanced`, `operator`) across all commands.
- **Error Messages:** Provide actionable, descriptive error messages that guide the user toward a resolution.

## Branding & Voice
- **Voice:** Professional, calm, and technically competent.
- **Tone:** Encouraging and assistive, not overbearing or intrusive.
- **Branding:** Focus on functionality and clarity over flashy visuals.

## Code & Implementation Standards
- **Type Safety:** Maintain 100% TypeScript type coverage across the monorepo.
- **Testing:** Every new feature or bug fix must include corresponding Vitest tests.
- **Documentation:** All public APIs and CLI commands must be thoroughly documented in the `README.md` or dedicated docs.
