# Production Go-Live Runbook (Phase 14 Direct Rollout)

This runbook is the direct production rollout contract for the hobby release. There is no separate staging stack, so rollout discipline is enforced through local preflight, production backup, ordered deploy/migrate steps, live verification, and a short monitoring window.

## Migration order

1. `021_generation_runtime.sql`
2. `022_agent_runs_run_id.sql`
3. `023_drop_legacy_project_generation_columns.sql`

## Deploy and migration order (direct production)

1. Run local preflight suite and ensure all checks pass.
2. Take a production D1 backup/export before any migration is applied.
3. Verify production bindings are intact (`DB`, `CHECKPOINT_BUCKET`, `WORKFLOW_SERVICE`, `GENERATION_WORKFLOW`, auth config).
4. Deploy application code:
   - `npm run deploy`
   - `npm run deploy:consumer`
   - or `npm run deploy:all`
5. Apply production migrations one-by-one in exact order (`021` -> `022` -> `023`), without batching or reordering.
6. Run immediate post-migration live verification (boot/auth/status/stream/post-`023` checks).
7. Run production bug-bash checklist, mobile-width sanity checks, and one heavy-project benchmark.
8. Enter a 24-48 hour monitoring window before declaring rollout closed.

## Rollback playbook

### 021_generation_runtime.sql

- Trigger condition: runtime status endpoints fail or `generation_runs` lifecycle updates drift from expected state.
- Failure detection: `/api/projects/:id/status` cannot resolve canonical `generation_runtime`, run linkage errors, or lifecycle stalls.
- Rollback type: application rollback first; schema rollback only if migration was not applied cleanly and data integrity is preserved.
- Data risk: partial run lifecycle data in `generation_runs` and stale `current_generation_run_id` pointers.

### 022_agent_runs_run_id.sql

- Trigger condition: resume/recovery queries fail to scope batch history by run.
- Failure detection: recovery path loads wrong batch outputs or resume target mismatch.
- Rollback type: application rollback preferred; schema rollback optional if column/index creation caused runtime errors.
- Data risk: null/incorrect `run_id` on new `agent_runs` rows during rollout window.

### 023_drop_legacy_project_generation_columns.sql

- Trigger condition: any runtime query still references removed legacy project lifecycle columns.
- Failure detection: SQL errors after migration (`no such column: generation_status`, etc.) or post-migration API failures.
- Rollback type: app rollback plus forward-fix migration (do not mutate applied migration files).
- Data risk: low for project facts, medium for release timing if post-`023` queries are not runtime-native.

## Automated preflight validation suite

Run immediately before deployment:

- `npm run lint`
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

## RC checklist (critical flows)

Record for each flow: pass/fail, environment, timestamp, blocker notes.

- Google sign-in
- New project intake
- Generation start
- Live generation activity
- Architecture review approve
- Failed -> resume
- Cancelled -> resume
- Dashboard re-entry
- Settings readiness recovery
- Guided canvas navigation
- Detail-panel execution flow

Pass criteria: each flow completes without manual DB edits, route-reload hacks, or hidden recovery steps.

## Immediate post-migration verification

- Live app boots and authenticated navigation works.
- `/api/projects/:id/status` returns canonical `generation_runtime`.
- `/api/projects/:id/generation-stream` connects and emits canonical versioned envelope events.
- Thinking replay returns bounded recent events only for active runs.
- Post-`023`, no runtime reference to removed legacy project lifecycle columns appears in logs/errors.
- Project screens load via `generation_runs` + `projects.current_generation_run_id`.

Treat any SQL/runtime error after `023` as a release blocker.

## Observability policy

### Must log

- `projectId`
- `runId`
- `batch`
- `failureClass`
- `eventType`

### Never log

- API keys, tokens, decrypted provider credentials
- raw encrypted secret blobs
- full user private input that is not required for diagnostics

### Severity expectations

- `warning`: degraded tool access, reconnect/replay hiccups, recoverable retries.
- `error`: run failures, checkpoint corruption, lifecycle transition violations.
- `fatal`: migration failure that blocks core flows or breaks runtime contract integrity.

## Operator runbook

### Identify failed migration

1. Check migration execution logs and SQL error output.
2. Confirm schema shape (`projects` has only `current_generation_run_id` for runtime linkage post-`023`).
3. Validate `/api/projects/:id/status` and `/api/projects/:id/generation-stream` on production.

### Identify stuck generation run

1. Query `generation_runs` for stale `heartbeat_at` while status is non-terminal.
2. Check recent `project_generation_events` for missing `batch_complete` progression.
3. Resume from checkpoint and verify status transitions back to `queued`/`running`.

### Identify degraded research tooling

1. Inspect review payload `degraded_tools` and `partial_failures`.
2. Check activity feed events for Context7/Brave/GitHub tool failures.
3. Validate fallback path keeps user messaging honest and actionable.

### Identify broken auth/setup paths

1. Verify Google sign-in on `/login`.
2. Verify settings load for AI providers, model roles, and research connectors.
3. Confirm readiness model updates and next-actions render correctly.

## Go/no-go criteria

Go-live is allowed only if all are true:

- local preflight validation suite passed
- production D1 backup/export completed before migrations
- production deploy completed (`deploy` + `deploy:consumer` or `deploy:all`)
- production migrations succeeded in sequence (`021` -> `022` -> `023`)
- immediate post-migration verification passed, including post-`023` checks
- critical-flow bug-bash passed
- no blocking mobile issues remain
- no blocking large-project performance issue remains
- no runtime reference to dropped legacy columns remains
- operator runbook exists and is current
- docs/status are reconciled with shipped behavior
- short monitoring window completed with no release blockers

If any item fails, production push is blocked (no-go).

## Monitoring window (24-48 hours)

Watch logs/runtime state for:

- migration errors or failed follow-up queries
- non-terminal `generation_runs` with stale heartbeat
- repeated `pipeline_failed` or lifecycle transition violations
- repeated degraded research/tool failures across runs

If a severe issue appears:

1. Roll back app deploy first.
2. Do not edit applied migration files.
3. Use a forward-fix migration only for schema-level repair.
