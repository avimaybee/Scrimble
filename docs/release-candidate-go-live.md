# Production Go-Live Runbook (Phase 14F Release Closeout)

This runbook is the production release contract for the reliability-hardening rollout. There is no separate staging stack. Release safety comes from local preflight, paired runtime deployment, production smoke gates, and a short monitoring window.

## Release contract (current reality)

- Canonical database contract is `migrations/0026_full_canonical_rebuild.sql`.
- Do **not** treat `021 -> 023` replay as the current go-live path.
- Pages/API and `worker-consumer` are version-coupled and must be deployed together.
- Generation liveness is valid only after a real heartbeat or real generation event.

## Migration order (historical note)

The old `021 -> 023` migration order is retained only as historical context for prior release notes. It is **not** the active go-live path for this release.

## Deploy order (direct production)

1. Run local preflight and confirm all checks pass.
2. Take a production D1 backup/export before deployment.
3. Verify production bindings (`DB`, `CHECKPOINT_BUCKET`, `WORKFLOW_SERVICE`, `GENERATION_WORKFLOW`, auth config).
4. Deploy both runtimes together:
   - `npm run deploy:all`
   - or `npm run deploy` then `npm run deploy:consumer` in the same release window
5. Run immediate production smoke checks (first event, first heartbeat, status/stream coherence).
6. Run critical-flow and manual release gates.
7. Enter monitoring window and watch for blocker regressions.

## Deploy and migration order (current)

Deploy both runtimes first, then validate behavior against canonical `0026` schema state. Do not replay legacy migration chains during this rollout.

## Rollback policy

- Roll back code first (Pages and consumer together).
- Do not edit applied migration files.
- Use a forward-fix migration only if a **new** production schema defect appears.
- Do not replay obsolete migration sequences as a rollback strategy.

## Automated preflight validation suite

Run immediately before deployment:

- `npm run build`
- `npx tsc --noEmit`
- `npx tsx scripts/phase6-runtime-bridge.assertions.ts`
- `npx tsx scripts/phase8-plan-authorship.assertions.ts`
- `npx tsx scripts/phase9-event-model.assertions.ts`
- `npx tsx scripts/phase9-runtime-validation.assertions.ts`
- `npx tsx scripts/phase10-generation-session.assertions.ts`
- `npx tsx scripts/phase11-workspace-surfaces.assertions.ts`
- `npx tsx scripts/phase12-research-thinking-verification.assertions.ts`
- `npx tsx scripts/phase13-release-candidate.assertions.ts`
- `npx tsx scripts/phase14d-canonical-rebuild.assertions.ts`
- `npx tsx scripts/phase14e-reliability-hardening.assertions.ts`

## Production smoke gate (release blockers)

Record pass/fail and blocker notes for each:

- start intake
- confirm intake
- verify generation starts
- verify first live event arrives
- verify first heartbeat arrives
- verify no false "last runner signal" before heartbeat/event
- verify Batch 2 no longer fails on undefined heartbeat binding
- cancel generation, then resume generation
- reopen dashboard and confirm runtime state remains coherent
- verify settings model-role save/load

## RC checklist (critical flows)

- Google sign-in
- new project intake
- generation start and live transcript/activity
- cancel/resume
- dashboard re-entry coherence
- settings model-role save/load

## Manual release gates

- Google sign-in
- new project intake
- review/approval path (if reachable)
- cancel/resume
- mobile-width sanity on Dashboard, Project Generation, Project Canvas, Detail Panel, and Settings
- one `100+` step benchmark

## Monitoring window (24-48 hours)

Watch logs/runtime for:

- repeated `pipeline_failed`
- non-terminal runs without real heartbeat/events
- protocol mismatch failures between Pages and consumer
- `D1_ERROR` regressions from runtime/schema contract drift

If a severe issue appears:

1. Roll back app code first (paired runtimes).
2. Preserve diagnostics and run IDs.
3. Apply forward-fix migration only when schema-level repair is required.

## Go/No-Go criteria

Go-live is allowed only if all are true:

- local preflight suite passed
- production backup/export completed
- paired deployment completed
- production smoke gate passed
- critical-flow and manual release gates passed (or documented non-blocking exceptions)
- monitoring window starts with no release blockers

If any blocker fails, release is no-go until fixed.
