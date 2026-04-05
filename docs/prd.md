# Scrimble — CLI-Resident Product Requirements Document
### Outcome-Driven, Cloudflare-Constrained, Repo-Native Rebuild
*Version 3.0 — April 2026*

---

## Read This First

This PRD defines Scrimble as a **pure CLI-first product** that lives inside the user’s terminal and repository.

This document is intentionally outcome-driven:

1. The product must run with **Cloudflare** as the backend platform boundary.
2. The implementation stack and architecture are **not pre-locked**.
3. Design choices must be justified by product fitness, not familiarity.

The north-star behavior is simple:

> A builder opens their repo, runs Scrimble, gets one clear next step, executes it, and keeps moving until the project is finished.

---

## 1. Product Thesis

Scrimble exists for solo AI-native builders who can start quickly but struggle to finish.

The core problem is not lack of tools; it is:

- context loss,
- scope drift,
- weak execution discipline,
- and poor re-entry after breaks.

Scrimble solves this by becoming a repo-native execution companion that:

1. understands current project reality,
2. plans in sequenced chunks,
3. constrains focus to one active chunk,
4. verifies progress honestly,
5. adapts as the project changes.

---

## 2. Hard Constraints

### 2.1 Platform Constraint
All backend/runtime infrastructure must remain on Cloudflare.

### 2.2 Product Constraint
The primary and daily interface is the CLI.

### 2.3 Workflow Constraint
Core workflow must function without requiring a persistent web dashboard.

### 2.4 Experience Constraint
Scrimble must live in the repo via local `.scrimble/` state and context artifacts.

### 2.5 Scope Constraint
V1 is single-user, single-repo oriented. Team collaboration is out of scope.

---

## 3. Non-Negotiable Product Principles

### 3.1 One Active Chunk
Exactly one chunk is executable at any time.

### 3.2 Prompt Quality Is the Product
If chunk prompts are generic or vague, Scrimble fails.

### 3.3 Repo-Native First
The repo and terminal are execution truth, not a browser.

### 3.4 Evidence Over Self-Report
Progress should be validated by observable evidence wherever possible.

### 3.5 Instant Re-Entry
Returning users should know what to do within seconds.

### 3.6 Cloud Supports Local Execution
Cloud state enables durability and continuity; local state powers daily speed.

### 3.7 Less Is a Feature
Anything not improving execution, verification, or re-entry should be removed.

---

## 4. Product Surfaces

## 4.1 CLI (Primary)
The CLI must support the entire core lifecycle:

- onboarding,
- repo analysis,
- intake clarification,
- architecture review,
- chunk delivery,
- verification,
- completion sync,
- updates/replan,
- recovery,
- daily re-entry.

## 4.2 Web (Secondary, Minimal)
A minimal web surface is allowed only when terminal UX is materially worse (for example bootstrap/auth setup or long artifact viewing). It must not become a daily dependency.

---

## 5. Proactive Terminal Behavior (Core Requirement)

Scrimble should not be passive only. It must support a proactive mode that tracks project evolution.

### 5.1 Required Modes
1. **On-demand mode** (`scrimble` commands).
2. **Resident mode** (for example `scrimble watch` / `scrimble live`) that keeps monitoring context while work progresses.

### 5.2 Proactive Triggers
Resident mode should detect and react to:

- repo changes relevant to current chunk,
- completion signals already satisfied,
- verification drift or stale evidence,
- dependency changes that invalidate future chunks,
- major divergence between plan and code reality.

### 5.3 Proactive Responses
Scrimble should proactively surface:

- concise next action,
- risk/warning notes,
- suggested command (`verify`, `done`, `update`, `replan`),
- confidence level when uncertainty is high.

### 5.4 Behavior Rules
- Never auto-apply destructive changes.
- Never spam; prioritize signal over noise.
- Always allow pause/quiet/disable of proactive mode.

---

## 6. Repo-Native Local Footprint

Scrimble must create and maintain a `.scrimble/` directory in repo root.

Required local artifacts (structure can evolve, purpose cannot):

```text
.scrimble/
  config.json
  project.json
  plan.json
  current-chunk.md
  architecture.md
  research-summary.md
  activity.log
  verification/
    latest.json
  prompts/
    chunk-001.md
    chunk-002.md
  rules/
    agent-context.md
```

### Local Artifact Expectations
- Human-readable by default.
- Safe to regenerate.
- Stable enough for re-entry.
- Explicitly separated between mutable state and archived history.

### Git Behavior
- Keep sensitive/session files out of source control.
- Keep useful execution context and prompt artifacts optionally trackable.

---

## 7. Functional Requirements

## 7.1 Initialization
`scrimble init` must:

1. detect repo context,
2. gather product goal,
3. infer existing stack signals,
4. ask only missing critical questions,
5. establish cloud-linked project state,
6. write local `.scrimble/` baseline.

## 7.2 Import Existing Project
`scrimble import` must adopt partially built repos and plan from current reality, not greenfield assumptions.

## 7.3 Current Chunk Delivery
`scrimble` (no subcommand) must show:

- project status,
- current chunk,
- exact prompt,
- do-not-touch boundary,
- done condition,
- verification hint,
- quick action options.

## 7.4 Prompt Output
`scrimble prompt` prints raw prompt output for copy/paste automation.

## 7.5 Verification
`scrimble verify` runs local checks and returns pass/warn/fail/manual-review with confidence.

## 7.6 Completion
`scrimble done` performs verify → confirm/override flow → sync completion → activate next chunk.

## 7.7 Progress Navigation
- `scrimble status` for re-entry.
- `scrimble next` for preview without activation.
- `scrimble skip` with explicit reason and risk acknowledgement.

## 7.8 Plan Evolution
- `scrimble update` for targeted plain-language changes.
- `scrimble replan` for full regeneration from latest state.

## 7.9 Recovery and Integrity
- `scrimble sync` to reconcile cloud/local.
- `scrimble doctor` for auth/config/staleness health checks.
- `scrimble logout` to invalidate local session material.

---

## 8. Prompt Contract (Mandatory)

Each active chunk prompt must include:

1. **Project Context**
2. **Your Job Right Now**
3. **Requirements**
4. **Do Not Touch**
5. **Done When**
6. **Verification Signals**

### Prompt Quality Bar
Prompts must be repo-aware, stack-aware, bounded, and testable.

### Disallowed Prompt Behavior
- vague task framing,
- missing scope boundary,
- missing done condition,
- invented assumptions not grounded in evidence,
- tutorial over-explaining that dilutes execution focus.

---

## 9. Verification Philosophy

Verification is mandatory but must be honest about limits.

### Preferred Evidence Types
- files/changes present,
- imports/routes/config references,
- migrations/tests/build signals,
- command outcomes,
- manual confirmations when objective checks are insufficient.

### Rules
1. Prefer objective evidence.
2. Never present heuristic evidence as certainty.
3. Allow explicit override, but record it.
4. Surface confidence and risk when checks are ambiguous.

---

## 10. Cloud Support Model (Conceptual)

Cloudflare backend must provide:

- identity/session support for CLI,
- durable project and plan lifecycle state,
- long-running generation/replan orchestration,
- artifact persistence for large outputs,
- event history for transparency and recovery.

Conceptual entities to support:

- user,
- project,
- generation run,
- chunk,
- plan revision,
- event log,
- CLI session,
- artifact references.

Implementation details are open; behavior contracts are not.

---

## 11. Security and Privacy Requirements

1. Secrets encrypted at rest.
2. No secret leakage into repo artifacts or logs.
3. User-scoped access control on all cloud operations.
4. Revocable and expiring CLI sessions.
5. Safe local handling of tokens and sensitive paths.

---

## 12. Reliability and Performance Requirements

System must handle:

- transient network failures,
- partial local writes,
- failed sync attempts,
- resumable generation and replans,
- stale local state detection,
- repo drift outside Scrimble.

Performance goals:

1. Re-entry commands feel instant via local-first rendering.
2. Long operations expose meaningful progress.
3. Verification remains fast by default, with heavier checks staged/opt-in.

---

## 13. Observability Requirements

Capture enough telemetry to improve finish rates:

- stage timings,
- chunk completion latency,
- verification pass/fail/override patterns,
- update/replan frequency,
- sync failures,
- stale-plan incidents,
- abandonment points.

---

## 14. Non-Goals (V1)

- team collaboration,
- shared workspaces,
- project management suite features,
- browser-first dashboards,
- native mobile app,
- replacing coding agents (Cursor/Claude/etc).

Scrimble orchestrates execution discipline; it does not replace IDE agents.

---

## 15. Success Criteria

Scrimble is successful when:

1. users complete more projects they start,
2. users resume effectively after days away,
3. active chunk prompts are trusted and actionable,
4. verification is useful (not noisy),
5. updates/replans preserve valid completed work,
6. proactive mode helps rather than distracts.

---

## 16. Implementation Phases

### Phase 1 — CLI Foundation
Init/import, local footprint, repo inspection, status/doctor, cloud session bootstrap.

### Phase 2 — Generation Core
Architecture synthesis, approval flow, chunk planning, prompt enrichment, first chunk activation.

### Phase 3 — Execution Loop
Default command, prompt/verify/done/next/skip, local verification engine, progression sync.

### Phase 4 — Updates and Recovery
Update/replan, resume/cancel semantics, stale-state detection, sync hardening.

### Phase 5 — Proactive + Hardening
Resident proactive mode, observability, security hardening, performance tuning, broader repo-shape support.

---

## 17. Build-Agent Instructions

### Do
- optimize for terminal-native execution,
- preserve Cloudflare-only backend boundary,
- keep architecture open and justified,
- prioritize clarity, bounded prompts, and reliable progression,
- design for interruptions and real-world messy repos.

### Do Not
- drift into dashboard-first product behavior,
- lock to legacy architecture by default,
- bloat scope with PM/team features,
- fake certainty when evidence is weak,
- make verification authoritarian when checks are heuristic.

### Decision Rule
When in doubt, choose the option that best improves this exact moment:

> The user runs Scrimble, sees one real next action, executes it, and keeps finishing.

