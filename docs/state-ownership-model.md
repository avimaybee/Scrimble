# Scrimble State Ownership Model

This document defines the canonical ownership for every state source in the Scrimble codebase.
It is the output of task **A1: Freeze the current state vocabulary**.

## State Classification

Every state value in Scrimble belongs to exactly one of these four categories:

| Category | Description | Persistence | Example |
|----------|-------------|-------------|---------|
| **Durable Project State** | Persistent facts about the project that survive restarts | D1 Database | `projects.current_generation_run_id`, `steps.status` |
| **Workflow Runtime State** | Current execution state of a generation run | Durable Workflows + heartbeat | `GenerationRunStatus`, `generation_runs.heartbeat_at` |
| **Transient Stream State** | Events flowing through SSE that are replayed from checkpoints | R2 Checkpoints + D1 Events | `batch_start`, `activity`, `thinking` |
| **UI-Only State** | Browser-local hints that do not affect server truth | localStorage / React state | `ACTIVE_GENERATION_STORAGE_KEY`, component state |

---

## Durable Project State

These fields are the durable source of truth for project metadata. Runtime lifecycle lives in `generation_runs`.

### `projects.status`
- **Owner:** Project CRUD endpoints in `app.ts`
- **Type:** `'active' | 'completed' | 'archived'`
- **Purpose:** Overall project lifecycle (independent of generation)
- **Not Used By:** Generation pipeline

### `projects.current_generation_run_id`
- **Owner:** `createGenerationRun()` in `generation-runtime.ts`
- **Type:** UUID string (foreign key to `generation_runs.id`)
- **Purpose:** Canonical pointer from project to active/most-recent run

### `steps.status`
- **Owner:** Step status update endpoints, generation pipeline
- **Type:** `StepStatus`
- **Values:** `locked`, `active`, `waiting`, `complete`, `skipped`, `needs_review`, `agent_working`
- **Transitions:** Controlled by plan mutation service

### `steps.is_gate`
- **Owner:** Plan generation (batch 4), manual editing
- **Type:** Boolean
- **Purpose:** Mark steps that require human approval before downstream continues

### `checklist_items.is_completed`
- **Owner:** Checklist toggle endpoint
- **Type:** Boolean + timestamp
- **Purpose:** Track completion of individual checklist items within a step

### `agent_runs` (batch completion)
- **Owner:** Pipeline batch completion handlers
- **Query:** `SELECT run_type FROM agent_runs WHERE project_id = ? AND status = 'complete'`
- **Purpose:** Track which batches have completed successfully
- **Used By:** `resolvePipelineStatusToRun()` for resume logic

### `generation_runs`
- **Owner:** `generation-runtime.ts` service
- **Purpose:** Canonical source of truth for generation run state (separates runtime from project metadata)
- **Fields:**
  - `id`: UUID of the run
  - `project_id`: Foreign key to projects
  - `status`: `GenerationRunStatus` — `queued`, `running`, `awaiting_review`, `approved`, `complete`, `failed`, `cancelled`
  - `current_batch`: Current batch being executed (e.g., `batch_2_fetch_and_read`)
  - `workflow_instance_id`: Workflow instance identifier
  - `provider_id`: Provider used for the run
  - `started_at`, `completed_at`: Timestamps
  - `heartbeat_at`: Last activity timestamp
  - `error_message`: Error details if failed
- **Migration:** `021_generation_runtime.sql`
- **Legacy Mirrors Removed:** `023_drop_legacy_project_generation_columns.sql`

---

## Workflow Runtime State

These values exist only during active execution and are managed by the Durable Workflow platform.

### `WorkflowInstanceStatus`
- **Owner:** Cloudflare Durable Workflows platform
- **Type:** `queued`, `running`, `paused`, `errored`, `terminated`, `complete`, `waiting`, `waitingForPause`, `unknown`
- **Readers:** Workflow service, status polling
- **Not Persisted:** Only available via workflow API calls

### Active Generation Detection
- **Computed From:** `generation_runs.status`
- **Definition:** `status` in `queued | running | approved`
- **Note:** `awaiting_review` is not active (human gate)

### Stale Execution Detection
- **Computed From:** `generation_runs.status` + `generation_runs.heartbeat_at`
- **Function:** `getGenerationRuntimeState()` stale detection
- **Threshold:** 15 minutes (`GENERATION_STALE_MS`)
- **Response Field:** `execution_stale: boolean`

### Resume Ready Detection
- **Computed From:** runtime stale detection and queued age checks from canonical run
- **Function:** `getGenerationRuntimeState()` canResume computation
- **Threshold:** 2 minutes (`QUEUED_GENERATION_RESUME_MS`)
- **Response Field:** `can_resume: boolean`

---

## Transient Stream State

These events flow through SSE and are replayed from persisted checkpoints.

### Generation Events
- **Types:** `batch_start`, `activity`, `thinking`, `batch_complete`, `checkpoint`, `pipeline_complete`, `pipeline_failed`
- **Stored In:** `generation_events` table (D1) + R2 checkpoints for large payloads
- **Replay:** On SSE reconnection, events replay from `generation_events` table
- **Ownership:** `persistGenerationStreamEvent()` in `generation-events.ts`

### Batch Checkpoints
- **Stored In:** R2 bucket (`CHECKPOINT_BUCKET`)
- **Key Format:** `checkpoints/{projectId}/{runId}/{batchName}.json`
- **Contains:** Full batch output for resumption
- **Owner:** `storeJsonPayload()` / `loadJsonPayload()` in `checkpoint-storage.ts`

---

## UI-Only State

These values are convenience hints. They must never be treated as source of truth.

### `localStorage: scrimble_active_generation`
- **Owner:** `ProjectGeneration.tsx` and `Dashboard.tsx`
- **Type:** Project ID string
- **Purpose:** Help dashboard detect if user has an active generation in another tab
- **Truth Source:** Server status endpoint (not localStorage)
- **Rule:** Always verify against server before trusting

### `localStorage: scrimble-guide-${projectId}`
- **Owner:** `ProjectCanvas.tsx`
- **Type:** `'true'` string
- **Purpose:** Track if user has seen the canvas guide
- **No Server Impact:** Pure UX convenience

### `localStorage: scrimble_workspace_nudge_dismissed`
- **Owner:** `Dashboard.tsx`
- **Type:** `'1'` string
- **Purpose:** Track if user dismissed workspace setup nudge
- **No Server Impact:** Pure UX convenience

### React Component State
- **Location:** `ProjectGeneration.tsx`, `Dashboard.tsx`, `ProjectCanvas.tsx`
- **Examples:** `status`, `activeBatch`, `streamEvents`, `activityFeed`, `error`
- **Rule:** Always derived from server responses, never persisted

---

## Generation Status State Machine

```
┌─────────┐
│ intake  │
└────┬────┘
     │ confirm
     ▼
┌─────────┐
│ queued  │◄────────────────────────────────┐
└────┬────┘                                 │
     │ workflow starts                      │ resume
     ▼                                      │
┌──────────────────────┐                    │
│ batch_1_research_stack│                   │
└──────────┬───────────┘                    │
           │ complete                       │
           ▼                                │
┌──────────────────────┐                    │
│ batch_2_fetch_and_read│                   │
└──────────┬───────────┘                    │
           │ complete                       │
           ▼                                │
┌──────────────────────┐                    │
│ batch_3_architect     │                   │
└──────────┬───────────┘                    │
           │ complete                       │
           ▼                                │
┌─────────────────┐                         │
│ awaiting_review │ ◄─── HUMAN GATE         │
└────────┬────────┘                         │
         │ approve                          │
         ▼                                  │
┌──────────┐                                │
│ approved │                                │
└────┬─────┘                                │
     │ workflow resumes                     │
     ▼                                      │
┌──────────────────────┐                    │
│ batch_4_plan_build    │                   │
└──────────┬───────────┘                    │
           │ complete                       │
           ▼                                │
┌──────────────────────┐                    │
│ batch_5_enrich_steps  │                   │
└──────────┬───────────┘                    │
           │ complete                       │
           ▼                                │
┌────────────────────────┐                  │
│ batch_6_generate_files │                  │
└──────────┬─────────────┘                  │
           │ complete                       │
           ▼                                │
┌──────────┐                                │
│ complete │                                │
└──────────┘                                │
                                            │
    Any active status ──► failed ───────────┘
    Any active status ──► cancelled (terminal)
```

---

## Step Status State Machine

```
┌────────┐
│ locked │
└───┬────┘
    │ predecessor completes
    ▼
┌────────┐        ┌─────────┐
│ active │───────►│ waiting │ (blocked by gate)
└───┬────┘        └────┬────┘
    │                  │ gate approved
    │◄─────────────────┘
    │
    ├── user marks complete ──► complete
    │
    ├── user skips ──► skipped
    │
    ├── is_gate && complete ──► needs_review
    │
    └── agent working ──► agent_working
```

---

## Ownership Rules (Enforcement)

1. **One Writer Per State** — Each state field has exactly one canonical writer
2. **Server Is Truth** — UI state is always derived from server responses
3. **Heartbeat Tracks Liveness** — Only the running workflow touches heartbeat
4. **Checkpoints Enable Resume** — `resolvePipelineStatusToRun()` reads checkpoints, not status alone
5. **Events Are Replayable** — All stream events can be reconstructed from D1 + R2
6. **localStorage Is Hint Only** — Never block on localStorage; always verify server

---

## Migration Notes

This document reflects the current state. Tasks A2-A6 will refactor toward:

- **A2:** ✅ DONE - Created `generation_runs` table and `generation-runtime.ts` service
  - New table: `generation_runs` owns all runtime state for a generation execution
  - New service: `getGenerationRuntimeState()` is the canonical way to read runtime state
  - New types: `GenerationRun`, `GenerationRunStatus`, `GenerationRuntimeState`
  - Backward compatible: Legacy `projects` columns still updated for transition period
- **A3:** ✅ DONE - Normalized step content schema in `src/types.ts`
  - New types: `StepNavigationLink`, `StepPrompt`, `StepResearchFooterMeta`, `StepSuggestedTool`, `ParsedStepContent`
  - New parsers: `parseNavigationLinks()`, `parsePrompts()`, `parseResearchFooterMeta()`, `parseSuggestedTools()`, `parseStepContent()`
  - Updated `DetailPanel.tsx` to use centralized parsing functions
  - Removed duplicate parsing logic from components
- **A4:** Remove UI state guessing; make localStorage purely optional
- **A5:** Consolidate all plan mutations behind a single write service
- **A6:** Clean up deprecated columns after new writers are live

---

*Generated as part of the Scrimble Repair Dependency Plan, Task A1.*
