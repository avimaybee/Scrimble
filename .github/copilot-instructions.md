# Agent Instructions — Full-Stack Web Development

---

## 1. The Prime Directive — Read Before You Write

> **Before suggesting, generating, or modifying a single line of code, you MUST read and understand the existing implementation.**

This is non-negotiable. Violating it produces broken, duplicate, or inconsistent code.

**Concrete steps before any task:**

1. **Discover the codebase structure** — read the top-level directory tree, then drill into the directories most relevant to the task.
2. **Read every file that will be touched or that depends on what will be touched.** If unsure, read more, not less.
3. **Trace the data flow end-to-end** — identify where data originates (API, DB, context, mock), how it is transformed, and where it is consumed.
4. **Identify the established patterns** — naming conventions, service abstraction layers, state management approach, styling system, component structure. Match them exactly.
5. **Fetch the relevant SKILL.md** — before implementing any non-trivial feature (UI, API, DB, auth, etc.), search for and read the most relevant skill file. This is required, not optional.

Only after completing all five steps above should you write or suggest any code.

---

## 2. Architecture Principles

### Service Abstraction — Absolute Rule
- **All data access must go through the designated service layer** (e.g., `CmsService`, `ApiService`, or equivalent).
- Direct `fetch('/api/...')` calls inside components or pages are **strictly forbidden**.
- If you encounter a raw `fetch` in a component, refactor it into the service layer before proceeding.
- The service layer is the single source of truth for data contracts between frontend and backend.

### Modular Backend
- Keep backend routers thin — they dispatch only.
- Business logic lives in isolated handler modules (one concern per file).
- Shared utilities (CORS, DB helpers, response formatting) go in a `shared.ts` or equivalent.
- Never add logic to a router that belongs in a handler.

### State Management
- Global state (user session, app config, shared fetched data) lives in context or a dedicated store.
- Local component state handles only ephemeral UI concerns.
- Never duplicate global state inside local component state.

### Environment Strategy
- Development uses mocked/local data for fast iteration.
- Production uses real APIs and databases.
- Feature flags or env vars (`VITE_*`, etc.) control which path is active — never hardcode environment assumptions.

---

## 3. Database & Data Layer

### Schema Conventions
- Every table has: `id` (PK, auto or UUID), `created_at`, `updated_at`.
- Soft deletes preferred: `status` column (`published` / `draft` / `archived`).
- Scheduled content uses `scheduled_at` (ISO 8601).

### Localization
- Multi-lingual fields stored as JSON strings: `{"en": "...", "hi": "..."}`.
- Always serialize with a helper before writing; always parse with a helper before returning to the frontend.
- Frontend always receives typed DTO objects, never raw JSON strings.

### Versioning & Safety
- Every `PUT`/`PATCH` must fetch the existing row and save a version snapshot **before** applying changes.
- Never perform destructive updates without a recoverable history.

### Write Optimization
- Avoid high-frequency DB writes. Apply throttling/debouncing for analytics events, rate history, and similar high-volume writes.
- Debounce frontend-initiated writes via session tracking where possible.

---

## 4. Frontend — Design & Aesthetic Standards

### Refer the frontend-design.md SKILL file for detailed design guidelines.
### humanist-web-style.md represents our personal design language and should be loaded by default for all frontend work

---

## 5. Code Quality Standards

### TypeScript
- Strict mode always on.
- No `any`. Use `unknown` and narrow, or define a proper type.
- Interfaces for object shapes; types for unions and aliases.
- Exported types live in a dedicated `types/` directory or co-located `*.types.ts` file.

### Naming Conventions
- **Files**: `kebab-case` for components and utilities. Match the project's existing convention exactly.
- **Components**: `PascalCase`.
- **Functions & variables**: `camelCase`.
- **Constants**: `UPPER_SNAKE_CASE`.
- **Types/Interfaces**: `PascalCase`, prefix interfaces with `I` only if the project already does so.

### Error Handling
- Every async operation has explicit error handling.
- User-facing errors are friendly and actionable. Internal errors are logged with context.
- Never swallow errors silently.

### Comments & Documentation
- Comments explain *why*, not *what*. Code explains what.
- Complex algorithms and non-obvious decisions get a comment.
- Public service methods get JSDoc.

---

## 6. API Design

- RESTful by default. Follow existing route conventions precisely.
- All responses use a consistent envelope: `{ data, error, meta }` or whatever the project already uses — match it.
- Validate all inputs on the server side. Never trust client data.
- Return appropriate HTTP status codes (200, 201, 400, 401, 403, 404, 409, 500).
- CORS headers are set in a single shared location, never scattered across handlers.

---

## 7. Security

- Never expose secrets, API keys, or credentials in frontend code.
- Sanitize all user-generated content before storing or rendering.
- Parameterize all database queries — no string interpolation into SQL.
- Auth checks happen on the server, never rely solely on frontend guards.

---

## 8. Developer Workflow

### Before Starting Any Task
1. Read the task carefully. Identify ambiguities and resolve them before writing code.
2. Read all relevant existing code (see Section 0).
3. Fetch the relevant SKILL.md (see Section 1).
4. Plan the implementation mentally. Identify files to create/modify.

### Making Changes
- Make the smallest change that correctly solves the problem. Don't refactor unrelated code while solving a bug.
- If you discover a pre-existing bug or anti-pattern while working, flag it separately rather than silently changing unrelated behavior.
- Run through the change mentally: does it break any existing data flow, type contract, or pattern?

### Database Migrations
- Every schema change gets a migration file. Never mutate the schema directly.
- Apply locally first, verify, then apply to production.
- Migration files are append-only — never edit a previously applied migration.

### Deployment
1. `npm run build` — verify zero errors and zero type errors.
2. Run the local preview and manually verify the changed surfaces.
3. Deploy via the project's established pipeline.

---

## 9. Prohibited Patterns

These are hard rules. Finding one of these in existing code is a reason to refactor, not a reason to follow the pattern.

- ❌ Raw `fetch` calls in components or pages — use the service layer.
- ❌ `any` type in TypeScript.
- ❌ Hardcoded environment-specific values (URLs, keys, flags) outside of env config.
- ❌ Monolithic backend handlers — keep them modular and single-concern.
- ❌ Destructive DB updates without versioning/snapshotting.
- ❌ Placeholder UI with fake data shipped to production.
- ❌ Inline styles for anything that belongs in the design system.
- ❌ Logic duplication across the frontend and backend for the same validation rule.
- ❌ Skipping the "read existing code" step because the task seems small.

---

## 10. When in Doubt

- **Read more code.** The answer is almost always already in the codebase.
- **Match the existing pattern**, even if you think a different approach is better. Flag the inconsistency separately.
- **Ask before assuming** on anything that touches auth, payments, data deletion, or external API contracts.
- **Fetch the SKILL.md.** It exists for a reason.