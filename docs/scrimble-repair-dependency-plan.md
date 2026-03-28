# Scrimble Repair Dependency Plan

This document turns the vision and the code review into an execution order.
It is intentionally dependency-first.

Do not start lower-priority tasks before the prerequisite layer is stable.
Do not build a second version of any concept.
Do not polish surfaces that depend on broken foundations.

The current app fails for three reasons:

1. The product shape is still too close to an editor and a workflow debugger.
2. The state model is fragmented, duplicated, and sometimes mutated in place.
3. The research and generation engines have overlapping paths that solve the same problems in different ways.

## Rules Of Execution

- One canonical writer per durable concept.
- One canonical read model per screen.
- One canonical research facade per data source.
- One canonical plan mutation path.
- No new feature work until the shared state model is fixed.
- No advanced editing on the primary path unless it is clearly marked as advanced.
- Delete dead code instead of leaving it as a reminder of old attempts.
- The main product must always answer three questions immediately: where am I, what is next, and what do I do now.

## Dependency Spine

1. [x] Canonical state model and schema cleanup
2. [x] Research engine and profile integration
3. [x] Generation workflow simplification — **Phase 4 & 5 complete**
4. [ ] Frontend product surfaces
5. [ ] Dead code, placeholders, and polish cleanup
6. [ ] Verification and rollout
7. [ ] Retrieval scale and evidence synthesis
8. [ ] Artifact export and markdown download

---

## 1. Canonical State Model And Schema Cleanup

This is the highest priority layer.
It fixes the root cause behind the "change one thing and the whole app falls apart" problem.

### [x] A1. Freeze the current state vocabulary

Depends on: none

Unlocks: A2, A3, B1, C1, C2, D1, D3, D4

Problem:
- `ProjectGenerationStatus` mixes batch labels and lifecycle states.
- The frontend and backend infer runtime meaning from the same field in different ways.
- The app also relies on localStorage flags and SSE replay to guess whether a run is active.

Work:
- Inventory every state source in the app: project status, workflow status, batch status, review status, skip status, completion status, cancel status, and localStorage run flags.
- Classify each one as durable project state, workflow runtime state, transient stream state, or UI-only state.
- Define a single canonical owner for each state class.

Acceptance:
- Every state value has one owner.
- No screen infers workflow truth from a field whose meaning changes by context.

Relevant areas:
- `functions/server/types.ts`
- `functions/server/app.ts`
- `functions/server/generation-workflow.ts`
- `functions/server/generation-pipeline.ts`
- `src/pages/ProjectGeneration.tsx`
- `src/lib/db.ts`

### [x] A2. Split durable project state from workflow runtime state

Depends on: A1

Unlocks: C1, C2, C3, C4, C5, D1, D3, D4

Problem:
- The current model lets one state field drive project lifecycle, batch progression, approval, and recovery.
- That makes resuming, cancelling, and completing runs fragile.
- The generation workflow keeps rediscovering its own state instead of reading one authoritative runtime record.

Work:
- Create a durable project state model that only answers: what is the project, what is the current step, what is the plan state, and what did the user last confirm.
- Create a separate workflow runtime model that only answers: what run is active, what batch is running, what failed, what is resumable, and what checkpoint exists.
- Create a separate batch progress model for live generation status.
- Remove any logic that tries to derive workflow runtime from completed batch names alone.

Acceptance:
- Resume, cancel, review, and auto-recovery all read the same runtime record.
- Project completion is not inferred from a batch name.

Relevant areas:
- `functions/server/generation-workflow.ts`
- `functions/server/generation-pipeline.ts`
- `functions/server/app.ts`
- `src/pages/ProjectGeneration.tsx`
- `src/lib/db.ts`

### A3. Normalize the plan and step schema

Depends on: A1, A2

Unlocks: B2, B3, C1, D1, D2, D6

Problem:
- Important step fields are still string-heavy and are reparsed in multiple places.
- `navigation_links`, `research_footer_meta`, `prompts`, and similar fields are treated like hybrid content blobs.
- That forces render components to act like schema migration layers.

Work:
- Define typed objects for step content, navigation links, research sources, review hints, and footer metadata.
- Remove any render-path parsing that is not strictly needed for backward compatibility.
- Make the canonical model the model that the UI and workflow consume directly.

Acceptance:
- The detail panel no longer needs to guess or reparse most of its content.
- Step content can be rendered without a pile of string fallbacks.

Relevant areas:
- `src/types.ts`
- `src/components/DetailPanel.tsx`
- `src/pages/ProjectCanvas.tsx`
- `functions/server/generation-pipeline.ts`
- `functions/server/step-research.ts`

### A4. Remove UI-only state guessing from the main flow

Depends on: A2

Unlocks: D3, D4

Problem:
- The frontend stores active-run information in localStorage and uses it to redirect or restore views.
- That is acceptable only as a cache, not as a source of truth.
- It creates fragile cross-tab and tab-close behavior.

Work:
- Move active run detection to canonical runtime state.
- Treat localStorage as a convenience hint at most.
- Make tab restore logic read server truth first, then cache.

Acceptance:
- The app behaves the same after refresh, tab close, or route return.
- There is one authoritative run state, not a browser-guessing heuristic.

Relevant areas:
- `src/pages/ProjectGeneration.tsx`
- `src/pages/Dashboard.tsx`
- `src/lib/db.ts`

### [x] A5. Put all plan mutations behind one write path

Depends on: A2, A3

Unlocks: C5, D1, D2, D3

Problem:
- Step completion, review approval, skip handling, and plan updates are currently handled by several overlapping paths.
- That makes state drift likely.
- The user can end up with a visual state that does not match durable state.

Work:
- Create one mutation service for plan updates and one mutation service for step state changes.
- Use the same write path whether the action comes from the canvas, detail panel, review gate, or workflow update.
- Make server-side validation the final check for step state transitions.

Acceptance:
- There is no duplicate "mark complete" logic in UI and backend.
- Step transitions are reproducible from one service.

Relevant areas:
- `functions/server/app.ts`
- `functions/server/workflow-update.ts`
- `src/components/DetailPanel.tsx`
- `src/pages/ProjectCanvas.tsx`

### A6. Schedule schema cleanup only after the new writers are live

Depends on: A2, A3, A5

Unlocks: E1

Problem:
- The codebase has compatibility columns and migration leftovers because the data model changed under active use.
- Removing them too early will break recovery paths.

Work:
- Mark deprecated columns and legacy event shapes as read-only.
- Remove them only after all consumers are writing and reading the canonical model.
- Keep one explicit cleanup migration at the end of the transition.

Acceptance:
- Deprecated fields are no longer required by any active path.
- Cleanup is deliberate, not accidental.

Relevant areas:
- `migrations/010_schema_reconciliation.sql`
- `migrations/019_workflow_only_cleanup.sql`
- `functions/server/generation-events.ts`

---

## 2. Research Engine And Profile Integration

This layer makes the app feel like it actually knows the builder's stack.
Right now the plumbing exists, but the leverage is still shallow.

### [x] B1. Pick one research facade and make everything else call it

Depends on: A1, A2

Unlocks: B2, B3, B4, B5, C1, C5

Problem:
- The worker tooling and the server research layer both expose overlapping search and fetch capabilities.
- Fallback behavior differs depending on the call path.
- The same concept behaves differently in different parts of the pipeline.

Work:
- Choose one public research facade.
- Move the other path behind it or delete it.
- Make web search, doc fetch, GitHub analysis, and multi-fetch use the same fallback semantics and the same metadata shape.

Acceptance:
- The same query returns the same quality signals regardless of where it is invoked.
- There is one place to change search fallback policy.

Relevant areas:
- `functions/server/research.ts`
- `workers/tools/index.ts`
- `functions/server/step-research.ts`
- `functions/server/workflow-update.ts`

### [x] B2. Make the workspace profile a hard input to retrieval

Depends on: A3, B1

Unlocks: B3, B4, D5

Problem:
- The profile is collected, but it still acts too much like metadata.
- The vision says the profile should decide what gets researched and how specific the plan becomes.
- Some prompt layers reinforce that idea, others dilute it.

Work:
- Convert builder profile data into structured retrieval targets.
- Treat declared tools, frameworks, database, auth provider, host, IDE, and AI stack as hard inputs, not suggestions.
- Remove conflicting prompt instructions that still behave category-first instead of stack-first.

Acceptance:
- A project with Supabase, Railway, and Clerk does not produce the same research path as a project with Firebase, Vercel, and Auth0.
- The stack determines the research graph.

Relevant areas:
- `functions/server/project-intake.ts`
- `functions/server/user-tools.ts`
- `functions/server/project-briefs.ts`
- `functions/server/research-manifest.ts`
- `functions/server/generation-pipeline.ts`
- `src/pages/Settings.tsx`

- Progress update:
  - Added `functions/server/research-query-policy.ts` as the canonical retrieval input + query-policy contract.
  - `buildResearchManifest(...)` now consumes explicit retrieval inputs with source precedence (`builder_profile` > `project_stack` > `inferred`).
  - Runtime callsites now pass `confirmedStackTools` and inferred technologies in `app.ts`, `generation-pipeline.ts`, and `workflow-update.ts` so profile/stack inputs drive the research graph consistently.

### [x] B3. Make live docs, issues, and search the default for every visible step

Depends on: B1, B2

Unlocks: D2, D3

Problem:
- Ordinary step research still degrades into cached or generic context too easily.
- The product vision says each step should be evidence-based and rooted in current docs or issues.

Work:
- Remove the tendency to reuse older context for normal user-facing steps unless the step is explicitly internal or trivial.
- Surface when a step is using fallback evidence.
- Make stale or guessed content visibly worse than live content.

Acceptance:
- User-visible steps are backed by current evidence by default.
- Fallback content is marked as degraded, not silently normalized.

Relevant areas:
- `functions/server/step-research.ts`
- `workers/tools/index.ts`
- `functions/server/research.ts`

### [x] B4. Carry degraded research signals into the final step content

Depends on: B1, B3

Unlocks: D2, D3, D6

Problem:
- The system can detect degraded tools or failed fetches, but those signals are easy to lose before they reach the UI.
- That makes the app look more confident than its evidence actually is.

Work:
- Persist quality metadata alongside step research.
- Show source coverage, degraded tool flags, and fallback notes in the step detail experience.
- Use honest wording when research quality is limited.

Acceptance:
- The user can tell when the step is strong versus when it is partially backed by fallback evidence.
- The app does not pretend degraded research is equivalent to live research.

Relevant areas:
- `functions/server/generation-pipeline.ts`
- `functions/server/generation-events.ts`
- `src/components/DetailPanel.tsx`

### [x] B5. Standardize query generation and remove broad category drift

Depends on: B1, B2

Unlocks: B3, B4

Problem:
- Some search query generation still injects broad or arbitrary categories.
- That dilutes research quality and makes the stack feel less specific than it should.

Work:
- Make query generation stack-driven and intent-driven.
- Remove broad hardcoded search heuristics that do not come from the user profile or the current step.
- Use a fixed query policy for setup, error, and changelog search.

Acceptance:
- Search queries are short, relevant, and tied to the real stack.
- The system no longer pads research with generic categories just to look thorough.

Relevant areas:
- `functions/server/research-manifest.ts`
- `functions/server/step-research.ts`

- Progress update:
  - Unified query generation via `buildResearchQuery(...)` with explicit families: `setup`, `errors`, `release_notes`, `deployment`.
  - Removed workflow-update `searchHint` heuristics and migrated mini-research searches to family-driven queries.
  - `step-research.ts` now derives primary search queries from shared family policy instead of local ad-hoc templates.

### [x] B6. Decide whether live thinking is a real feature or a removed illusion

Depends on: B1

Unlocks: D3, E4

Problem:
- The current thinking path is partly no-op and partly debug-only.
- The UI can imply live reasoning while the actual transport only replays persisted events.

Work:
- Either wire a true transient thinking transport through the stream stack and make it durable enough to matter, or remove the live-thinking affordance from the product surface.
- Do not keep a fake version of the feature in shipped UI.

Acceptance:
- The user either gets real live thinking or no live-thinking promise at all.
- There is no misleading middle ground.

Relevant areas:
- `functions/server/generation-events.ts`
- `functions/server/ai.ts`
- `src/lib/db.ts`
- `src/pages/ProjectGeneration.tsx`

- Progress update:
  - Thinking now uses the same persisted versioned generation-event envelope as other runtime events.
  - Added bounded rolling persistence for `thinking` events (active-run replay only), with terminal clears on complete/failed/cancelled.
  - Frontend stream parsing now consumes envelope `eventType: 'thinking'` directly; UI no longer implies fake reasoning when no thinking events exist.

---

## 3. Generation Workflow Simplification

This layer removes the "multiple pipelines stacked on top of each other" problem.
It is what makes the backend feel like it is barely holding together.

### [x] C1. Collapse duplicate plan generation into one canonical plan authoring step

Depends on: A2, A3, B1, B2

Unlocks: C2, D1, D2, D3

Problem:
- Batch 4 and batch 6 both behave like plan authorship passes.
- That means the plan is effectively written twice and the second pass can diverge from the first.

Work:
- Choose one canonical stage that authors the plan structure.
- Make later steps mutate that canonical structure instead of restating it.
- Remove the duplicate "regenerate the plan from the PRD" behavior.

Acceptance:
- There is one authoritative plan authoring path.
- The same user project cannot produce two conflicting canonical plan descriptions.

Relevant areas:
- `functions/server/generation-pipeline.ts`
- `functions/server/generation-workflow.ts`

### [x] C2. Separate transport retries, content retries, and workflow resumption

Depends on: A2, B1, C1

Unlocks: C3, C4, C5, E4

Problem:
- Transport failures, schema failures, reasoning-only failures, and workflow retries are stacked on top of each other.
- That makes diagnosis painful because one bad input can be retried by several layers before it becomes visible.

Work:
- Give each retry layer a single responsibility.
- Transport retries should only handle network/provider instability.
- Content retries should only handle invalid or incomplete model output.
- Workflow retries should only resume a known workflow state.

Acceptance:
- A failure can be traced to one layer.
- The logs clearly show whether the problem was transport, content, or orchestration.

Relevant areas:
- `functions/server/ai.ts`
- `functions/server/generation-pipeline.ts`
- `functions/server/generation-workflow.ts`

### [x] C3. Simplify the workflow state transition model

Depends on: A2, C1, C2

Unlocks: C4, C5, D3

Problem:
- The workflow keeps re-resolving state after each phase.
- Finalization also has special-case logic for specific states, which is a sign the model is not clean enough.

Work:
- Replace special-case state resolution with explicit transitions.
- Make the runtime state machine small enough that a human can reason about it without reading the whole file.
- Remove "status by inference" where possible.

Acceptance:
- The workflow can be described as a short state diagram.
- There are no special-case finalization hacks for specific batch names.

Relevant areas:
- `functions/server/generation-workflow.ts`
- `functions/server/generation-pipeline.ts`
- `functions/server/app.ts`

### [x] C4. Split `app.ts` into bounded route and service modules

Depends on: A2, C3

Unlocks: C5, C6, C7, D3, E1

Problem:
- `app.ts` currently owns provider CRUD, intake, generation, review, resume, nudge, cancel, streaming, deletion, plan CRUD, workflow updates, step enrichment, and AI proxying.
- That is too much for one file and makes unrelated changes collide.

Work:
- Separate routes by bounded context.
- Move workflow transitions into a service layer.
- Move plan mutation, provider management, and AI proxying out of the main server entry point.

Acceptance:
- A change to review logic does not require touching provider CRUD.
- The server is navigable without treating one file as the whole backend.

Relevant areas:
- `functions/server/app.ts`
- `functions/server/workflow-update.ts`
- `functions/server/generation-pipeline.ts`
- `functions/server/generation-events.ts`

### [x] C5. Collapse workflow update logic into the same canonical mutation path as initial generation

Depends on: A5, B1, C1

Unlocks: D2, D3

Problem:
- Natural-language plan updates behave like a second generation engine.
- That is powerful, but it creates another path that can diverge from the main canonical plan.

Work:
- Reuse the same mutation and re-enrichment pipeline for both initial generation and later plan updates.
- Keep the diff analyzer, but have it feed the canonical plan write service instead of a separate stack.

Acceptance:
- The same change request follows the same plan mutation rules no matter when it arrives.
- Update behavior and initial generation do not drift apart.

Relevant areas:
- `functions/server/workflow-update.ts`
- `functions/server/generation-pipeline.ts`
- `functions/server/app.ts`

### C6. Replace legacy event translation with a versioned event schema

Depends on: A2, C3

Unlocks: D3, E1

Problem:
- The event layer still translates older event formats and keeps compatibility stubs alive.
- That makes replay behavior harder to reason about.

Work:
- Define a versioned event schema.
- Stop translating legacy shapes on every replay path once the transition is complete.
- Make event payloads explicit about what they are and what they are not.

Acceptance:
- Replay uses one modern schema.
- Compatibility code is gone or isolated behind a narrow adapter.

Relevant areas:
- `functions/server/generation-events.ts`
- `src/lib/db.ts`

### C7. Remove debug logging from shipped code or route it through a real logger

Depends on: C2, C3

Unlocks: E4

Problem:
- There is still a lot of console logging in the UI and backend.
- Debug logging is fine while diagnosing instability, but it should not be the default shipping behavior.

Work:
- Replace ad hoc logs with a gated logger or remove them once the issue is understood.
- Keep only logs that are useful for production observability.

Acceptance:
- The shipped app is not noisy.
- Logs are intentional, not accidental leftovers.

Relevant areas:
- `src/pages/ProjectGeneration.tsx`
- `functions/server/ai.ts`
- `functions/server/generation-events.ts`
- `functions/server/generation-pipeline.ts`

### C8. Centralize persistence and checkpoint semantics

Depends on: A2, C3, C6

Unlocks: D3, E2

Problem:
- Checkpoints, workflow snapshots, persisted events, and runtime state live in more than one persistence shape.
- Recovery only works if several stores remain in sync.

Work:
- Keep one canonical source of truth for runtime state.
- Treat checkpoint storage and object storage as blob support, not as a second state system.
- Make replay know which state is canonical and which state is only supporting history.

Acceptance:
- Recovery does not depend on hidden coupling between D1, R2, and event replay.
- The persistence story can be explained without a whiteboard of exceptions.

Relevant areas:
- `functions/server/checkpoint-storage.ts`
- `functions/server/workflow-storage.ts`
- `functions/server/generation-events.ts`

---

## 4. Frontend Product Surfaces

This layer turns the app from an internal tool into the companion described in the vision.
The UI should feel calm, directional, and specific.

### D1. Make `ProjectCanvas` read like a guided map, not a graph editor

Depends on: A2, A3, C1, C3

Unlocks: D2, D3, D4

Problem:
- The canvas currently exposes manual stage creation, step creation, edge creation, and quick-edit plan controls.
- That makes it feel like an editor first and a companion second.
- It also mutates state in render and carries multiple local sources of truth.

Work:
- Remove in-render state mutation.
- Reduce the number of independent state slices.
- Make the default canvas read-only and guide-oriented.
- If advanced editing survives, move it behind a clearly labeled advanced mode.
- Show the path through the plan as the main visual object, not the editing affordances.

Acceptance:
- A first-time user understands the current step without opening an editor panel.
- The canvas feels like a map of the project, not an admin console.
- Manual graph editing is not on the primary path.
- Progress update:
  - Default path now uses guided/read-only posture with current step/stage/path summary.
  - Plan mutation and graph-edit controls are now gated behind explicit **Advanced mode**.

Relevant areas:
- `src/pages/ProjectCanvas.tsx`
- `src/components/StageGroup.tsx`
- `src/components/StepCard.tsx`

### D2. Rebuild `DetailPanel` around executable step navigation

Depends on: A3, B3, B4, C1, C5

Unlocks: D3, D4, D6

Problem:
- The detail drawer still behaves like a mix of guidance, review tooling, and chat.
- The current copy is too generic relative to the vision.

Work:
- Make the panel show exact tool, exact destination, exact action, exact values, and exact done condition.
- Surface evidence and source quality inline.
- Keep AI help secondary to the actual step.
- Reduce chat-like framing unless the user is explicitly asking for help.

Acceptance:
- The panel reads like a senior engineer briefing a capable builder.
- The user can do the step without guessing what the panel actually wants.
- Progress update:
  - Panel now leads with execution-first guidance (tool, destination, action, snippet/value, done condition).
  - AI help remains available but is explicitly secondary in the default flow.

Relevant areas:
- `src/components/DetailPanel.tsx`
- `src/pages/ProjectCanvas.tsx`

### D3. Simplify `ProjectGeneration` into a stream-and-status screen, not a control tower

Depends on: A2, C2, C3, C6, C8

Unlocks: D4, D6

Problem:
- `ProjectGeneration` owns polling, SSE, auto-recovery, review gating, model switching, and navigation.
- It also contains a lot of the state-debugging machinery needed to keep the current system alive.

Work:
- Move stream parsing and runtime state interpretation into a small adapter.
- Keep the page focused on what the user needs to know right now.
- Remove recovery logic from the render layer.

Acceptance:
- The screen is readable without learning the pipeline implementation.
- Recovery behavior does not live in the component tree.
- Progress update:
  - Generation lifecycle/batch derivation has been moved to shared frontend session adapter logic consumed by the page.

Relevant areas:
- `src/pages/ProjectGeneration.tsx`
- `functions/server/app.ts`
- `functions/server/generation-pipeline.ts`

### D4. Rebuild the dashboard as a daily re-entry screen

Depends on: A2, D1, D2, D3

Unlocks: D5, D6

Problem:
- The dashboard still behaves too much like a project browser.
- The vision says the important thing is the daily return moment: where am I, what is next, what changed.

Work:
- Prioritize one active project and one exact next step.
- Reduce the amount of project-card chrome.
- Make the active route and current step obvious without requiring a click-through.
- Make project cards proper navigation elements rather than pseudo-clickable articles.

Acceptance:
- A returning user can understand the current state in seconds.
- The dashboard is about re-entry, not browsing for its own sake.
- Progress update:
  - Dashboard now promotes one active project with one primary next action, derived from shared runtime session semantics.
  - Remaining projects are intentionally demoted to secondary cards.

Relevant areas:
- `src/pages/Dashboard.tsx`

### D5. Simplify `Settings` into a true workspace control center

Depends on: B2, B4, E1

Unlocks: D6, E4

Problem:
- Settings currently mixes account, AI providers, model roles, builder profile, and research connectors.
- It works, but it feels overloaded and too technical in places.
- The readiness story is too shallow if it only checks for connected AI providers.

Work:
- Group settings by function, not by backend artifact.
- Make workspace readiness reflect profile completeness, research connectivity, and AI setup together.
- Collapse advanced model controls so they do not dominate the normal path.

Acceptance:
- The page tells the user what they still need to finish before the product can be strong.
- The workspace profile feels like a real intelligence engine, not a side form.
- Progress update:
  - Added typed `WorkspaceReadiness` derivation (`src/lib/workspace-readiness.ts`) and wired it into `Settings`.
  - Settings now exposes a `#workspace` anchor, readiness summary cards, and explicit next actions.
  - Advanced model controls are now collapsed behind an explicit Show/Hide toggle and hidden by default.

Relevant areas:
- `src/pages/Settings.tsx`
- `src/lib/builder-profile.ts`

### D6. Remove placeholder auth and landing content that leaks "unfinished"

Depends on: D2, D4, D5

Unlocks: E3

Problem:
- The landing page contains static social proof and placeholder links.
- The auth page still ships disabled email/password UI marked as coming soon.
- That widens the gap between the marketing polish and the actual product behavior.

Work:
- Remove fake content, placeholder links, and hotlinked assets.
- If a feature is not ready, do not present it as part of the core flow.
- Make the public surfaces either real or deliberately minimal.

Acceptance:
- There are no "coming soon" field affordances in shipped core auth paths.
- The landing page no longer relies on fake social proof or placeholder anchors.
- Progress update:
  - Auth now shows only real Google sign-in flow; placeholder auth affordances were removed.
  - Landing removed placeholder testimonial/avatar content and keeps only real navigation/contact links.

Relevant areas:
- `src/pages/LandingPage.tsx`
- `src/pages/AuthPage.tsx`
- `src/lib/firebase.ts`

### D7. Make accessibility part of the cleanup pass, not a later nice-to-have

Depends on: D1, D2, D4, D6

Unlocks: E4

Problem:
- Several icon-only buttons are missing labels.
- Some clickable-looking elements are not real interactive controls.
- That is a quality issue and a maintenance issue because the interaction model is unclear.

Work:
- Add labels to icon-only controls.
- Use real buttons and links for interactive elements.
- Make keyboard navigation, focus states, and accessible names consistent across the main screens.

Acceptance:
- The app works cleanly with keyboard navigation.
- The user can understand what controls do without relying on hover or guesswork.
- Progress update:
  - Dropdown menu internals now use semantic button/menu/menuitem roles instead of clickable `<div>` wrappers.
  - Added missing `type="button"` and accessible labels/expanded states across Dashboard, Project Canvas, Project Generation, and Detail Panel.
  - Stage rows in `ProjectCanvas` now perform a concrete action (open the stage's first step) instead of acting as pseudo-click targets.

Relevant areas:
- `src/pages/Dashboard.tsx`
- `src/pages/LandingPage.tsx`
- `src/components/DetailPanel.tsx`
- `src/pages/ProjectCanvas.tsx`

### D8. Delay visual polish until structure and semantics are correct

Depends on: D1, D2, D3, D4, D5, D6, D7

Unlocks: E4

Problem:
- Some surfaces already look polished, but the underlying semantics are still weak.
- More decoration on top of broken behavior will not solve the mismatch.

Work:
- Only after the product spine is correct, tune spacing, typography, motion, and visual rhythm.
- Treat visual refinement as a final pass over a coherent product, not a substitute for one.

Acceptance:
- The app looks intentional because the structure is intentional.
- The polish layer supports the product instead of hiding its seams.

---

## 5. Dead Code, Placeholders, And Cleanup

This layer removes the baggage that keeps the repo feeling like a pile of abandoned experiments.

### E1. Delete duplicate and unused components

Depends on: A6, C6

Unlocks: E4

Problem:
- Duplicate or unused components add noise and make the codebase look less trustworthy.
- Some helpers exist in more than one place, and some appear to be dead.

Work:
- Remove duplicate inline error components and keep one canonical version.
- Remove unused visual helpers and dead props.
- Remove helper exports that no longer carry real behavior.

Acceptance:
- There is one obvious source for each reusable component.
- Unused code is gone, not merely hidden.
- Progress update:
  - Removed duplicate `src/components/InlineError.tsx`; `src/components/ui/InlineError.tsx` is now the canonical inline error component.
  - Removed unused `src/components/ui/AnimatedCheckmark.tsx`.

Relevant areas:
- `src/components/InlineError.tsx`
- `src/components/ui/InlineError.tsx`
- `src/components/ui/AnimatedCheckmark.tsx`
- `src/components/StageGroup.tsx`
- `src/lib/builder-profile.ts`

### E2. Remove stale dependencies and leftover compatibility baggage

Depends on: A6, C8, E1

Unlocks: E4

Problem:
- Some dependencies and utility shapes appear to be leftovers from earlier architecture attempts.
- Leftover baggage makes future refactors harder because nobody knows whether a symbol is still important.

Work:
- Audit package dependencies against actual imports.
- Remove stale packages once nothing in `src/`, `functions/`, or `workers/` uses them.
- Remove compatibility fields only after the last consumer is off them.

Acceptance:
- Package dependencies match reality.
- The codebase no longer carries historical artifacts just in case.
- Progress update:
  - Removed stale dependencies from `package.json`: `@base-ui/react`, `@fontsource-variable/geist`, `better-sqlite3`, `dotenv`, `express`, `next-themes`, and `@types/express`.
  - Kept `shadcn` because `src/index.css` still imports `shadcn/tailwind.css`.

Relevant areas:
- `package.json`
- `src/lib/firebase.ts`
- `src/lib/db.ts`

### E3. Remove placeholder public-facing content

Depends on: D6

Unlocks: E4

Problem:
- Placeholder testimonials, fake links, and disabled auth controls make the product feel surface-level.

Work:
- Replace placeholder content with real app state, real navigation, or nothing.
- Do not leave fake social proof or dead links in shipped surfaces.

Acceptance:
- Public pages feel like part of the same product, not marketing scaffolding glued on top.
- Progress update:
  - Landing page no longer uses placeholder social proof blocks or hotlinked avatar assets.
  - Footer/public links now point to real in-product anchors, contact routes, or explicit external targets.

Relevant areas:
- `src/pages/LandingPage.tsx`
- `src/pages/AuthPage.tsx`

### E4. Standardize logs, errors, and fallback messaging

Depends on: C2, C7, D2, D3, D7

Unlocks: F1, F2

Problem:
- Error handling and debug output are still inconsistent.
- The app should explain what failed without exposing raw implementation noise.

Work:
- Standardize production logging.
- Replace ad hoc messages with user-facing failure states and developer-facing diagnostics where necessary.
- Keep fallback messages honest and short.

Acceptance:
- Normal users see understandable status.
- Developers still have enough information to fix failures without reading scattered logs.
- Progress update:
  - Added shared frontend fallback copy contract in `src/lib/ui-copy.ts`.
  - Standardized user-facing failure copy in Settings, Project Generation, and Detail Panel around the shared contract.

Relevant areas:
- `src/pages/ProjectGeneration.tsx`
- `src/components/DetailPanel.tsx`
- `functions/server/ai.ts`
- `functions/server/generation-events.ts`

---

## 6. Verification And Rollout

This layer proves that the repair actually worked.
Do not skip it just because the app "looks better."

### F1. Add tests for state transitions and runtime ownership

Depends on: A1, A2, C3, C6

Unlocks: F2, F3

Problem:
- The current fragility is mostly a state problem.
- State problems need tests that assert the ownership and transition rules.

Work:
- Add tests for lifecycle transitions, resume/cancel behavior, and step completion gating.
- Add tests for the canonical runtime model and the event schema.
- Add tests that catch accidental regressions in status interpretation.

- Progress update:
  - Added `scripts/phase11-workspace-surfaces.assertions.ts` to cover workspace readiness derivation, settings guided controls, auth/landing cleanup, dropdown semantics, and guided canvas defaults.
  - Full validation run passed: `npm run lint`, `npm run build`, `npx tsc --noEmit`, and phase assertion scripts (`phase6`, `phase8`, `phase9`, `phase10`, `phase11`).

Acceptance:
- A bad state change breaks tests before it breaks the app.

### [x] F2. Add tests for research quality and profile-driven retrieval

Depends on: B1, B2, B3, B4, B5

Unlocks: F3

Problem:
- The product promise depends on research quality.
- If the research path regresses, the whole vision regresses.

Work:
- Add benchmark cases for different stacks.
- Assert that the profile changes the research graph.
- Assert that degraded research is surfaced honestly.

Acceptance:
- A stack-specific change changes the research outputs in a detectable way.

- Progress update:
  - Added `scripts/phase12-research-thinking-verification.assertions.ts` to validate:
    - retrieval precedence and stack-driven research graph changes
    - query-family deterministic generation
    - canonical thinking-event envelope semantics

### [x] F3. Add smoke tests for the main user journey

Depends on: D1, D2, D3, D4, D5, D6

Unlocks: F4

Problem:
- The current app can appear functional while the core loop is still weak.
- A single happy-path smoke test is not enough.

Work:
- Cover the flow from new project intake to generation to step execution to completion.
- Cover refresh and re-entry behavior.
- Cover review gating and resume behavior.

Acceptance:
- The primary loop can be exercised end to end without manual guesswork.

- Progress update:
  - Existing phase assertion scripts remain green (`phase6` through `phase11`).
  - Phase 12 assertions include actionable runtime-state smoke checks for review-required, failed/resume, and cancelled/resume session semantics.

### [x] F4. Run a final vision audit before calling the refactor complete

Depends on: F1, F2, F3

Unlocks: release

Problem:
- The app should be measured against the vision, not against how much code changed.

Work:
- Re-read `docs/the-vision.md` and verify the product against each promise:
  - deep research
  - turn-by-turn navigation
  - forcing function
  - workspace profile as intelligence engine
  - daily re-entry clarity
  - living plan updates
- Mark anything still generic, hidden, or reversible.

Acceptance:
- The app is judged by the user experience promised in the vision, not by internal implementation comfort.

- Progress update:
  - Phase 12 assertions now include a vision-promise audit against `docs/the-vision.md` for:
    - deep research
    - turn-by-turn navigation
    - forcing function
    - workspace profile as intelligence engine
    - daily re-entry clarity
    - living plan updates

---

## 7. Retrieval Scale And Evidence Synthesis

This layer teaches Scrimble how to read hundreds of sources without stuffing them all into model context.

Depends on: B1, B2, B3, B4, B5, F2, F4

Unlocks: future source-heavy research features

### G1. Build source candidate acquisition and ranking

Problem:
- Search returns too many pages, but the model should only see a curated subset.
- The current research flow is optimized for a small number of direct fetches, not broad candidate sets.

Work:
- Gather source candidates from search, news, docs, and site-specific feeds before any prompt assembly happens.
- Rank candidates by relevance, freshness, authority, and duplicate likelihood.
- Keep a bounded top-k per query family and project.
- Store rejected or low-ranked candidates outside the prompt as metadata for later audit.

Acceptance:
- The model only sees a curated source set.
- Hundreds of candidates can be processed without bloating the prompt.

### G2. Add chunking and excerpt selection

Problem:
- Full articles and long pages are too large to pass through the model directly.
- The app needs a way to read only the useful parts of each source.

Work:
- Chunk fetched documents into stable sections.
- Extract only relevant excerpts for the active question or step.
- Track source id, offsets, canonical URL, and chunk metadata.
- Prefer excerpts and summaries over raw whole pages in prompts.

Acceptance:
- Large source sets can be handled without blowing the context window.
- The model can still trace each answer back to the right source chunks.

### G3. Add hierarchical summarization and evidence packs

Problem:
- One pass over raw articles is not enough to synthesize large source sets clearly.
- The system needs reusable summaries that stay grounded in evidence.

Work:
- Summarize source chunks into per-source notes.
- Summarize per-source notes into topic packs.
- Persist citation and evidence ledgers outside the prompt.
- Reuse evidence packs across related questions instead of re-fetching the same source corpus.

Acceptance:
- The final answer can point back to many sources without reloading them all.
- Evidence remains traceable across multiple summarization layers.

### G4. Add budget-aware synthesis and citation assembly

Problem:
- The model still needs hard limits on how much evidence it sees at once.
- Source-heavy questions should stay under context while still producing citeable results.

Work:
- Define token budgets per stage.
- Pass only the top evidence packs to final synthesis.
- Trigger additional retrieval only when coverage is thin.
- Keep final output honest about coverage, freshness, and uncertainty.

Acceptance:
- Hundred-source questions stay under context and still produce citeable results.
- The system behaves like a retrieval and synthesis layer, not a giant prompt dump.

## 8. Artifact Export And Markdown Download

This layer lets the user take the canonical PRD out of Scrimble in a clean, portable format.

### H1. Add a markdown download for the canonical PRD

Depends on: A3, C1, C5, D3

Unlocks: none

Problem:
- The app can show the canonical PRD in the UI, but it does not yet give the user a simple way to download that artifact as markdown.
- If the plan is the source of truth, the user should be able to export it without rebuilding it from a stale screen copy.

Work:
- Add a download action on the generation or plan surface.
- Render the download from the canonical authored record and its deterministic markdown serializer.
- Keep the export tied to the same content the app uses in the live plan view.
- Make sure the downloaded markdown reflects the authoritative plan, not a legacy or partially reconstructed version.

Acceptance:
- The user can download the current PRD as markdown.
- The downloaded file matches the canonical authored record.
- Export does not depend on legacy plan text or stale UI state.

Relevant areas:
- `src/pages/ProjectGeneration.tsx`
- `functions/server/generation-pipeline.ts`
- `functions/server/app.ts`

---

## Suggested Execution Order

If this needs to be done in a strict sequence, use this order:

1. A1, A2, A3
2. B1, B2, B3, B4
3. C1, C2, C3, C8
4. C4, C5, C6, C7
5. D1, D2, D3
6. D4, D5, D6, D7
7. E1, E2, E3, E4
8. F1, F2, F3, F4
9. G1, G2, G3, G4
10. H1

If the team wants some parallelization, the safe split is:

- Track 1: state model and schema
- Track 2: research and retrieval
- Track 3: UI refactor and surface cleanup
- Track 4: tests and verification after the foundations are stable

Do not run Track 3 or Track 4 as the primary focus before Tracks 1 and 2 are stable.

---

## What Success Looks Like

The repaired product should feel like this:

- A builder opens Scrimble and immediately knows what to do next.
- The current step is specific, tool-aware, and executable.
- The user cannot casually skip ahead without the system knowing it.
- The workspace profile genuinely changes what the app researches and how it speaks.
- The research layer can read many sources, compress them into evidence packs, and stay under context.
- The user can download the canonical PRD as markdown without relying on a screen scrape or stale copy.
- The plan feels like a map of the work, not a backlog or an admin editor.
- The backend has one coherent runtime model instead of a pile of overlapping rescue paths.
- Dead code is gone, placeholders are gone, and the product no longer looks assembled from leftovers.

If the app still feels like a set of disconnected systems after this plan, the dependency order was not respected.

---

## Phase 6 Runtime Bridge Checklist (Execution Notes)

This checklist tracks the bridge period where canonical runtime fields are the primary frontend/backend contract while legacy generation fields are still returned for compatibility.

- [x] Backend project/intake/status/approve/resume/cancel payloads include canonical `generation_runtime` with:
  - `runId`
  - `lifecycleStatus`
  - `currentBatch`
  - `isTerminal`
  - `canResume`
  - `isReviewRequired`
  - `providerId`
  - `heartbeatAt`
  - `completedBatches`
  - `failureClass`
- [x] Backend route branching is runtime-first (from canonical runtime state), with legacy `generation_status` treated as compatibility serialization.
- [x] Frontend shared contract includes `GenerationRuntime` on `Project`, `ProjectGenerationStatusResponse`, and `ProjectIntakeSession`.
- [x] Frontend data service normalizes runtime semantics in one place via `src/lib/generation-runtime.ts`.
- [x] Dashboard, Project Generation, Project Canvas, and intake resume flows consume runtime lifecycle semantics for main gating/CTA behavior.
- [x] Compatibility fields remained available during rollout (`generation_status` retained), while runtime fields acted as source of truth.
- [x] Legacy schema drop migration added: `migrations/023_drop_legacy_project_generation_columns.sql`.

### Runtime-bridge exit criteria before dropping legacy columns

- [x] Zero backend branch reads depend on `projects.generation_status` for lifecycle decisions.
- [x] Zero frontend behavior branches depend on legacy-only status values when canonical runtime is present.
- [x] Targeted runtime serializer and frontend normalization assertions pass.
- [x] Fresh intake -> generation -> review -> approve -> complete works with canonical runtime fields (`scripts/phase9-runtime-validation.assertions.ts`).
- [x] Failure -> resume and cancel -> resume flows are validated using canonical runtime fields (`scripts/phase9-runtime-validation.assertions.ts`).

---

## Phase 13: Production Readiness and Go-Live Gate (Execution Notes)

This phase is release-candidate hardening only: migration safety, validation, observability/runbook readiness, and go/no-go gating.

- [x] Added release-candidate runbook with migration/deploy/rollback/checklist criteria: `docs/release-candidate-go-live.md`.
- [x] Added post-`023` release-candidate assertions: `scripts/phase13-release-candidate.assertions.ts`.
- [x] Added centralized user-facing failure copy for Auth/Dashboard/New Project/Generation surfaces in `src/lib/ui-copy.ts`.
- [x] Added explicit post-`023` checks that runtime wiring is canonical (`generation_runs` + `projects.current_generation_run_id`) and legacy project lifecycle columns are absent.
- [x] Baseline validation suite (`lint`, `build`, `tsc`, phase 6-12 assertions) passes before Phase 13 additions.

### Phase 13 go/no-go required checks

- [x] canonical schema reset path confirmed via `migrations/0026_full_canonical_rebuild.sql` (legacy `021 -> 023` replay is no longer the go-live contract)
- [ ] full validation suite passed after migrated schema, including `scripts/phase13-release-candidate.assertions.ts`
- [ ] critical-flow bug-bash checklist completed and all blockers resolved
- [ ] mobile/narrow viewport QA completed with no blocking issues
- [ ] 100+ step benchmark completed with no blocking freezes/regressions
- [ ] docs/status truth reconciled and operator runbook reviewed

---

## Phase 14: Direct Production Rollout For Hobby Release (Execution Notes)

This phase executes go-live directly on production (no separate staging stack), with strict rollout discipline and blocker-only scope.

- [x] Scope freeze maintained: only release docs/checklist and release-blocking fixes are in scope.
- [x] Automated local preflight suite passes:
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
- [x] Go-live runbook updated for direct production rollout path: `docs/release-candidate-go-live.md`.

### Phase 14 direct rollout checklist

- [ ] production D1 backup/export taken before migrations
- [ ] production bindings verified (`DB`, `CHECKPOINT_BUCKET`, `WORKFLOW_SERVICE`, `GENERATION_WORKFLOW`, auth config)
- [ ] production code deploy completed (`npm run deploy` + `npm run deploy:consumer`, or `npm run deploy:all`)
- [x] canonical production schema aligned to `0026_full_canonical_rebuild.sql`
- [ ] paired runtime deploy completed (`npm run deploy:all` or same-window `deploy` + `deploy:consumer`)
- [ ] post-deploy behavior verification passed (first event + first heartbeat + no false liveness)
- [ ] critical-flow production bug-bash completed with pass/fail notes
- [ ] mobile-width sanity checks passed on Dashboard/Generation/Canvas/Detail/Settings
- [ ] one `100+` step benchmark passed with no blocking freezes or severe lag
- [ ] 24-48 hour monitoring window completed without release blockers

If any checklist item fails, rollout is blocked until the blocker is fixed.
