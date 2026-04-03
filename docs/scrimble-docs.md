# Scrimble — Complete Project Documentation
### The Research-First Build Companion for Solo Builders
*Version 6.1 — April 2026 — Reflecting Batch 7 Verification & Research Telemetry*

> [!NOTE]
> Version 6.1 — Reflects the end-to-end implementation of Batch 7 Consistency Verification, Research Telemetry dashboard, and the dual-gate human-in-the-loop architecture.

---

## Table of Contents
1. [Product Vision](#1-product-vision)
2. [The Problem](#2-the-problem)
3. [What Scrimble Is](#3-what-scrimble-is)
4. [Core Philosophy](#4-core-philosophy)
5. [User Personas](#5-user-personas)
6. [Tech Stack](#6-tech-stack)
7. [Firebase Configuration](#7-firebase-configuration)
8. [Design System](#8-design-system)
9. [Language & Tone Guide](#9-language--tone-guide)
10. [Animation Specification](#10-animation-specification)
11. [Information Architecture](#11-information-architecture)
12. [Database Schema — Cloudflare D1](#12-database-schema--cloudflare-d1)
13. [Backend Architecture](#13-backend-architecture)
14. [AI Integration — BYOK & Agentic Workflows](#14-ai-integration--byok--agentic-workflows)
15. [Screen Specifications](#15-screen-specifications)
16. [Component Library](#16-component-library)
17. [Build Status](#17-build-status)
18. [Remaining Work](#18-remaining-work)
    - [Known Issue: High Reasoning Model Timeouts](#known-issue-high-reasoning-model-timeouts-march-2026)
19. [Future Roadmap](#19-future-roadmap)

---

## 1. Product Vision

**One line:** Scrimble is a research-first, turn-by-turn build companion for solo builders and vibe coders.

**The core product vision:** Scrimble sits open next to your IDE while you build. It tells you exactly what to do, where to go, and what to type — referenced to your actual tools — one step at a time. You read a step, implement it, mark it done, and the next step unlocks. The plan is alive and can be updated at any point through natural language.

**The Three Pillars:**
1. **Deep research upfront** — before generating any plan, the agent studies your exact stack, reads real documentation, fetches GitHub issues, and understands your specific tools. The plan it produces is evidence-based, not generic.
2. **Turn-by-turn navigation** — step content is not guidance or advice. It is exact, executable instructions. Not "set up your database." Instead: "Open Supabase. Go to Table Editor. Create a table called 'users'. Add these exact columns. Then come back here and mark this done."
3. **The forcing function** — users cannot proceed to the next step until the current one is complete. This is the core behaviour-change mechanism. It is not gamification. It is structured discipline that prevents scope drift — the single biggest problem vibe coders face.

**The emotional promise:** Scrimble is a companion you have open alongside your IDE, not a tool you visit occasionally. The north star is that after building 3-5 projects through Scrimble, users subconsciously learn the end-to-end process of building real software — not because Scrimble teaches them explicitly, but because they live it step by step every time.

**Built for vibe coders:** Built first and foremost for the builder who vibe codes — someone who moves fast, loses context easily, and gets distracted by shiny features before core ones are done. "If it works perfectly for the builder who made it, it works for everyone."

---

## 2. The Problem

Builders are fast, creative, and AI-native. The problem isn't skill — it's **context loss and scope drift**.

Here's what actually happens mid-project:
- You start building something. Three days in, you're deep in a feature you didn't plan for.
- You juggle Claude, ChatGPT, Grok, Gemini, and Perplexity across 15 browser tabs trying to piece everything together at once.
- You come back after a weekend and genuinely don't remember what state the project is in.
- You keep starting over because the foundation wasn't solid before the next layer went on top.

The result: projects that are 70% done forever, or apps that work in demos but fall apart in real use.

**The issue isn't that builders don't know what good work looks like. It's that there's no system keeping them focused on one thing at a time.**

---

## 3. What Scrimble Is

Scrimble is a **build companion** that guides you through the entire lifecycle of a project:

1. **Intake & Research:** Takes your project idea, asks clarifying questions, and performs deep research into your specific tools and stack.
2. **Turn-by-Turn Navigation:** Breaks the project into exact, executable instructions (e.g. "Open AI Studio → Build mode → paste this prompt → download the output → open in VS Code").
3. **The Bridge:** Connects planning and building by telling you exactly what to do in your specific tools, in sequence, without ambiguity.
4. **Structured Discipline:** Prevents scope drift by locking the path forward until the current step is confirmed done.
5. **Living Plan:** The workflow adapts in real-time to your changes through natural language.

**The Companion App Use Pattern:**
- User has IDE open on one side, Scrimble open on the other.
- They read the current, tool-specific step in Scrimble.
- They go implement it in their IDE/Tools.
- They come back and mark it done; the next step unlocks.
- This loop repeats until the project is finished.

**What Scrimble is NOT:**

| It's not... | Because... |
|---|---|
| A research tool | It *uses* research to give you executable steps |
| A build companion | It guides the builder, it doesn't just manage tasks |
| A code generator | Your AI coding tools do that — Scrimble guides the *how* and *when* |
| A static checklist | The plan is alive and knows your specific tools |
| Another chatbot | It has structure, memory, and a visual workflow anchor |

---

## 4. Core Philosophy

### One Step at a Time
The entire experience is built around a single principle: **finish this before you touch that.** Each step is a focused unit of work. You can't move to the next step until the current one is done. This is the core mechanism of **structured discipline** that prevents the context-switching and scope drift that kills projects.

### AI Does the Work, You Make the Calls
Scrimble's AI agents handle research, writing, planning, and suggestions. They work autonomously through each step. But at key moments — before irreversible decisions, before moving to the next stage — Scrimble pauses and puts the choice in your hands. This is **human-in-the-loop**: the AI works hard, you stay in control.

### Bring Your Own AI
Scrimble works with whatever AI you already use and trust. Connect your own API keys — OpenAI, Anthropic, Google Gemini, or any custom provider that follows the OpenAI API format. Scrimble never forces you into one model. You're already paying for these tools — Scrimble just orchestrates them better.

### Plain Language, Always
You never fill out a form with dropdowns. You never select from a list. You describe what you want in plain language and Scrimble understands. Changing your plan? Just say so. Adding a feature? Just describe it. Scrimble talks to you like a smart colleague, not a piece of software.

### No Jargon
Scrimble uses plain, human language throughout. There are no "nodes," no "phases," no "PRDs," no "exit criteria." There are **steps**, **stages**, and **tasks** — words a normal person would use. See the [Language & Tone Guide](#9-language--tone-guide) for the full terminology map.

### The Workflow is Alive
Plans change. Scrimble's plan isn't a static document — it's a living structure that updates when you describe a change. Switching technologies? Changing scope? Adding a new feature? Tell Scrimble in plain language. The whole plan adapts.

### The Daily Re-Entry Loop
The most important moment in Scrimble is when you open it after being away. It immediately shows you where you are, what's next, and what the AI has prepared for you. This morning re-entry loop is what makes Scrimble indispensable.

---

## 5. User Personas

### Primary — The Solo Builder / Vibe Coder
- Builds primarily by prompting AI tools (Claude, Cursor, Copilot, etc.)
- Ships fast but struggles with consistency across a full project
- Loses context between sessions and between AI tools
- Has strong product instincts but uneven process
- **Wants to build things that are actually finished, polished, and stable**

### Secondary — The Freelance Developer
- Builds client projects, often solo or in small teams
- Needs a repeatable, consistent delivery process
- Currently recreates the same workflow manually for every project
- Wants something that keeps them accountable and on track

---

## 6. Tech Stack

### Frontend
| Concern | Choice | Notes |
|---|---|---|
| Framework | Vite + React (client SPA) | Vite-built SPA; single-page app with client routing and Hono API routes |
| Language | TypeScript | End-to-end type safety |
| Styling | Tailwind CSS + CSS Variables | Utility classes + design tokens |
| Canvas | React Flow (`@xyflow/react`) | Step-based graph rendering |
| Animation | Framer Motion | All transitions and interactions |
| State | Zustand | Client-side app state |
| Icons | Lucide React | Consistent icon set |
| Fonts | Fraunces + DM Sans + JetBrains Mono | See Design System |
| UI Primitives | shadcn/ui (selective only) | Dialog, Tooltip, DropdownMenu, Sonner |
| HTTP Client | `hono/client` or native fetch | Typed API calls to Pages Functions / Workers |

### Run & Deploy
Use the repo's npm scripts for local dev and deployments. Key commands:

```bash
# Local dev (Vite)
npm run dev

# Build frontend (Vite) and deploy Pages
npm run build
npm run deploy   # runs Vite build then `wrangler pages deploy dist`

# Deploy consumer/background worker
npm run deploy:consumer  # uses wrangler and wrangler.consumer.toml

# Deploy both
npm run deploy:all
```

Note: the project is deployed to Cloudflare Pages for the frontend + Pages Functions API; background generation runs in a separate Cloudflare Worker (see `wrangler.consumer.toml`) that hosts the primary `GenerationWorkflow` runtime. Pages calls that worker through a Service Binding (`WORKFLOW_SERVICE`) defined in `wrangler.toml`, which is the source of truth for the Pages deployment.

### Backend
| Concern | Choice | Notes |
|---|---|---|
| Runtime | Cloudflare Pages Functions | Edge serverless — owns the API, dispatches workflow events, and streams generation state |
| Background Jobs | Cloudflare Workflows (in standalone Worker) | Hosts `GenerationWorkflow` as the primary pipeline runtime; each `step.do()` gets isolated retries/timeouts/subrequest budgets |
| Canonical Runtime | `generation-runtime.ts` | Shared logic between Pages and Workflow Workers for writing to `generation_runs` and `project_generation_events`. |
| Database | Cloudflare D1 (SQLite) | Relational, edge-native, shared between environments |
| Auth | Firebase Auth (auth only) | Google OAuth — JWT verification in Functions |
| AI Routing | Function-side proxy | All AI calls proxied through Functions or Background Worker |
| Host | Cloudflare Pages | Unified frontend and API deployment |

### shadcn Usage Policy
**Use shadcn for invisible infrastructure only:**
- `Dialog` — confirmation modals, human-in-the-loop review prompts
- `Tooltip` — step hover info, locked state explanations
- `DropdownMenu` — export options, user avatar menu
- `Sonner` — completion toasts, agent status notifications

**Build custom for everything visual:**
- Step cards, stage groups, detail panel, progress bars, bottom pill nav
- All buttons — shadcn buttons fight the design token system
- All inputs — same reason
- Chips, badges, checklist items

### External Libraries — Full Liberty
Any library that genuinely improves the product may be used. Suggested candidates:
- `nanoid` — ID generation for D1 records
- `zod` — Schema validation for AI JSON responses
- `@tanstack/react-query` — Server state, caching, background refetching
- `react-markdown` — Render AI-generated content
- `react-hotkeys-hook` — Keyboard shortcuts
- `date-fns` — Date formatting
- `hono` — Lightweight Workers router

Note: `next-themes` was removed during dependency cleanup; theme behavior is handled through the app’s own CSS/token system.

---

## 7. Firebase Configuration

Firebase is used **exclusively for authentication**. No Firestore, no Realtime Database, no Firebase Storage. User identity (UID + email) from Firebase is used as the primary key in Cloudflare D1.

### Installation
```bash
npm install firebase
```

### Configuration
```typescript
// lib/firebase.ts
import { initializeApp } from "firebase/app"
import { getAuth } from "firebase/auth"

const firebaseConfig = {
  apiKey: "AIzaSyBjaSbuwgaFSBDmhAEX5TcLuOPokBMNyp0",
  authDomain: "scrimble-auth.firebaseapp.com",
  projectId: "scrimble-auth",
  storageBucket: "scrimble-auth.firebasestorage.app",
  messagingSenderId: "714624747391",
  appId: "1:714624747391:web:214613547d5e8ace2ebc4a",
  measurementId: "G-EBBT2RYJQD"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
```

> Analytics (`getAnalytics`) is optional — only initialise it if you want usage tracking. Do not include it in the core auth setup.

### Auth Flow
```
1. User signs in via Firebase Auth (Google OAuth)
2. Firebase returns a JWT (ID token)
3. Frontend attaches token to every API request: Authorization: Bearer <token>
4. Cloudflare Worker verifies the JWT using Firebase's public keys
5. Decoded Firebase UID is used to query D1: WHERE user_id = '{uid}'
```

### Firebase JWT Verification in Pages Functions
```typescript
// functions/middleware/auth.ts
export async function verifyFirebaseToken(token: string, firebaseProjectId: string): Promise<string> {
  const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
    issuer: `https://securetoken.google.com/${firebaseProjectId}`,
    audience: firebaseProjectId,
  });
  return payload.sub; // Firebase UID
}
```

---

## 8. Design System

### Design Direction
Scrimble's aesthetic is **editorial dark + warm craft**. It sits at the intersection of a high-end tech magazine and a tool built by someone who cares deeply. Warm, confident, considered — not cold, not corporate, not generic SaaS.

Design inspirations: Tatem (atmospheric, lightning fast), Becklyn (editorial type, bold confidence), Wise Design (weaponized whitespace, scale), Healthy Together (single dramatic visual element, dark foundation).

### Color Palette — Warm Earth System

```css
:root {
  /* ── BACKGROUNDS ── */
  --bg-base:      #0f0e0e;   /* warm near-black — the canvas */
  --bg-surface:   #1e1d1b;   /* cards, sidebar, panels */
  --bg-elevated:  #252422;   /* inputs, hover states */
  --bg-overlay:   #34312e;   /* modals, dropdowns */

  /* ── BORDERS ── */
  --border-subtle:  rgba(204,197,185,0.05);
  --border-default: rgba(204,197,185,0.10);
  --border-strong:  rgba(204,197,185,0.18);

  /* ── TEXT ── */
  --text-primary:   #fffcf2;   /* warm cream — never stark white */
  --text-secondary: #ccc5b9;   /* dust grey — body copy */
  --text-tertiary:  #807d76;   /* placeholders, disabled */
  --text-muted:     #53514c;   /* truly faded */

  /* ── ACCENT — Spicy Paprika ── */
  --accent:         #eb5e28;
  --accent-hover:   #ef7f53;
  --accent-soft:    #f39f7e;   /* text on dark backgrounds */
  --accent-muted:   rgba(235,94,40,0.12);
  --accent-border:  rgba(235,94,40,0.30);

  /* ── STAGE COLORS (for step card top stripes) ── */
  --stage-understand:   #d97706;
  --stage-document:     #a78bfa;
  --stage-architecture: #f472b6;
  --stage-design:       #fbbf24;
  --stage-build:        #34d399;
  --stage-validate:     #38bdf8;
  --stage-secure:       #f87171;
  --stage-deploy:       #fb923c;
  --stage-maintain:     #a3e635;

  /* ── STATUS ── */
  --status-locked:   rgba(204,197,185,0.04);
  --status-active:   rgba(235,94,40,0.15);
  --status-complete: rgba(52,211,153,0.15);
  --status-waiting:  rgba(251,191,36,0.12);   /* human-in-the-loop waiting */
  --status-skip:     rgba(248,113,113,0.10);

  /* ── SPACING ── */
  --space-section: 100px;
  --space-gap:     48px;
  --space-card:    28px;
  --space-tight:   16px;

  /* ── RADIUS ── */
  --radius-badge:  6px;
  --radius-btn:    8px;
  --radius-step:   10px;
  --radius-card:   14px;
  --radius-panel:  16px;
}
```

**Why this palette:** `#0f0e0e` has a warm brown undertone — not cold techy black. `#fffcf2` is warm cream — not stark white, feels like paper. `#eb5e28` paprika is completely unique in the builder tools space — warm, energetic, nothing like the tired indigo/purple every AI tool defaults to.

### Typography
```css
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&family=JetBrains+Mono:wght@300..700&display=swap');

--font-display: 'Fraunces', serif;          /* hero headings, section headings */
--font-ui:      'DM Sans', sans-serif;      /* all UI, body copy, labels */
--font-mono:    'JetBrains Mono', monospace; /* metadata, status labels, code */
```

**Scale:**
```
Hero:         clamp(44px, 5vw, 68px)  Fraunces  800+italic   -0.03em  1.05
Section:      clamp(28px, 3vw, 40px)  Fraunces  600          -0.025em 1.1
Panel title:  18px                    DM Sans   600          -0.02em  1.3
Body:         14–15px                 DM Sans   400          -0.01em  1.6
Metadata:     10–11px                 JetBrains 500          +0.06em  uppercase
```

**Heading weight contrast (Becklyn technique):**
```html
<h1>
  <span style="font-weight:800">Build it. Ship it.</span>
  <span style="font-style:italic; font-weight:300; color:var(--text-secondary)">
    Don't lose the thread.
  </span>
</h1>
```

### Section Labels
Every section uses a mono uppercase label with a paprika dash:
```tsx
// Implement with a span for precise alignment
<div className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.08em]">
  <span className="h-[1.5px] w-4 shrink-0 rounded-sm bg-accent-primary" />
  {children}
</div>
```

### Never Use
- `border-radius: 9999px` on buttons (use `--radius-btn: 8px`)
- Inter, Roboto, Arial, or system fonts anywhere
- Purple or indigo as accent
- Stark `#ffffff` white (use `#fffcf2`)
- Pure `#000000` black (use `#0f0e0e`)
- Gradient text on headings
- Centered hero layout (use left-anchored 52/48 grid)
- Grey placeholder rectangles in feature visuals
- Filled colored badge backgrounds (transparent + border only)

---

## 9. Language & Tone Guide

Scrimble uses zero technical jargon. Every word should be understandable to someone who has never shipped software before.

### Terminology Map

| Technical term (never use) | Scrimble language (always use) |
|---|---|
| Node | Step |
| Phase | Stage |
| Workflow | Plan / Build plan |
| PRD / BRD | Project brief |
| Architecture | How it's built |
| Exit criteria | Done when... |
| AI enrichment | Getting details |
| Schema | Data structure |
| Deploy | Go live / Launch |
| Edge case | What could go wrong |
| Technical debt | Things to fix later |
| Gated progression | Unlock the next step |
| Human-in-the-loop | Your review |
| Risk level | How important this is |
| Canvas | Your plan (the visual overview) |
| Onboarding | Getting started |

### Tone Principles
- **Direct, not corporate.** "Here's what to do next" not "Please review the following recommended action items."
- **Warm, not cheerful.** Don't use exclamation marks everywhere. Confidence is warmer than enthusiasm.
- **Honest about AI.** When the AI did something, say so. "I've drafted this for you" not "Here is the documentation."
- **Specific, not vague.** "Set up your database" not "Complete the infrastructure step."
- **Human.** Talk like a smart colleague, not a product interface.

### UI Copy Examples
```
Instead of: "No projects found. Create a new project to get started."
Use:        "You haven't started anything yet. Tell me what you want to build."

Instead of: "Complete all required checklist items to unlock downstream nodes."
Use:        "Finish the items above to move forward."

Instead of: "AI enrichment in progress. Please wait."
Use:        "I'm working on this..."

Instead of: "Configure your AI provider API key."
Use:        "Add your AI key to get started."

Instead of: "Workflow generation complete."
Use:        "Your plan is ready."

Instead of: "Human-in-the-loop review required."
Use:        "Before I continue — does this look right to you?"
```

---

## 10. Animation Specification

Animations must feel **purposeful and premium** — every motion communicates a state change. Nothing animates for decoration.

### Core Easing
```css
--ease-out-expo:   cubic-bezier(0.16, 1, 0.3, 1);   /* primary — fast start, soft land */
--ease-spring:     { stiffness: 100, damping: 20 };  /* Framer spring — progress bars */
--ease-gentle:     cubic-bezier(0.4, 0, 0.2, 1);     /* subtle state changes */
```

### Page Load — Staggered Reveal
Every page above-the-fold elements stagger in on mount:
```typescript
const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } }
}
const itemVariants = {
  hidden:  { y: 16, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }
}
// Apply to: page heading, subheading, CTA buttons, first content block
// Do NOT apply to: canvas steps (render independently), sidebar list items
```

### Step Unlock Animation
When completing a step unlocks the next one:
```typescript
// On the newly unlocked step card:
initial:  { scale: 0.94, opacity: 0.35 }
animate:  { scale: 1, opacity: 1 }
transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] }

// Border transition: locked grey → active paprika
// CSS transition: border-color 300ms ease, box-shadow 300ms ease

// Glow pulse (one-shot, not looping):
// box-shadow: 0 0 0 1px rgba(235,94,40,0.3) → 0 0 16px 4px rgba(235,94,40,0.2) → back
// keyframe animation, 600ms, fires once
```

### Step Card Active Pulse
The currently active step card has a very subtle, slow breathing animation:
```css
@keyframes step-pulse {
  0%, 100% { box-shadow: 0 0 0 1px rgba(235,94,40,0.3), 0 4px 20px rgba(235,94,40,0.08); }
  50%       { box-shadow: 0 0 0 1px rgba(235,94,40,0.5), 0 4px 28px rgba(235,94,40,0.16); }
}
/* Duration: 3s, ease-in-out, loops. Slow — not distracting. */
```

### Panel Slide-In
```typescript
// Right panel opening:
initial:  { x: 32, opacity: 0 }
animate:  { x: 0, opacity: 1 }
transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] }

// Canvas shrinks to accommodate (not overlap):
// canvas right padding transitions: 0px → 420px over same duration
```

### AI Working Animation
When an AI agent is actively working on a step:
```typescript
// The step card enters a "working" state:
// - Top stripe becomes an animated gradient sweep (paprika shimmer)
// - A subtle progress bar beneath the title pulses (indeterminate)
// - Card border glows softly

// Indeterminate progress bar:
@keyframes agent-sweep {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.agent-progress {
  height: 2px;
  background: linear-gradient(90deg, 
    transparent 0%, 
    var(--accent) 40%, 
    var(--accent-soft) 50%, 
    var(--accent) 60%, 
    transparent 100%
  );
  background-size: 200% 100%;
  animation: agent-sweep 1.8s linear infinite;
}
```

### Human-in-the-Loop Attention Animation
When an AI agent pauses and needs your input before continuing:
```typescript
// Step card enters "waiting" state:
// Border pulses amber (not paprika):
@keyframes waiting-pulse {
  0%, 100% { border-color: rgba(251,191,36,0.3); }
  50%       { border-color: rgba(251,191,36,0.7); }
}
// Duration: 2s, ease-in-out

// A floating badge appears above the card:
// "Your input needed" — amber, slides down from above the card
initial:  { y: -8, opacity: 0, scale: 0.9 }
animate:  { y: 0, opacity: 1, scale: 1 }
transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] }
```

### Checklist Tick
```typescript
// Custom checkbox with SVG checkmark draw-on:
// Checkbox background: transparent → var(--accent), 150ms
// Checkmark SVG: stroke-dashoffset from path length → 0, 200ms ease-out
// Label: color transition text-secondary → text-tertiary, line-through appears, 150ms
// Micro-bounce: scale 1 → 1.15 → 1, 200ms spring
```

### Progress Bar Fill
```typescript
// Framer Motion spring, never jumps:
transition: { type: 'spring', stiffness: 100, damping: 20 }
// Glowing dot tip at leading edge of fill
```

### Scroll Reveals (Landing Page)
```typescript
// All feature sections:
whileInView={{ y: 0, opacity: 1 }}
initial={{ y: 24, opacity: 0 }}
viewport={{ once: true, margin: "-80px" }}
transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}

// Feature visuals: slight delay after text
transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
```

### Toast / Notification
```typescript
// Unlock toast:
initial:  { opacity: 0, y: 8, scale: 0.95 }
animate:  { opacity: 1, y: 0, scale: 1 }
exit:     { opacity: 0, y: -8, scale: 0.97 }
transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] }
// Auto-dismiss: 2.5s
```

### Page Transitions
```typescript
// Between routes (client SPA transitions):
// Outgoing: opacity 1 → 0, y 0 → -8, 200ms
// Incoming: opacity 0 → 1, y 8 → 0, 300ms, delay 100ms
```

### Bottom Pill Nav (App Pages)
```typescript
// On mount: y: 24 → 0, opacity: 0 → 1, delay 400ms (after page content)
// Active item switch: background slides with layout animation
// layoutId="active-pill" on the active indicator for smooth morphing
```

### 10.14 Thinking State & Loading Transparency
Animations alone aren’t enough — Scrimble must be transparent about *why* the user is waiting.
- **Agent Thinking**: The `ThinkingBubble` component renders a dedicated "Agent Thoughts" card while reasoning exists. It uses a spinning `Sparkles` icon and a breathing `Brain` pulse to signal active reasoning. Content is streamed via canonical `thinking` SSE events and replayed only for active runs within a bounded window.
- **Modular Skeletons**: The `Skeleton` component provides four consistent variants (`body`, `heading`, `circle`, `badge`) to bridge the gap between initial mount and data arrival.
- **Progressive Disclosure**: As the agent works, the UI never blocks. It populates skeletons in the detail panels while the `ThinkingBubble` streams the latest reasoning in real-time.

---


## 11. Information Architecture

### Routes
```
/                     → Landing page
/login                → Auth (Google + email)
/signup               → Signup
/dashboard            → Projects list — daily re-entry screen
/new                  → New project (natural language input)
/project/[id]         → Main plan timeline/stream view
/project/[id]/step/[stepId] → Step detail (URL state)
/project/[id]/generating → Live generation progress screen
/settings             → User preferences, AI key management
```

### Navigation Patterns

- Landing, authentication, `/new`, and the live generation journeys intentionally render without the pill nav so those entry points stay focused. Only the dashboard, the timeline (`/project/:id`), and the settings shell inherit the nav chrome from `AppLayout`.
- The bottom Pill Nav labels its tabs **Plan / Projects / Settings**. “Plan” links to the last active project (and is disabled until a plan is open), “Projects” always returns to `/dashboard`, and “Settings” anchors to `/settings`. The active pill uses the layoutId “pill-nav-active” so the paprika indicator animates smoothly between tabs, and the layout also adds 104px of bottom padding whenever the nav is present so content never collides with it.
- All other routes (landing, `/login`, `/signup`, `/new`, `/project/:id/step/[stepId]`, the generation screen, and any modal-heavy state) deliberately hide the nav, keeping the interface free of distracting chrome while the user is signing in, starting a plan, or reviewing a step.

### Build Stages
Every project is guided through these stages (AI selects relevant ones based on the description):

| Stage | Plain Language Name | Purpose |
|---|---|---|
| understand | Figure out what you're building | Goals, users, what success looks like |
| document | Write it down | Project brief, what's in/out, key decisions |
| architecture | Plan how it's built | System design, data, third-party services |
| design | Plan how it looks | Screens, flows, visual direction |
| build | Build it | Feature by feature, in the right order |
| validate | Make sure it works | Testing, edge cases, real-world scenarios |
| secure | Lock it down | Authentication, access, sensitive data |
| deploy | Go live | Launch checklist, monitoring, rollback plan |
| maintain | Keep it healthy | Errors, feedback, what to improve next |

### Step Content Model (internal)

| Field | Description |
|---|---|
| title | What this step is |
| instructions | **Exact instructions** — e.g. "Open [specific tool], go to [specific location], do [specific action]" |
| tool_references | References to the user's actual connected tools by name |
| external_links | Links to the exact page or tool the user needs to open |
| navigation_links | **Next-action links** — tool-specific deep links (e.g. to a Stripe dashboard or GitHub issue) |
| what_to_bring_back | What the user should have when they return to mark this done |
| prompts | **Exact prompts** (approx. 10% of content) to paste into AI coding tools |
| objective | What gets done here |
| why_it_matters | What goes wrong if skipped (The "Why") |
| checklist | Concrete items required before unlocking the next step |
| status | waiting / working / needs review / complete / skipped |
| research_footer_meta | Metadata on which tools and versions were researched to build this step guidance |
| is_gate | Requires your review before AI continues |

---

## 12. Database Schema — Cloudflare D1

Cloudflare D1 uses SQLite syntax. All IDs are `TEXT` generated with `nanoid`. JSON fields are stored as `TEXT` and parsed in the application layer. Booleans are `INTEGER` (0/1).

```sql
-- ────────────────────────────────────────────
-- USER PROFILES
-- Firebase UID is the primary key
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id                      TEXT PRIMARY KEY,     -- Firebase UID
  name                    TEXT,
  email                   TEXT,
  fast_model_provider_id  TEXT REFERENCES ai_providers(id) ON DELETE SET NULL,
  fast_model_name         TEXT,
  deep_model_provider_id  TEXT REFERENCES ai_providers(id) ON DELETE SET NULL,
  deep_model_name         TEXT,
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- AI PROVIDER KEYS
-- User's own API keys — encrypted at rest
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_providers (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,        -- display name e.g. "My OpenAI Key"
  provider        TEXT NOT NULL,        -- 'openai' | 'anthropic' | 'gemini' | 'custom'
  api_key_enc     TEXT NOT NULL,        -- AES-256 encrypted API key
  base_url        TEXT,                 -- for custom providers (OpenAI-compatible)
  model           TEXT,                 -- provider fallback model
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- AI MODELS
-- Individual models connected to a provider
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_models (
  id              TEXT PRIMARY KEY,
  provider_id     TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- MCP SERVER CONNECTIONS
-- Research tool credentials — encrypted at rest
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcp_servers (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  server_type     TEXT NOT NULL,        -- 'brave-search' | 'github' | 'context7' | 'custom'
  name            TEXT NOT NULL,
  config_enc      TEXT NOT NULL,        -- AES-256 encrypted JSON config
  is_active       INTEGER DEFAULT 1,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- PROJECTS
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,                 -- raw natural language description from user
  project_type    TEXT,                 -- AI-inferred: 'saas_mvp' | 'client_site' | 'internal_tool' | 'other'
  intake_answers  TEXT,                 -- JSON payload of initial interview
  stack           TEXT,                 -- JSON: { frontend, backend, auth, deploy, ai_tools, payments }
  status          TEXT DEFAULT 'active',-- 'active' | 'completed' | 'archived'
  risk_score      INTEGER DEFAULT 0,    -- 0-100, recalculated on step changes
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- WORKFLOWS (one per project)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflows (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version         INTEGER DEFAULT 1,
  canvas_state    TEXT,                 -- JSON: React Flow viewport { x, y, zoom }
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- STAGES (top-level groupings of steps)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stages (
  id              TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  type            TEXT NOT NULL,        -- 'understand' | 'document' | ... (see stage types)
  position_x      REAL DEFAULT 0,
  position_y      REAL DEFAULT 0,
  order_index     INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'locked',-- 'locked' | 'active' | 'complete'
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- STEPS (individual units of work)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS steps (
  id                  TEXT PRIMARY KEY,
  workflow_id         TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  stage_id            TEXT REFERENCES stages(id),
  title               TEXT NOT NULL,
  type                TEXT NOT NULL,    -- 'task' | 'decision' | 'review' | 'ai_output'
  category            TEXT,             -- matches stage type for color coding
  position_x          REAL DEFAULT 0,
  position_y          REAL DEFAULT 0,
  status              TEXT DEFAULT 'locked',
  -- 'locked' | 'active' | 'agent_working' | 'needs_review' | 'complete' | 'skipped'
  is_gate             INTEGER DEFAULT 0, -- 1 = AI pauses here for human review
  risk_level          TEXT DEFAULT 'low',
  order_index         INTEGER DEFAULT 0,
  -- AI-generated shallow content (from initial plan generation)
  objective           TEXT,
  why_it_matters      TEXT,
  suggested_tools     TEXT,             -- JSON: [{ name, url, reason }]
  done_when           TEXT,
  -- AI enrichment content (generated when step is first opened)
  is_ai_enriched      INTEGER DEFAULT 0,
  ai_output           TEXT,             -- generated artifact
  prompts             TEXT,             -- JSON: [{ label, content }]
  research_footer_meta TEXT,            -- JSON: per-step research metadata
  navigation_links     TEXT,            -- JSON: per-step navigation links
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- EDGES (connections between steps)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edges (
  id              TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  source_step_id  TEXT REFERENCES steps(id) ON DELETE CASCADE,
  target_step_id  TEXT REFERENCES steps(id) ON DELETE CASCADE,
  edge_type       TEXT DEFAULT 'default', -- 'default' | 'conditional'
  condition       TEXT
);

-- ────────────────────────────────────────────
-- CHECKLIST ITEMS
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_items (
  id              TEXT PRIMARY KEY,
  step_id         TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  is_required     INTEGER DEFAULT 0,
  is_completed    INTEGER DEFAULT 0,
  completed_at    TEXT,
  order_index     INTEGER DEFAULT 0
);

-- ────────────────────────────────────────────
-- GENERATION RUNS (Source of Truth for execution)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS generation_runs (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id                TEXT NOT NULL UNIQUE, -- Stable logical run identifier
  workflow_instance_id  TEXT,                 -- Cloudflare Workflow ID
  lifecycle_status      TEXT NOT NULL DEFAULT 'queued', -- canonical lifecycle field
  current_batch         TEXT,                 -- 'batch_1_research_stack' | ...
  is_terminal           INTEGER NOT NULL DEFAULT 0,
  can_resume            INTEGER NOT NULL DEFAULT 0,
  is_review_required    INTEGER NOT NULL DEFAULT 0,
  provider_id           TEXT,                 -- Resolved AI provider for the run
  completed_batches     TEXT DEFAULT '[]',
  failure_class         TEXT,
  error_message         TEXT,                 -- Last seen error message
  heartbeat_at          TEXT,                 -- ISO timestamp of last worker activity
  started_at            TEXT DEFAULT (datetime('now')),
  completed_at          TEXT,
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- AGENT RUNS (execution logs)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_runs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id          TEXT,           -- logical generation run identifier
  step_id         TEXT REFERENCES steps(id),
  run_type        TEXT NOT NULL,  -- 'generate_plan' | 'enrich_step' | 'update_plan' | 'review_gate'
  status          TEXT DEFAULT 'running', -- 'running' | 'waiting_review' | 'complete' | 'failed'
  input           TEXT,           -- JSON: what was sent to the AI
  output          TEXT,           -- JSON: what the AI returned
  provider        TEXT,           -- which AI provider was used
  model           TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  completed_at    TEXT
);

-- ────────────────────────────────────────────
-- GENERATION EVENTS (Durable stream history)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_generation_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,  -- 'batch_start' | 'activity' | 'batch_complete' | ...
  batch_name      TEXT,
  payload         TEXT,           -- JSON: event data
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projects_user      ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_project  ON workflows(project_id);
CREATE INDEX IF NOT EXISTS idx_stages_workflow    ON stages(workflow_id);
CREATE INDEX IF NOT EXISTS idx_steps_workflow     ON steps(workflow_id);
CREATE INDEX IF NOT EXISTS idx_steps_stage        ON steps(stage_id);
CREATE INDEX IF NOT EXISTS idx_checklist_step     ON checklist_items(step_id);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_user   ON mcp_servers(user_id);
CREATE INDEX IF NOT EXISTS idx_gen_runs_project    ON generation_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gen_runs_lifecycle  ON generation_runs(lifecycle_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gen_events_project  ON project_generation_events(project_id, id);
```

```text
-- ACTIVE-RUN STATE (Thinking / Reasoning Relay)
-- Thinking deltas are persisted in D1 using the canonical generation_event envelope.
-- Replay is bounded and filtered to the active run only, and terminal completion/failure/cancel
-- clears thinking replay state from the live-session view.
```

Migration `010_schema_reconciliation.sql` patches the legacy schema (adds the missing `workflow_id` columns to `steps`, `stages`, and `edges`, and removes the obsolete `project_generation_live_state` table) so the backend and worker rely on a single consistent set of column names while reasoning replay remains explicit and bounded.


---

## 13. Backend Architecture

### Cloudflare Pages Functions — API Routes

All routes run on Cloudflare Pages Functions. Firebase JWT verified on every authenticated request via `Authorization: Bearer <token>`.

```
POST   /api/auth/sync              → Create/update profile in D1 from Firebase JWT

GET    /api/projects               → List user's projects
POST    /api/projects               → Create project and dispatch workflow generation
GET    /api/projects/:id           → Get full project + workflow + steps + edges
PATCH  /api/projects/:id           → Update project metadata

GET    /api/workflows/:id          → Get workflow with stages and steps
PATCH  /api/workflows/:id          → Update canvas viewport state
POST   /api/workflows/:id/update   → Natural language plan update → live MCP research → AI diff → D1 + re-enrichment

GET    /api/steps/:id              → Get full step content
PATCH  /api/steps/:id              → Update step status or content
POST   /api/steps/:id/complete     → Mark complete, unlock downstream steps
POST   /api/steps/:id/skip         → Skip step, note risk, unlock downstream
POST   /api/steps/:id/enrich       → Run AI step enrichment stream
POST   /api/steps/:id/review       → Submit human review (approve/reject at gate)

PATCH  /api/checklist/:itemId      → Toggle checklist item

GET    /api/ai/providers           → List user's AI providers
POST   /api/ai/providers           → Add new AI provider key
DELETE /api/ai/providers/:id       → Remove AI provider

GET    /api/settings/mcp-servers   → List user's research tools (configs masked)
POST   /api/settings/mcp-servers   → Add or replace a research tool connection
PATCH  /api/settings/mcp-servers/:id → Toggle research tool active/inactive
DELETE /api/settings/mcp-servers/:id → Remove research tool connection

POST   /api/ai/proxy               → Proxied AI call (uses user's stored key)
POST   /api/projects/:id/resume    → Resume a failed or interrupted project
POST   /api/projects/:id/approve   → Send architecture approval event to active workflow instance

> [!IMPORTANT]
> **Routing Gotcha**: Hono is configured with `.basePath('/api')`. When defining new routes, **do not** start the route string with `/api/`. 
> - Correct: `app.get('/steps', ...)` (mounts at `/api/steps`)
> - Incorrect: `app.get('/api/steps', ...)` (mounts at `/api/api/steps`, causing 404s)

```


### Cloudflare Workflow Primary Runtime

Project generation now runs inside `GenerationWorkflow`, a Cloudflare Workflow class hosted in the standalone consumer worker.

Architecture path:

- Browser → Pages Functions (`wrangler.toml`)
- Pages Functions → Service Binding `WORKFLOW_SERVICE` (`service = "scrimble-consumer"`)
- Consumer Worker → Workflow binding `GENERATION_WORKFLOW`
- Workflow executes `GenerationWorkflow`

- **Canonical Runtime Model**: `generation-runtime.ts` provides a unified service for managing `generation_runs`. Each dispatch creates a unique `run_id`, decoupling ephemeral workflow state from permanent project records.
- **Canonical Write Boundary**: All project state mutations (intake, retry, rollback, review, finalize) are funnelled through `createGenerationRun`, `updateGenerationRunStatus`, and `touchGenerationRunHeartbeat`. Legacy mutations directly on the `projects` table are deprecated.
- **Decommissioned Dual-Writes**: Project status columns in the `projects` table are no longer updated during generation. The UI read-path performs a `LEFT JOIN` on the latest `generation_runs` to synthesize project state.
- **Per-step budgets and retries**: The pipeline is split across `step.do(...)` units so each step gets its own retry policy, timeout, and fresh subrequest budget.
- **1MB step-state safe**: Large artifacts (Batch outputs, chunk store, architecture, plan) are written to R2 under `workflows/{projectId}/{runId}/*.json`; steps return only compact R2 keys.
- **SSE-friendly**: Durable events are written to `project_generation_events` via `insertGenerationEvent`, and `/api/projects/:id/generation-stream` replays history + polls D1 to keep the SPA live while workflow steps run in the background worker.
- **Dispatch safety**: Pages updates generation status and workflow instance linkage atomically around workflow dispatch so failed starts are rolled back and no ghost `queued` runs remain.
- **Unified Workflow Update**: Natural language plan updates (`/api/workflows/:id/update`) now share the same canonical pipeline logic and R2-backed checkpointing as the initial generation path.
- **Explicit Failure Semantics**: AI and transport errors are categorized into four classes: `transport_provider_transient`, `schema_correction`, `orchestration`, and `content_business_logic`. Retries are handled centrally based on these classes.

### Sequential Generation Pipeline

Project creation dispatches a dedicated generation run. The flow is as follows:

1. **Clarifying Questions Phase (Required)**: Before generation begins, Scrimble engages the user in a high-quality, editorial intake conversation. The agent asks 2-4 clarifying questions based on their initial description, focusing on real architectural trade-offs (e.g., "Real-time sync vs local storage?"). This ensures the agent makes deliberate decisions rather than generic assumptions.
2. **Batch 1 (Research Stack)**: Identifies the technologies needed based on the description and answers.
3. **Batch 2 (Fetch & Read)**: Deep research using connected tools (Context7, GitHub, Brave). Studies actual stack-specific documentation.
4. **Batch 3 (Architect)**: Designs the system. Pauses for human approval at the **Architecture Gate**.
5. **Batch 4 (Plan Build)**: Generates the sequence of steps and stages.
6. **Batch 5 (Enrich)**: Populates steps with turn-by-turn navigation, tool-specific instructions, and prompts.
7. **Batch 6 (File Generation)**: Generates the skill files for IDE implementation.
8. **Batch 7 (Verify)**: Performs comprehensive consistency, stack-integrity, and PRD-alignment checks. Pauses for final human approval at the **Verification Gate**.

Each batch executes in order with **Smart Caps** to ensure extreme thoroughness without reckless resource usage:
- **Infrastructure Safety**: 1-hour (3600s) maximum execution window for background tasks.
- **AI Patience**: 10-minute timeout per AI provider call (managed via AbortController).
- **Research Liberty**: 2-minute timeout for documentation fetches; up to 100,000 tokens processed per document.
- **Subrequest Guardrail**: Research fetching now runs through a strict sequential queue (one fetch at a time) and stops at 35 subrequests to preserve headroom under Cloudflare’s 50-subrequest worker limit.
- **Profile-Driven Retrieval Inputs**: Batch 2 and workflow update research now use one canonical retrieval-input contract where builder profile + confirmed stack technologies are primary and inferred tech only fills gaps.
- **In-memory RAG context control**: Batch 2 now chunks fetched materials and downstream batches retrieve only the most relevant chunks (top-k) per prompt, keeping research context targeted and under ~10k estimated tokens without model-specific prompt caps.
- **Output Freedom**: Up to 16,384 tokens per AI response to provide headroom for models with extensive reasoning/thinking blocks (e.g., GLM-5, DeepSeek-R1).
- **Thought-Only Guard**: If a model exhausts its output window with reasoning but provides no JSON content, the system automatically triggers a single "JSON-only" retry.

### Research Facade, Telemetry & Subrequest Tracking
Research is no longer performed directly by batches. Instead, all tools (documentation, GitHub, web search) are routed through the `ResearchFacade`.
- **Subrequest Tracker**: All fetches (even across multiple tools) share a single `SubrequestTracker` instance within a batch, ensuring strict enforcement of Cloudflare's 50-subrequest per-step limit.
- **Research Telemetry**: The system now emits real-time `research_telemetry` and `research_target_status` events during Batch 2. This allows the UI to surface live counters for chunks found, evidence packs created, and token consumption against the budget.
- **Target Skipping**: Builders can explicitly skip a research target (a specific technology or tool) via a "Skip" request from the UI. This sets `generation_runs.skip_target_requested` (and optional `skip_target_name`) for the active run, and Batch 2 checks it before and during each target cycle so skip requests apply to the currently active target when possible.
- **Durable Logging**: Parallel and sequential research fetches generate `activity` events, rendering a research footer that cites specific tools and sources used for each plan step.
- **Shadow Mode Ready**: The facade supports shadow-mode comparisons between legacy and new research toolsets without impacting the production generation path.
- **Unified Updates**: Plan updates use the same research facade for mini-research passes, ensuring parity between initial generation and mid-build changes.

### Resume, Retry & Cancellation Flow
The pipeline is designed for resilience. If a project hits a "snag", it is categorized and handled by the unified retry architecture.
1. **Centralized AI Error Discovery**: `classifyAIError` (in `ai.ts`) identifies errors from raw fetch results and provider throws.
2. **Four-Class Retry Policy**: 
   - `transport_provider_transient`: Automatic retry with exponential backoff (covers connection resets, 429s, 503s).
   - `schema_correction`: Automatic retry with "JSON-only" system override (covers malformed output).
   - `orchestration`: Terminals if infra limits hit.
   - `content_business_logic`: Terminal, requires user intervention or resume.
3. **Backend Support**: The `/api/projects/:id/resume` endpoint re-dispatches failed projects, picking up from the last incomplete batch through the active workflow.
4. **Guarded transitions**: The intake confirm, architecture approval, resume, and nudge endpoints use compare-and-set statements against `generation_runs.lifecycle_status`.
5. **Manual Stop / Kill Switch**: `POST /api/projects/:id/cancel` marks the run `cancelled` and terminates the active workflow instance. Checkpoints remain intact for later resumption.


### Professional Icon System
Scrimble strictly uses technical, engineering-focused icons (Lucide React) to maintain a professional aesthetic:
- **AI/Compute**: `Cpu`
- **Process/Structure**: `Workflow`
- **Execution/Monitoring**: `Activity`
- **Action/Trigger**: `Zap`
- *Prohibited: Any whimsical, magic, sparkle, or glitter-themed icons.*

### Observability & SSE Streaming
The "Heartbeat" of Scrimble lives in `/api/projects/:id/generation-stream`. This route delivers a high-integrity event stream using `TransformStream` and Cloudflare D1 persistence.

- **Durable Events**: `batch_start`, `activity`, `batch_complete`, `checkpoint`, and terminal `pipeline_complete`/`failed` tags are persisted in D1. Reconnecting clients receive a replay of all missed events via `Last-Event-ID`.
- **Transient Reasoning**: High-frequency `thinking` deltas are emitted using a **Throttled Emitter**. To protect IP and maintain a clean state, reasoning tokens are replayed only for active runs and are physically purged from D1 on terminal completion.
- **Connection Lifecycle**: The server sends a `: ping` every 20 seconds to keep edge proxies alive. On completion, the system explicitly calls `writer.close()` to prevent "ghost" polling.
- **Progress Synchronization**: Every `batch_complete` event includes a `progress_percent` metric, ensuring the UI progress bar perfectly mirrors backend completion.

> [!IMPORTANT]
> **Cloudflare Workflow Constraints**:
> - **Subrequest Limits**: 50 subrequests per `step.do()` invocation (fresh budget per batch).
> - **State Management**: Large payloads (research corpora, plans) are stored in R2; workflow steps only pass lightweight R2 keys and database IDs.
> - **Human Gating**: Architecture and Verification reviews use `step.waitForEvent(...)`, pausing the workflow until a user action is recorded via the API.




### API Key Security
```
Storage: AES-256 encrypted in D1 (`ai_providers.api_key_enc`, `mcp_servers.config_enc`)
Encryption key: Stored in Cloudflare secret (env.ENCRYPTION_KEY)
In transit: Secrets are decrypted only inside memory, never logged or sent to client
Displayed: Masked on client (e.g. "sk-...abc123", "Read-only token ••••abcd")
Deleted: Removed from D1 on user request — no recovery
```

### Security Headers
Every API response includes critical security headers via middleware in `[[path]].ts`:
- **Content-Security-Policy**: Restricts script/connect sources to authorized domains only.
- **Referrer-Policy**: `strict-origin-when-cross-origin`.
- **X-Content-Type-Options**: `nosniff`.
- **X-Frame-Options**: `DENY`.
- **X-XSS-Protection**: `1; mode=block`.

### AI Robustness & Proxying
The AI proxy includes built-in resilience:
- **Retry Logic**: 3 attempts max with exponential backoff (1s, 3s, 7s).
- **Error Mapping**:
  - `429` (Rate Limited) → Returns `{ error: 'rate_limited' }`
  - `401` (Invalid Key) → Returns `{ error: 'invalid_key' }`
  - Final failure → Returns `{ error: 'provider_unavailable' }`

---

## 14. AI Integration — BYOK & Agentic Workflows

### Bring Your Own Key (BYOK)

Users connect their own AI provider keys in Settings. Scrimble supports:

| Provider | Type | Base URL |
|---|---|---|
| OpenAI | Official | `https://api.openai.com/v1` |
| Anthropic | Official | `https://api.anthropic.com` |
| Google Gemini | Official | `https://generativelanguage.googleapis.com` |
| OpenRouter | Official | `https://openrouter.ai/api/v1` |
| Groq | Official | `https://api.groq.com/openai/v1` |
| Custom | OpenAI-compatible | User provides base URL |
| Local | Ollama / LM Studio | Standard OpenAI-compatible local endpoints |

### Model Roles: Fast & Deep

Scrimble uses a **two-model architecture** to optimize for both speed and reasoning quality. Users can configure specific providers and model names for two distinct roles in Settings:

| Role | Purpose | Recommended Models |
|---|---|---|
| **Fast model** | Quick tasks: structuring, routing, research summaries, tool scanning. | `gemini-2.0-flash`, `gpt-4o-mini`, `llama-3.1-70b` |
| **Deep model** | Complex tasks: system architecture, detailed plan generation, step enrichment, file generation. | `gemini-1.5-pro` (or `2.0-pro`), `claude-3-5-sonnet`, `gpt-4o` |

**Routing Logic:**
- **Fast is the default provider path** for generic AI operations, intake, and quick-turn tasks.
- If only one provider/model exists, it is used for both roles.
- If both roles are configured, Scrimble routes tasks by role.
- Research phases (Batch 1 & 2) and intake conversations always use the **Fast** role to keep interaction snappy.
- Architecture design, plan synthesis, and enrichment/file generation use the **Deep** role for higher-reasoning output.
- **Interactive Mid-Run Selection**: Builders can switch Fast and Deep role selections during generation; later batches pick up the updated role configuration.

**Provider Options:**
- **OpenRouter** provides access to 100+ models including Claude, GPT, Llama, and DeepSeek at competitive pricing. Fully integrated with automatic model selection defaults.
- **Groq** offers ultra-fast inference for quick iterations.
- **Custom providers** include: Ollama, LM Studio, Together AI, Azure OpenAI, and any other service that exposes an OpenAI-compatible `/chat/completions` endpoint.

**AI Provider abstraction:**
```typescript
interface AIProvider {
  generate(system: string, prompt: string, opts?: GenerateOptions): Promise<string>
  stream(system: string, prompt: string, opts?: GenerateOptions): AsyncIterable<string>
}
// Factory: getProvider(providerRecord) → OpenAIProvider | AnthropicProvider | GeminiProvider | CustomProvider
```

### Agentic Generation Pipeline

`GenerationWorkflow` executes the generation run as explicit, checkpointed steps. Each batch follows a strict execution contract:
1. **Context Loading**: Reads the state of the previous batch from D1/R2.
2. **AI Reasoning**: Dispatches a single BYOK AI call (routing to Fast/Deep role) with real-time `thinking` emission.
3. **Execution**: Performs the primary batch task (e.g., Doc fetch, Plan synthesis, File generation).
4. **Validation & Persistence**: Validates output with Zod, writes to `agent_runs`, and updates the project checkpoint.
5. **Event Signaling**: Emits a durable SSE event to update all connected clients.

**Phase-Specific Insights**:
- **Batch 2 (Research)**: Uses the `ResearchFacade` for multi-source acquisition (Context7, GitHub, Brave). Implements **In-Memory RAG** where fetched content is chunked and ranked by relevance; downstream prompts consume only the top-k relevant packs.
- **Batch 5 (Enrichment)**: Performs targeted deep-dives for each step in the plan, pulling live platform docs and security chatter to ensure actionable guidance.
- **Batch 6 (Generation)**: Produces the six canonical skill files (`.mdc`, `CLAUDE.md`, etc.) based on the approved architecture and enriched plan.
- **Batch 7 (Verification)**: Final consistency check across all generated artifacts before allowing project finalization.

**Resilience Features**:
- **Reasoning-Only Guard**: If a model provides reasoning but an empty JSON body (GLM-5/DeepSeek edge case), the system automatically triggers a "JSON-only" retry.
- **JSON Security**: The `extractJSON()` utility sanitizes AI output, removing markdown fences and handling malformed buffer tails.


### Observability & Streaming Architecture

### Durable Checkpoints & Dispatch Safety

Every generation run records a `run_id` on the project before work starts. Dispatch is workflow-only and uses compare-and-set updates with rollback on failure so no ghost `queued` state sticks around.

Workflow dispatch uses `run_id` as the workflow instance identity and keeps linkage in `generation_runs.workflow_instance_id` while `projects.current_generation_run_id` remains the only project-level runtime pointer. Pages Functions do not call the workflow binding directly; they call `env.WORKFLOW_SERVICE`. The consumer worker entrypoint then creates instances and sends approval events (`architecture-approved`), which immediately resume the paused `step.waitForEvent(...)` gate.

The worker loads the latest entry from `generation_checkpoints`, writes a new checkpoint after every batch, and stores metadata (batch name, provider, `degraded_tools`, `partial_failures`, etc.) in D1 while pushing large payloads—research summaries, chunk stores, partial responses—into the Cloudflare R2 bucket named `scrimble`. Workflow steps return R2 keys so each step payload stays comfortably under Cloudflare’s 1MB state cap.

Batch 1 now checkpoints deliberately before the runtime budget edge so Batch 2 can pick up the same state, and provider pinning enforces the original BYOK entry: if that provider disappears the worker fails fast with `provider_unavailable` instead of silently switching to a different key. Batch 2 now assembles prompts from retrieved chunk subsets instead of hard prompt-budget truncation, so provider calls stay focused and stable even as the fetched corpus grows.

Every research tool wrapper now raises `ToolExecutionError`, emits an `activity` SSE event, and saves structured `degraded_tools`/`partial_failures` metadata with the checkpoint. The architecture review UI surfaces those fields beside the research depth badges so builders instantly know if Brave Search, Context7, or GitHub tooling degraded during collection.

### Human-in-the-Loop Workflow

Certain steps are **gates** (`is_gate = 1`). At a gate:

1. Agent completes its work on the step
2. Step status → `needs_review`
3. Step card enters amber pulsing "waiting" state
4. "Your input needed" badge floats above the card
5. User opens the step panel — sees what the AI produced
6. A review prompt appears: *"Before I continue — does this look right to you?"*
7. User can: **Approve** (agent continues) / **Edit** (modify AI output, then approve) / **Reject** (agent retries with feedback)
8. On approval: step status → `complete`, downstream steps unlock, agent continues

After `batch_3_architect` and `batch_7_verify`, the pipeline halts automatically. The project’s canonical `generation_runs.lifecycle_status` becomes `awaiting_review` or `awaiting_verification_review`, and the generation screen switches into the respective review panel. 

The **Architecture Gate** (Batch 3) focuses on the recommended stack and data model, while the **Verification Gate** (Batch 7) focuses on final plan consistency, enrichment quality, and file alignment. Finalization is only possible after the user explicitely approves the verification report.

**Gate review API:**
```typescript
POST /api/steps/:id/review
Body: {
  decision: 'approve' | 'reject',
  feedback?: string,       // shown to AI on retry
  edited_output?: string   // if user edited the AI content
  approvalType?: 'architecture' | 'verification' // added to route to correct workflow event
}
```

**Always gates:**
- Security and authentication steps
- "Go live" / deployment steps
- Any step that makes external API calls or database changes
- Architecture decisions that affect all downstream work (Batch 3)
- Final verification report (Batch 7)
### Plan updates with live research
Natural-language plan updates now post to `/api/workflows/:id/update`, which streams a mini activity feed straight back into the update modal. The server analyzes what changed, performs MCP-powered mini research for any newly mentioned technologies (Context7 docs, GitHub analysis + releases/issues, Brave Search chatter when connected), generates the JSON diff, applies it, and immediately re-enriches every affected step before signaling completion. Every phase emits a chronological event (`🔍 Reading Railway documentation...`, `✅ Research complete`, `🔄 Updating your plan...`, `✅ 4 steps updated`) so the builder can follow the work, and the final bundle includes the refreshed research metadata and `research_sources` ledger that feeds the architecture review badges and step footers.

### Agent Prompts

#### Prompt 1 — Plan Generation
```
System:
You are Scrimble's plan generator. You create structured, opinionated
build plans for software projects. The plan must be written for a solo
builder who is not a professional software engineer.
Use plain language only — no jargon. Respond ONLY with valid JSON.

User:
The builder said: "{description}"

Infer from their description what they're building and generate a complete
plan. Choose only the stages that are relevant.

Return:
{
  "project_name": "Short, descriptive name",
  "project_type": "saas_mvp | client_site | internal_tool | other",
  "inferred_stack": { "frontend": "", "backend": "", "auth": "", "deploy": "" },
  "stages": [
    {
      "id": "stage_understand",
      "title": "Figure out what you're building",
      "type": "understand",
      "order": 0,
      "steps": [
        {
          "id": "step_xyz",
          "title": "Write down what success looks like",
          "type": "task",
          "risk_level": "medium",
          "is_gate": false,
          "objective": "...",
          "why_it_matters": "...",
          "suggested_tools": [{ "name": "", "url": "", "reason": "" }],
          "checklist": [{ "label": "", "is_required": true }],
          "done_when": "...",
          "depends_on": []
        }
      ]
    }
  ]
}

Rules:
- Write all labels, objectives, and why_it_matters in plain language
- No jargon. No technical acronyms without explanation.
- Solo builder: 4-6 steps per stage max — keep it focused
- Security and auth steps: always is_gate: true
- Use suggested tools specific to their described stack
- why_it_matters: explain in terms of "what goes wrong if you skip this"
```

#### Prompt 2 — Step Enrichment
```
System:
You are Scrimble's step enrichment agent. You produce specific, actionable
guidance for a single build step. Write for a solo builder — plain language,
no jargon. Respond ONLY with valid JSON.

User:
Step: "{step.title}"
Stage: "{stage.title}"
Project: "{project.description}"
Stack: {JSON.stringify(project.stack)}

Return:
{
  "ai_output": "A detailed, useful artifact for this specific step. Could be a draft brief, a data structure outline, a security checklist, a launch checklist — whatever is most useful HERE. Written in plain language. 2-4 paragraphs.",
  "prompts": [
    {
      "label": "What this prompt does, in plain language",
      "content": "The full prompt they can paste into Claude/Cursor/ChatGPT. Specific to their stack. 3-6 sentences."
    }
  ]
}

Rules:
- prompts: 2-3 items only
- Every prompt must reference their actual tools by name
- ai_output: a real, useful artifact — not generic advice
- Write as if explaining to a smart non-engineer
- Use the live research bundle for the step (Context7/docs, GitHub issues, search results) and obey any step-specific requirements such as security checklists, starter schemas, deployment checklists, or Stripe webhook guidance.
```

#### Prompt 3 — Plan Update
```
System:
You are Scrimble's plan update agent. Given an existing plan and a natural
language change from the builder, output a JSON diff of what should change.
Plain language throughout. Respond ONLY with valid JSON.

User:
Current plan summary:
{JSON.stringify(planSummary)}

Current stack: {JSON.stringify(project.stack)}

The builder said: "{message}"

Return:
{
  "summary": "Plain language description of what changed",
  "changes": [
    { "action": "update_step", "step_id": "...", "updates": { ... } },
    { "action": "add_step", "stage_id": "...", "step": { ... } },
    { "action": "remove_step", "step_id": "..." }
  ]
}

Rules:
- Only include steps that actually change
- Stack changes: update ALL affected steps downstream
- Never remove steps that are already done (status === 'complete')
- Updated steps: set is_ai_enriched = 0 to trigger re-enrichment
- summary: specific — "Updated 3 launch steps for Railway instead of Vercel"
- If the builder introduces a new technology, run a mini research pass first (docs + GitHub + web search) and use that research to make the diff specific instead of generic
```

---

## 15. Screen Specifications

### 15.1 Landing Page (`/`)

**Navbar:** 60px fixed top. `bg-base/80 backdrop-blur-lg border-b border-subtle`. Logo left, "Sign in" text + "Get started" paprika button right.

**Hero:** 52/48 asymmetric grid. Full viewport height.
- Left: "NOW IN BETA" badge (transparent bg, `border: 1px solid var(--border-strong)`, JetBrains Mono)
- H1: "Build it. Ship it." (Fraunces 800) + "Don't lose the thread." (Fraunces 300 italic, dust grey)
- Body: 15px DM Sans, text-secondary, max-width 360px
- CTAs: "Start building" (paprika filled, 8px radius) + "See how it works →" (plain text link, arrow slides on hover)
- Right: Tilted canvas mockup at -12°, 5-6 real steps with all status states, warm paprika glow beneath
- Background: Single radial bloom top-right `rgba(235,94,40,0.06)` — nothing else

**Feature Sections (3):** 100px padding, alternating layout, Framer scroll reveals
1. **YOUR PLAN** — "Your entire project, in one view"
2. **YOUR AI** — "Tell it what you're building. It handles the rest."
3. **EVERY MORNING** — "Open it every morning. Know exactly what's next."

All section labels use the paprika dash treatment.

---

### 15.2 New Project (`/new`)

**No forms. No dropdowns. Just a conversation.**

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   What do you want to build?                            │
│                                                          │
│   ┌──────────────────────────────────────────────────┐  │
│   │                                                  │  │
│   │  Describe it in your own words. The more        │  │
│   │  detail you give, the better your plan will be. │  │
│   │                                                  │  │
│   │  e.g. "I want to build a SaaS tool for          │  │
│   │  freelancers to track their invoices..."         │  │
│   │                                                  │  │
│   └──────────────────────────────────────────────────┘  │
│                                                          │
│   [Build my plan →]                                      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Single large textarea. No character limit. "Build my plan →" button starts the **Clarifying Questions Phase**.

**Clarifying Questions Phase:**
Before the main generation begins, Scrimble presents 2-4 targeted questions. The user must answer these to provide the necessary context for architectural decisions. Only after these are answered does the batch-based generation pipeline start.

If no AI provider is configured, `/new` blocks submission and shows a direct "You need to add an AI key first." call-to-action that links to Settings.

**On submit → Generating screen:**
- Before the activity feed begins, a short "Getting ready to research" transition screen appears when the user arrives from `/new`. It lists the active research depth for this run (`Web search`, `GitHub — authenticated/public only`, `Live docs via Context7`) using the same green/muted badge styling as the architecture review panel. If any optional tools are missing, the screen lingers for ~2.5s and links to `/settings#mcp-servers`; if everything is connected it crossfades out immediately.
- **Research Dashboard (Batch 2)**: During the research phase, the screen pivots to a dual-pane dashboard.
  - **Target Queue**: A live list of technologies and topics being researched, showing `pending`, `active`, `skipped`, or `completed` states.
  - **Real-time Metrics**: Live counters for data points found, including `Sources Found`, `Chunks Processed`, and `Evidence Packs Created`.
  - **Token Budget**: A visual progress bar tracking token consumption against the research budget (e.g., 0 / 8000 tokens).
  - **Interactive Controls**: A "Skip" button allows the builder to bypass a specific research target if they know it's irrelevant.
- Full-screen, vertically centered layout with the pulsing Scrimble mark (animated opacity pulse, 2s loop) and `bg-base` for other batches.
- The main heading swaps between the seven batch labels (`Identifying your stack`, `Reading the docs`, `Designing your architecture`, `Building your plan`, `Writing step details`, `Preparing your files`, `Verifying project consistency`) using AnimatePresence as each `batch_start` SSE event arrives.
- A single-line **Currently working** row sits above the historical log. It uses a 3px paprika pulse dot and slightly brighter type to show the latest live message in real time. Streaming `thinking` deltas land here first, and when the next activity arrives the previous live line animates up into the history below.
- A scrollable activity log (max-height 280px) streams persisted events (`activity`, `batch_complete`, `checkpoint`, `pipeline_failed`) with icons (🔍, 📦, ⚠️, 🏗️, ✅, 📝), timestamps (HH:MM:SS JetBrains Mono), and auto-scroll behavior. Each durable event carries an SSE `id:` from D1, the frontend tracks the latest seen event ID and a rendered-ID set, and reconnects after ~2 seconds with `Last-Event-ID` so replayed history never duplicates in the UI.
- A seven-dot progress indicator (connected line) mirrors the batch order. Completed dots glow emerald, the current batch glows paprika with a halo, and pending dots stay muted. Labels beneath each dot match the batch short names.
- **Persistent AI Model Selection**: Interactive buttons for both "Fast" and "Deep" models are pinned to the generation summary area. These buttons allow the builder to view the active model (formatted as "Provider — Model") and open a selection modal to swap providers or models mid-run.
- Estimated time remaining counts down from 15 minutes and recalculates dynamically as each `batch_complete` event reports `duration_ms`.
- A `Stop generation` control sits inside the connection bar (XCircle icon). It fires `POST /api/projects/:id/cancel`, cancels the run in D1, attempts to terminate the active workflow instance, and surfaces a cancelled banner with “Resume from checkpoint” and “Back to dashboard” actions so checkpoints are preserved after a manual halt.

When a run is cancelled via the stop control the generation screen switches into the “Generation stopped” banner state: a muted XCircle explains that checkpoints remain intact, offers to resume or exit to the dashboard, and quietly marks the run `cancelled` so the backend can reject duplicate runners while the frontend keeps the builder in control.
- If a builder returns to `/project/:id` while generation is still running (or while the architecture checkpoint is waiting), the canvas route redirects them back to `/project/:id/generating`, the screen reloads the status from `generation_runs`, reconnects to the SSE stream, and reconstructs the full generation state from replayed events before resuming live updates.

**Review checkpoints**
- **Architecture Gate (Batch 3)**: When `batch_3_architect` emits a `checkpoint` SSE event, AnimatePresence crossfades the activity feed into the review panel (y: 24 → 0, opacity: 0 → 1).
- **Verification Gate (Batch 7)**: When `batch_7_verify` finishes, the pipeline enters its second mandatory human gate. This panel displays a detailed quality report covering stack drift, feature coverage, and link audits. Finalization is only enabled once the user acknowledges the report.
- The panels show:
  - "Your stack" grid of stack cards (name + package@version + reason + optional gotcha tooltip).
  - "How it's structured" data-model summary (table name + column list).
  - Feedback textarea (DM Sans 14px) for adjustments and preference buttons for `cursor`, `windsurf`, `vscode`, `claude_desktop`.
  - "Let me adjust" (ghost) and "Looks right, build my plan →" (paprika) buttons (for Architecture) or "Finalize project" (for Verification). Approval sends the workflow event with feedback.
  - A Research depth row lives above the stack grid, displaying badges such as `[✓ Web search]`, `[✓ GitHub — authenticated]`, or `[✗ Brave Search — not connected]`. Connected badges follow the mint style (`bg-[rgba(52,211,153,0.1)]`, `border-[rgba(52,211,153,0.2)]`, `text-[#34d399]`, checkmark icon), while offline tools use a muted grey treatment (`bg-[rgba(204,197,185,0.05)]`, `border-[rgba(204,197,185,0.1)]`, `text-[var(--text-muted)]`, X icon, "not connected" suffix). Below the badges, a JetBrains Mono 11px line reads "Researched {n} technologies across {m} sources." If fewer than two tools were connected, a quiet amber nudge appears beneath: "Connect more research tools in Settings for deeper analysis next time." (Links to `/settings#mcp-servers`.)
- A collapsible "What I read" disclosure expands to show every source the agent consulted: each entry now includes tool icon/label, truncated URL, `chars_read`, relevance tier (`high|medium|low`), and a one-line insight summary from the research ledger.
- If the SSE stream reports `pipeline_failed`, the review screen surfaces the error message and a "Try again" button that reconnects the stream.
- On success (terminal `pipeline_complete`), a Sonner toast appears ("Your project plan is ready."), waits 1.5s, then navigates to `/project/:id`.

**Background notes**
- The SSE connection attaches the Firebase auth token via `fetch` headers, reconnects automatically after disconnects, and pings the server every 20s (`: ping`) to keep proxies alive.
- Natural-language plan updates now stream their own mini activity feed inside the update modal. The server performs change analysis, mini MCP research for newly introduced technologies, diff generation, diff application, and automatic re-enrichment of affected steps before returning the final success event.
- Activity icons match the pipeline semantics: 🔍 fetching docs, 📦 hitting GitHub, ⚠️ gotcha/warning, 🏗️ architecture, ✅ completed batch, 📝 writing steps.

### 15.2.1 Auth (`/login` & `/signup`)

- Auth lives on a single, centered card inside the warm radial gradients of the entry page. The hero area stacks the hexagon badge, the mono “Getting started” label, and a heading that switches between “Pick up where you left off.” (login) and “Start your first plan.” (signup) so the surface feels more confident than a generic login form.
- The card focuses on one real auth path: Google sign-in. It includes a supporting sentence about tying your plan to one account, a soft warning banner for errors (`bg-status-skipped` + `text-status-error`), and the primary button with Google’s colored icon and the label “Continue with Google.”
- Email/password placeholder controls were removed from shipped UI to avoid “coming soon” affordances in the core sign-in flow.
- Beneath the card, micro-copy toggles between “Don’t have an account yet?” and “Already have an account?” depending on the route, linking to the respective signup or login page with the same accent color used in the rest of the UI.

---

### 15.3 Dashboard (`/dashboard`)

**The single most important screen — the daily re-entry.**

```
Good morning.                                    [+ New project]

┌──────────────────────────────────────────────────────────┐
│                                                          │
│  My Invoice Tracker SaaS             ●●●○○  3 of 9      │
│                                                          │
│  ▬▬▬▬▬▬▬▬▬▬▬░░░░░░░  42%  ●                            │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  → Next up    Set up your database               │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  Vite + React · Supabase · Stripe        2 hours ago    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- "Next up" row: paprika-tinted background, most prominent element in card
- Progress dots represent stages (not percentage)
- Stack tags: JetBrains Mono uppercase, text-muted
- "Good morning/afternoon/evening" greeting based on time of day
- Dashboard now prioritizes one **active project** block with one primary next action (resume intake, review build, resume build, watch progress, or open plan), derived from canonical runtime semantics through a shared generation-session adapter.
- Remaining projects are shown as lighter secondary cards so re-entry focus stays on the immediate next action.

---

### 15.4 Project View (`/project/[id]`)

Project view is now a **guided map canvas** built around progress/navigation first.

**Current Canvas Experience:**
- **Guided mode by default**: Read-only posture with current stage, current step, path-ahead summary, and blocked-state messaging.
- **Executable navigation**: Stage rows are real buttons that open the stage’s first step.
- **Advanced mode is explicit**: Graph mutation controls (quick edit, add stage/step/edge, export, drag/connect) stay hidden until the user enables **Advanced mode**.
- **Detail-first workflow**: Step detail panel remains the execution companion, while the map keeps orientation and progress visible.
- **Status-aware nodes**: Completed, active/working, review, and locked states remain visually distinct.

**App Bottom Pill Nav** (timeline, dashboard, settings only):
position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
background: rgba(36,33,30,0.92); backdrop-filter: blur(20px);
border: 1px solid var(--border-default); border-radius: 16px;
box-shadow: 0 8px 32px rgba(0,0,0,0.5);
/* Active item: bg-accent-muted text-primary, paprika icon */
/* layoutId="active-pill" for Framer layout animation */
```

---

### 15.5 Step Cards (on Canvas)

Width 176px. Status-driven appearance:

| Status | Visual |
|---|---|
| locked | opacity 0.35, pointer-events none |
| active | paprika border + slow breathing glow animation |
| agent_working | animated paprika sweep on top stripe, indeterminate progress bar |
| needs_review | amber pulsing border + floating "Your input needed" badge |
| complete | emerald border tint |
| skipped | red border tint, opacity 0.6 |

2px category color top stripe. DM Sans 12px 500 title. 2px paprika progress bar.

---

### 15.6 Step Detail Panel (Right Drawer)

420px, slides in from right. Canvas shrinks — does not overlay.

**Header:** Category top strip (4px) + step title (Fraunces 20px) + stage breadcrumb + status badge + close button

**Body sections:**
1. **Goal** — what this step achieves
2. **Why this matters** — what goes wrong if skipped
3. **What the AI prepared** — individual shimmer skeletons for each section while loading
4. **Prompts to use** — copy-pasteable prompt cards with optimistic copy state
5. **Suggested tools** — horizontal chip scroll
6. **Things to check** — interactive checklist with optimistic local toggle
7. **Done when...** — exit criteria in emerald border container

 Every enriched step now ends with a JetBrains Mono 11px footer that reads `Researched {date} using {tools used}`. The footer is rendered from persisted step metadata (`steps.research_footer_meta`) so it remains stable across refreshes and re-enrichments while keeping the AI narrative body clean.

 The panel now leads with an **Execution guide** section that explicitly answers: tool, destination, exact action, optional value/snippet, and done condition. AI chat remains available but is secondary in the default flow.

Behind the scenes the panel now routes every enrichment request through `dbService.streamStepEnrichment` and the shared `useStepExecution` hook so AI output arrives as an SSE stream and the toaster-enabled UX stays responsive. While the agent is working the drawer keeps the skeletons active, disables Skip/Mark as done until the network call completes, and instantly surfaces any fetch or enrichment errors with a subtle banner plus a “Try again” button that refreshes that step without closing the drawer. Toast guidance confirms both successes and failures, which keeps the flow feeling steady even when external services pause or hiccup.

**Human-in-the-loop review panel** (when `is_gate = 1` and `status = needs_review`):
```
┌──────────────────────────────────────────────────────────┐
│  ⚡ Before I continue — does this look right?            │
│                                                          │
│  [What the AI produced — editable text area]            │
│                                                          │
│  [Edit]      [Reject, try again]      [Looks good →]    │
└──────────────────────────────────────────────────────────┘
```
Amber border. Fraunces heading. Warm, conversational tone.

**Footer (sticky):**
- "Skip this" ghost button left (opens shadcn Dialog with risk explanation)
- "Mark as done" paprika button right (disabled until required checklist items checked)

---

### 15.7 Workspace Profile & AI Settings (`/settings`)

The **Workspace Profile** is the personalization engine that makes Scrimble's research-first plans accurate. The more a user fills this in, the more specific every generated plan becomes.

**Profile Categories:**
- **IDEs**: Cursor, Windsurf, VS Code, Claude Code, Zed, etc.
- **Frameworks**: Next.js, React, Vue, Svelte, etc.
- **Databases**: Supabase, PlanetScale, Cloudflare D1, Neon, etc.
- **Hosting / Deployment**: Vercel, Railway, Cloudflare, AWS, etc.
- **Auth Providers**: Clerk, Kinde, Firebase, Supabase Auth.
- **Payments**: Stripe, Lemon Squeezy, Paddle.
- **Subscriptions**: Other tools and services the user pays for.
- **AI Models**: Preferred models for planning and coding.

---

### 15.8 AI Keys & Research Tools (`/settings`)

Users connect their AI provider keys and research tools to power the engine.

**AI Provider List:**
- OpenAI, Anthropic, Gemini, OpenRouter, Groq, or Custom OpenAI-compatible endpoints.

**Research Tool List (The MCP Layer):**
- **Brave Search**: Powers general web research and community chatter.
- **GitHub**: Analyzes specific repos, issues, and releases.
- **Context7**: Injects live documentation into the research phase.
- **Custom MCP**: User-provided research servers.

The Research Agent uses these tools to ensure plans are evidence-based and up-to-date.

### AI Schema Resilience
When building Zod schemas for AI outputs (especially for researchers), always prioritize resilience over strictness for non-critical fields.
- **Problem**: AI models sometimes return `null` for fields like `github_url` or `changelog_url` if they cannot find one.
- **Solution**: Use `.nullable().transform(val => val ?? "")` or `.optional().transform(val => val ?? "")`.
- **Reason**: A strict `.url()` or `.string()` check will cause a Zod validation error, which in turn throws a `GenerationPipelineError`, halting the entire pipeline.
- **Golden Rule**: If a piece of metadata is nice-to-have but not critical for the next batch, make it resilient to `null` or missing data.

### AI Proxy Connection Hanging (Stream Traps)
When consuming SSE (Server-Sent Events) from a 3rd party AI proxy or a self-hosted model (like serving GLM-5 or DeepSeek-R1 via Modal), **the connection might not close cleanly**. Some proxies send the `data: [DONE]` payload but keep the underlying HTTP TCP connection open for keep-alive or connection pooling.

If your stream reader loop uses `while (true)` and relies solely on `!done` from the `ReadableStream` to break, it will **hang indefinitely** on these proxies, killing the pipeline.

**Always defensively break on the `[DONE]` marker**, not just the HTTP chunk signal:

```typescript
  let isDone = false;
  while (!isDone) {
    const { done, value } = await reader.read();
    if (done) break;

    // ... chunking logic ...

    for (const line of lines) {
      const data = line.slice(5).trim();
      if (!data) continue;
      
      // CRITICAL: Explicitly break the stream loop, do not just continue it.
      if (data === '[DONE]') {
        isDone = true;
        break;
      }
      // ... parse JSON ...
    }
  }
```

---

## 16. Component Library

### Custom Components (visual identity — not shadcn)
| Component | Description |
|---|---|
| `TimelineCard` | Vertical timeline step node — all status states |
| `InfiniteSpine` | Vertical spine component connecting timeline steps |
| `WelcomeModal` | Staggered onboarding flow for keys and profile |
| `OnboardingChecklist` | Persistent dash checklist for missing setup steps |
| `StepPanel` | Right drawer — full step detail view |
| `ChecklistItem` | Interactive row with draw-on checkmark |
| `ProgressRing` | SVG circular progress (sidebar) |
| `ProgressBar` | Linear with glowing dot tip |
| `RiskBadge` | Color-coded importance level |
| `BottomPillNav` | App page bottom navigation with layout animation |
| `UnlockToast` | Step completion notification |
| `AgentWorkingIndicator` | Animated sweep on step card during agent run |
| `HumanReviewPanel` | Gate review UI inside StepPanel |
| `SectionLabel` | Mono uppercase + paprika dash |
| `StackChip` | Technology tag |
| `Skeleton` | Modular shimmer loading state (body, heading, circle, badge) |
| `ThinkingBubble` | Animated agent status and reasoning content display |
| `ProjectCard` | Dashboard project card |
| `AIProviderCard` | Settings — connected provider display |

### shadcn Components Used
| Component | Where |
|---|---|
| `Dialog` | Skip warning, human review confirmation |
| `Tooltip` | Step hover info, locked explanations |
| `DropdownMenu` | Export options, avatar menu |
| `Sonner` | Unlock toast, agent completion notification |

---

## 17. Build Status

### ✅ Core Features (Completed)

**Auth & Infrastructure**
- **Unified Identity**: Firebase Auth (Google OAuth) + JWT verification in Cloudflare Pages.
- **D1 Canonical Schema**: High-integrity relational storage with automated migration path.
- **R2 Checkpoints**: Large-state indirection (research, plans, artifacts) to Cloudflare R2 bucket.
- **Workflow Middleware**: Service-bound dispatch to the `scrimble-consumer` worker runtime.
- **Security Guardrails**: Content-Security-Policy (CSP), SRI, and masked key storage (AES-256).

**AI & Research (The Scrimble Engine)**
- **Research Facade**: Centralized tool orchestration for Context7 docs, GitHub analysis, and Brave Search.
- **Lightweight RAG**: In-memory chunking and TF-IDF-style retrieval for targeted context window usage.
- **Recursive Generation**: Sequential 7-batch pipeline (Research → Architect → Plan → Enrich → File Gen → Verify).
- **Dual-Model Routing**: Configurable "Fast" vs "Deep" model roles for performance optimization.
- **Research Telemetry**: Live dashboard during research phase showing sources, chunks, and token budget.
- **Target Skipping**: Builders can explicitly bypass specific documentation fetches via the UI.
- **Reasoning Persistence**: `thinking` events are replayed with a rolling window for active runs.

**Workflow & Execution**
- **Human-in-the-Loop Gates**: Mandatory human checkpoints for Architecture (Batch 3) and Verification (Batch 7).
- **Durable Progress**: State-aware résumé and retry system with per-step timeouts/budgets.
- **Plan Updates**: Natural-language diffing with automated research/re-enrichment for existing plans.
- **Skill File Generation**: Automated production of `.mdc`, `.windsurfrules`, and context files for IDEs.
- **SSE Stream Adapter**: Resilient backend event stream with replay, heartbeats, and terminal server-side severing.

**UI & Product Experience**
- **Infinite Spine Timeline**: High-focus vertical orientation for project execution.
- **Dashboard Hub**: Daily re-entry greeting with actionable "Next Up" primary prompts.
- **Guided Canvas**: Progress-first map view with secondary "Advanced mode" for mutation.
- **Step Detail Drawer**: Enriched execution guidance (Tool, Destination, Action) with live streaming.
- **Onboarding Pathway**: Guided `WelcomeModal` and `OnboardingChecklist` for first-run friction reduction.
- **Visual Design System**: Warm-editorial dark mode with Framer Motion staggers and paprika accents.

---

### Pipeline Maturity (Incremental Snapshots)
*The system has evolved through several reliability and vision-alignment phases:*
- **V1-V3 (Stabilization)**: Decoupled projects from runs; established the Canonical Write Boundary; unified the retry layer.
- **V4-V5 (Research Scale)**: Implemented `ResearchFacade`; added lightweight RAG; introduced subrequest guardrails.
- **V6 (Observability & QA)**: Added transient reasoning streams; implemented Batch 7 Verification; finalized the dual-gate human-in-the-loop architecture.

---

### 18. Remaining Work

**Release closeout blockers (Phase 14F - COMPLETE):**
- [x] Batch 7 Consistency Verification gate implemented end-to-end.
- [x] Research Telemetry (chunks/tokens/budget) dashboard live.
- [x] Target Skipping functionality operational.
- [ ] Paired runtime deploy validation (Pages + `worker-consumer`) with first event + first heartbeat confirmation.
- [ ] Mobile/narrow viewport verification for Dashboard, Generation, Canvas, Detail Panel, and Settings.
- [ ] Large-project performance benchmark (`100+` steps).
- [ ] Monitoring window checks for `pipeline_failed` and D1 contract regressions.

---

### Known Issue: High Reasoning Model Timeouts (March 2026)

When using high reasoning/depth models (e.g., DeepSeek R1, OpenAI o1, Claude Opus), the AI can take 100+ seconds to generate responses due to extended thinking. Cloudflare Workers enforces a ~100-second timeout on subrequests. If the AI doesn't send chunks for >100 seconds, the fetch fails with:

```
Error: Network connection lost. Retrying automatically in 45 seconds (1/3).
```

**Current behavior:**
- Thinking events now use the same canonical envelope as all other generation events.
- Active runs retain a bounded rolling thinking window for reconnect/replay.
- Terminal completion/failure/cancel clears thinking replay state.
- UI only shows live model reasoning when real `thinking` events exist (no fake placeholder reasoning state).

---

**Pending:**
- Team collaboration + multi-user editing
- GitHub Issues sync — generate tickets from steps automatically
- Notion export
- Project analytics — time per step, skip rates, risk trends
- Template library — community-built plan templates for common project types

**Documentation & Handoff Checklist:**
- [x] All environment variables documented in `ENV_MANIFEST.md`
- [x] Database schema source of truth established in `migrations/001_initial_schema.sql`
- [x] Security audit complete — no sensitive logging, CSP active
- [x] AI proxy robustness verified (Retries + Rate Limit handling)
- [x] UI/UX audit complete across all major pages

---

## 19. Future Roadmap

### V2 Features (In Development)
- Mobile companion app — morning re-entry on your phone
- IDE extension — Scrimble context injected directly into Cursor/VS Code

### V3+
- **CLI companion** — stay on track natively in your terminal
  ```bash
  scrimble status    # what's my current step?
  scrimble done      # mark it complete
  scrimble next      # what unlocks?
  scrimble update "switching to Railway" # update the plan
  ```
- Multi-agent orchestration — parallel agent workers for independent stages

---

*Scrimble Documentation v6.1 — April 2026*
*This document supersedes all previous versions.*
