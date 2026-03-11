# Scrimble — Complete Project Documentation
### The Focus & Build Engine for Vibe Coders
*Version 4.0 — March 2026 — Single source of truth*

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
19. [Future Roadmap](#19-future-roadmap)

---

## 1. Product Vision

**One line:** Scrimble keeps builders on track — one step at a time, powered by AI that does the work for you.

**The emotional promise:** Scrimble is the tool that turns idea-havers into builders who actually finish things. Not by slowing them down. Not by making them learn engineering theory. By giving them a system that matches their energy, handles the cognitive overhead, and keeps them locked in on what matters right now.

You describe what you want to build in plain language. Scrimble figures out the path, does the research, writes the docs, and walks you through it — one step at a time. Every morning you open Scrimble and you know exactly what to do next.

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

Scrimble is a **living, AI-powered project guide** that:

1. Takes your project idea in plain language and builds a personalised step-by-step path
2. Has AI agents do the heavy work at each step — research, writing, planning
3. Pauses for your input at key moments before moving forward (human-in-the-loop)
4. Updates and evolves the entire plan whenever your project changes — just describe the change
5. Becomes the single place you return to every day: *"what's my next step?"*

**What Scrimble is NOT:**

| It's not... | Because... |
|---|---|
| A place to read documentation | AI agents do the reading, you get the results |
| A project manager | It doesn't track teams, sprints, or deadlines |
| A code generator | Your coding tool does that — Scrimble guides the process |
| A static checklist | The plan is alive and changes with your project |
| Another chatbot | It has memory, structure, and a visual workflow — not just conversation |

---

## 4. Core Philosophy

### One Step at a Time
The entire experience is built around a single principle: **finish this before you touch that.** Each step is a focused unit of work. You can't move to the next step until the current one is done — or you explicitly decide to skip it (with full awareness of what that means).

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

Note: the project is deployed to Cloudflare Pages for the frontend + Pages Functions API; background jobs run in a separate Cloudflare Worker (see `wrangler.consumer.toml`).

### Backend
| Concern | Choice | Notes |
|---|---|---|
| Runtime | Cloudflare Pages Functions | Edge serverless — Produces queue messages |
| Background Jobs | Cloudflare Workers (Standalone) | Consumes "scrimble" queue — Handles AI pipeline |
| Database | Cloudflare D1 (SQLite) | Relational, edge-native, shared between environments |
| Auth | Firebase Auth (auth only) | Google OAuth + email/password — JWT verification in Functions |
| AI Routing | Function-side proxy | All AI calls proxied through Functions or Background Worker |
| Hosting | Cloudflare Pages | Unified frontend and API deployment |

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

Note: the repository includes `next-themes` in package.json. This project is a Vite-built SPA; audit `next-themes` usage and remove or replace it if it's a leftover from earlier Next.js plans.

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
1. User signs in via Firebase Auth (Google OAuth or email/password)
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
- **Agent Thinking**: The `ThinkingBubble` component renders a dedicated, persistent but transient "Agent Thoughts" card. It uses a spinning `Sparkles` icon and a breathing `Brain` pulse to signal active reasoning. Content is streamed via the `thinking` SSE event.
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
/project/[id]         → Main plan canvas
/project/[id]/step/[stepId] → Step detail (URL state)
/settings             → User preferences, AI key management
```

### Navigation Patterns

- Landing, authentication, `/new`, and the live generation journeys intentionally render without the pill nav so those entry points stay focused. Only the dashboard, the canvas (`/project/:id`), and the settings shell inherit the nav chrome from `AppLayout`.
- The bottom Pill Nav labels its tabs **Plan / Projects / Settings**. “Plan” links to the current project (and is disabled until a plan is open), “Projects” always returns to `/dashboard`, and “Settings” anchors to `/settings`. The active pill uses the layoutId “pill-nav-active” so the paprika indicator animates smoothly between tabs, and the layout also adds 104px of bottom padding whenever the nav is present so content never collides with it.
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

| Field | Plain Name | Description |
|---|---|---|
| title | Step name | What this step is |
| objective | Goal | What gets done here |
| why_it_matters | Why this matters | What goes wrong if skipped |
| suggested_tools | Suggested tools | Stack-specific, no generic advice |
| ai_output | What the AI prepared | Generated artifact — brief, plan, checklist |
| prompts | Prompts to use | Copy-pasteable prompts for your coding tool |
| checklist | Things to check | Concrete items, some required before moving on |
| exit_criteria | Done when... | Exact definition of done |
| status | State | waiting / working / needs your input / done / skipped |
| risk_level | Importance | low / medium / high / critical |
| is_gate | Requires your review | Must be reviewed before AI continues |
| is_ai_enriched | AI prepared | Whether AI has generated deep content |

---

## 12. Database Schema — Cloudflare D1

Cloudflare D1 uses SQLite syntax. All IDs are `TEXT` generated with `nanoid`. JSON fields are stored as `TEXT` and parsed in the application layer. Booleans are `INTEGER` (0/1).

```sql
-- ────────────────────────────────────────────
-- USER PROFILES
-- Firebase UID is the primary key
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id              TEXT PRIMARY KEY,     -- Firebase UID
  name            TEXT,
  email           TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
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
  model           TEXT,                 -- preferred model for this provider
  is_default      INTEGER DEFAULT 0,    -- one default per user
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
  exit_criteria       TEXT,
  -- AI enrichment content (generated when step is first opened)
  is_ai_enriched      INTEGER DEFAULT 0,
  ai_output           TEXT,             -- generated artifact
  prompts             TEXT,             -- JSON: [{ label, content }]
  -- Agent state
  agent_job_id        TEXT,             -- Cloudflare Queue message ID if running
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
-- AGENT RUNS (audit log of AI agent activity)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_runs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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
-- INDEXES
-- ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projects_user      ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_project  ON workflows(project_id);
CREATE INDEX IF NOT EXISTS idx_stages_workflow    ON stages(workflow_id);
CREATE INDEX IF NOT EXISTS idx_steps_workflow     ON steps(workflow_id);
CREATE INDEX IF NOT EXISTS idx_steps_stage        ON steps(stage_id);
CREATE INDEX IF NOT EXISTS idx_checklist_step     ON checklist_items(step_id);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_user   ON mcp_servers(user_id);

-- ────────────────────────────────────────────
-- TRANSIENT STATE (Thinking / Reasoning Relay)
-- Rows are physically DELETED on batch/pipeline completion
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_generation_live_state (
  project_id      TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  reasoning       TEXT,                 -- the current accumulated thinking block
  updated_at      TEXT DEFAULT (datetime('now'))
);
```


---

## 13. Backend Architecture

### Cloudflare Pages Functions — API Routes

All routes run on Cloudflare Pages Functions. Firebase JWT verified on every authenticated request via `Authorization: Bearer <token>`.

```
POST   /api/auth/sync              → Create/update profile in D1 from Firebase JWT

GET    /api/projects               → List user's projects
POST    /api/projects               → Create project, queue plan generation
GET    /api/projects/:id           → Get full project + workflow + steps + edges
PATCH  /api/projects/:id           → Update project metadata

GET    /api/workflows/:id          → Get workflow with stages and steps
PATCH  /api/workflows/:id          → Update canvas viewport state
POST   /api/workflows/:id/update   → Natural language plan update → live MCP research → AI diff → D1 + re-enrichment

GET    /api/steps/:id              → Get full step content
PATCH  /api/steps/:id              → Update step status or content
POST   /api/steps/:id/complete     → Mark complete, unlock downstream steps
POST   /api/steps/:id/skip         → Skip step, note risk, unlock downstream
POST   /api/steps/:id/enrich       → Queue AI enrichment job
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
POST   /api/projects/:id/resume    → Re-enqueue a failed or interrupted project

> [!IMPORTANT]
> **Routing Gotcha**: Hono is configured with `.basePath('/api')`. When defining new routes, **do not** start the route string with `/api/`. 
> - Correct: `app.get('/steps', ...)` (mounts at `/api/steps`)
> - Incorrect: `app.get('/api/steps', ...)` (mounts at `/api/api/steps`, causing 404s)

```


### Cloudflare Queue — Async Agent Jobs

```
Queue name: scrimble-agent-jobs

Message types:
  { type: 'generate_plan',  projectId, userId, description, providerKeyId }
  { type: 'enrich_step',    stepId, projectId, userId, providerKeyId }
  { type: 'update_plan',    workflowId, userId, message, providerKeyId }
  { type: 'gate_review',    stepId, projectId, userId }

Consumer Worker:
  1. Pull message from queue
  2. Fetch user's encrypted API key from D1
  3. Decrypt key in Worker memory
  4. Call AI provider API
  5. Write results to D1
  6. Update step status (agent_working → needs_review | complete)
  7. Mark message consumed

Retry: 3 attempts, exponential backoff
```

### Sequential Generation Pipeline

Project creation enqueues a dedicated 6-batch agent job. Scrimble uses a professional hybrid architecture to handle these long-running tasks:
1. **Pages (The Boss)**: Handles the UI and enqueues tasks via `AGENT_QUEUE.send()`.
2. **Cloudflare Queue (Magic Mailbox)**: A queue named `scrimble` that ensures task reliability.
3. **Worker (The Helper)**: A standalone Cloudflare Worker (`worker-consumer.ts`) dedicated to consuming messages and running the AI pipeline.

Each batch executes in order with **Smart Caps** to ensure extreme thoroughness without reckless resource usage:
- **Infrastructure Safety**: 1-hour (3600s) maximum execution window for background tasks.
- **AI Patience**: 10-minute timeout per AI provider call (managed via AbortController).
- **Research Liberty**: 2-minute timeout for documentation fetches; up to 100,000 tokens processed per document.
- **Token Guardrails**: Aggressive truncation on all research fields (Docs: 15k chars, Readme: 10k chars, Issues: 8k chars) ensures prompts stay within model sweet spots and avoids execution timeouts.
- **Output Freedom**: Up to 16,384 tokens per AI response to provide headroom for models with extensive reasoning/thinking blocks (e.g., GLM-5, DeepSeek-R1).
- **Thought-Only Guard**: If a model exhausts its output window with reasoning but provides no JSON content, the system automatically triggers a single "JSON-only" retry.

Batch 3 pauses before continuing—Scrimble saves the architecture decision record and waits for the human review gate to be approved. The review payload (including feedback and preferred IDE) is stored and forwarded to batches 4‑6 so every subsequent step honors the builder’s choices.

### Resume & Retry Flow
The pipeline is designed for resilience. If a project hits a "snag" (timeout, provider error, or budget limit), it enters a `failed` state.
1. **Backend Support**: The `/api/projects/:id/resume` endpoint allows re-enqueuing even `failed` projects, picking up from the last incomplete batch.
2. **Frontend Recovery**: The "Try again" button in the generation error state triggers a real backend re-enqueue, reconnecting the SSE stream only after the task is back in the queue.


### Professional Icon System
Scrimble strictly uses technical, engineering-focused icons (Lucide React) to maintain a professional aesthetic:
- **AI/Compute**: `Cpu`
- **Process/Structure**: `Workflow`
- **Execution/Monitoring**: `Activity`
- **Action/Trigger**: `Zap`
- *Prohibited: Any whimsical, magic, sparkle, or glitter-themed icons.*

The Cosmos of SSE events lives in `/api/projects/:id/generation-stream`. 
That route creates a `TransformStream` that replays `project_generation_events` since the last seen ID, keeps the connection alive with a `: ping` every 20 seconds, and polls D1 on a short interval so the Pages request can see fresh events written by the separate queue consumer worker. 

To handle the high-frequency nature of AI reasoning deltas from distributed global isolates, Scrimble uses a **Throttled Emitter** (`createThrottledThinkingEmitter`). This utility buffers incoming reasoning tokens in memory and performs a single `ON CONFLICT DO UPDATE` write to the `project_generation_live_state` table every 1000ms. This prevents D1 row-locking congestion while maintaining a fluid user experience.

On terminal events (`pipeline_complete`, `pipeline_failed`), the system explicitly calls `writer.close()` after the final flush to ensure the browser strictly severs the connection and doesn't leave "ghost" streams polling the edge.



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
| Custom | OpenAI-compatible | User provides base URL |

**Custom providers** include: Ollama, LM Studio, Together AI, Groq, Azure OpenAI, OpenRouter, and any other service that exposes an OpenAI-compatible `/chat/completions` endpoint.

**AI Provider abstraction:**
```typescript
interface AIProvider {
  generate(system: string, prompt: string, opts?: GenerateOptions): Promise<string>
  stream(system: string, prompt: string, opts?: GenerateOptions): AsyncIterable<string>
}
// Factory: getProvider(providerRecord) → OpenAIProvider | AnthropicProvider | GeminiProvider | CustomProvider
```

### Agentic Generation Pipeline

Scrimble’s “start a project” flow now enqueues a Cloudflare Queue job that runs six sequential batches inside the queue consumer worker. Each batch:

1. Reads input from the previous batch’s `agent_runs` output (stored as JSON).
2. Makes exactly one AI call through the BYOK proxy.
3. Validates the JSON response with Zod and, on failure, retries once with the invalid output appended to the prompt.
4. Persists the output to `agent_runs` with `run_type` set to the batch name.
5. Updates `projects.generation_status` to the batch currently running.
6. Writes a structured SSE event into `project_generation_events` so the frontend can replay and stream it immediately.

The queue consumer owns this pipeline completely. It does not hold a browser `WritableStream`, depend on an open tab, or await any frontend connection before continuing its work. If the user refreshes, disconnects, or closes the tab, the worker keeps running, persists each durable milestone to D1, and the generation screen rebuilds itself later from replay plus fresh polling.

Batch 2 (`fetch_and_read`) now goes through a Worker-side tools layer: direct URL fetches remain available through `fetchUrl`, GitHub analysis/issues use the GitHub research connection when present (or fall back to the public API), Context7 can inject live docs, and Brave Search can surface current migration chatter or community gotchas. **Token Guardrails** (aggressive truncation of raw research data) prevent prompt-size failures. Every tool call emits an `activity` SSE event, and every AI call now parses streamed chunks in real time: `reasoning_content` forwards to transient `thinking` SSE events immediately, while only `content` is appended to the local buffer. 

**Resilience Features**:
- **Reasoning-Only Guard**: Models with high-effort reasoning (GLM-5, DeepSeek-R1) can sometimes exhaust their output limit with thought alone. If the stream closes with reasoning but an empty JSON body, the system triggers a single retry with a "JSON-only, no reasoning" system prompt override.
- **Privacy Purge**: To protect intellectual property and user privacy, all transient reasoning/thinking data is physically DELETED from D1 as soon as a batch or the entire pipeline completes.
- **JSON Security**: The `extractJSON()` utility strips markdown fences and handles malformed-buffer edge cases where transport metadata might leak into the response.

Step enrichment is now deeper too: auth steps fetch security/session docs plus recent vulnerability chatter, database steps pull schema+migration references, deployment steps read platform docs/issues/checklists, and payment steps pull live Stripe checkout + webhook guidance before the AI writes the final step artifact. Batch 6 (`generate_files`) receives the approved architecture record, the full enriched plan, and any review feedback to produce the six required skill files (`.cursor/rules/scrimble-project.mdc`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.windsurfrules`, `scrimble-context.md`, `scrimble-mcp.json`). These artifacts are stored in D1 and served via `/api/projects/:id/skill-files` as a JSZip download when the plan is ready.

Batch 2 also records a `research_sources` ledger (tool, source URL, one-line summary) and a `data_quality` object (`has_brave_search`, `has_github_token`, `has_context7`, `technologies_researched`, `urls_fetched`, `issues_found`) so the architecture checkpoint can explain which tools were consulted, how deep the research went, and which sources the agent actually read.

The backend emits durable `batch_start`, `activity`, `batch_complete`, `checkpoint`, `pipeline_complete`, and `pipeline_failed` SSE events that the frontend uses to animate the generation heading, the historical activity log, progress dots, ETA counter, and review gate. The `/api/projects/:id/generation-stream` route always replays missed durable events first using `Last-Event-ID`, then polls D1 for new rows every ~1 second so queue-written updates still flow even though the browser and queue worker live in separate runtimes. Provider reasoning chunks are streamed separately as transient `thinking` events: the queue consumer updates the per-project live-state relay as they arrive, and the SSE route forwards only the latest delta to the browser while continuing to replay the durable history from D1. This split lets Scrimble stream live model thinking without polluting the long-term audit trail or waiting for the entire provider response to finish.

### Durable Checkpoints & Dispatch Safety

Every generation run now records a `run_id` and writes the run metadata to `generation_runs` before the queue job starts. The intake route also logs a `generation_dispatches` entry (batch name, provider id, payload size, source tracking id) before pushing to Cloudflare Queue; if the enqueue fails the API rolls back the project status so no ghost `queued` state sticks around. Each queue invocation now processes exactly one batch, carries the `run_id`, and refuses to work on stale payloads whose `run_id` no longer matches the active run. This one-batch-per-job guarantee keeps the queue from tunneling through multiple batches and ensures failures surface to the queue retry instead of being masked.

The worker loads the latest entry from `generation_checkpoints`, writes a new checkpoint after every batch, and stores metadata (batch name, provider, `degraded_tools`, `partial_failures`, etc.) in D1 while pushing large payloads—research summaries, truncated prompts, partial responses—into the Cloudflare R2 bucket named `scrimble` via the S3 API `https://275802114da3095a634457ef16168244.r2.cloudflarestorage.com/scrimble`. This hybrid D1+R2 strategy keeps row sizes manageable, captures the full history for any restart, and makes sure Batch 2 resumes from the same research graph without rerunning every tool.

Batch 1 now checkpoints deliberately before the runtime budget edge so Batch 2 can pick up the same state, and provider pinning enforces the original BYOK entry: if that provider disappears the worker fails fast with `provider_unavailable` instead of silently switching to a different key. Batch 2 also enforces stricter prompt budgets—only the richest sources make it into the payload sent to the AI provider—so we finally avoid the “AI provider isn’t responding” symptom caused by bloated prompts.

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

After `batch_3_architect` finishes, the pipeline halts automatically. The project’s `generation_status` becomes `awaiting_review`, the SSE stream emits a `checkpoint` event carrying the architecture decision record, and the generation screen switches from the activity feed into the review panel. Feedback, edits, and the preferred IDE choice are persisted with the `batch_3_architect` run and are sent to batches 4‑6. The queue consumer re-enqueues the job for `batch_4_plan_build` only after the user hits “Looks right, build my plan,” so the AI always honors the human checkpoint before continuing.

**Gate review API:**
```typescript
POST /api/steps/:id/review
Body: {
  decision: 'approve' | 'reject',
  feedback?: string,       // shown to AI on retry
  edited_output?: string   // if user edited the AI content
}
```

**Always gates:**
- Security and authentication steps
- "Go live" / deployment steps
- Any step that makes external API calls or database changes
- Architecture decisions that affect all downstream work

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
          "exit_criteria": "...",
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

Single large textarea. No character limit. "Build my plan →" button becomes active once they type anything.

If no AI provider is configured, `/new` blocks submission and shows a direct "You need to add an AI key first." call-to-action that links to Settings. The backend also rejects `POST /api/projects` when no provider can be resolved, so generation never starts in a silent-failure state.

**On submit → Generating screen:**
- Before the activity feed begins, a short "Getting ready to research" transition screen appears when the user arrives from `/new`. It lists the active research depth for this run (`Web search`, `GitHub — authenticated/public only`, `Live docs via Context7`) using the same green/muted badge styling as the architecture review panel. If any optional tools are missing, the screen lingers for ~2.5s and links to `/settings#mcp-servers`; if everything is connected it crossfades out immediately.
- Full-screen, vertically centered layout with the pulsing Scrimble mark (animated opacity pulse, 2s loop) and `bg-base`.
- The main heading swaps between the six batch labels (`Identifying your stack`, `Reading the docs`, `Designing your architecture`, `Building your plan`, `Writing step details`, `Preparing your files`) using AnimatePresence as each `batch_start` SSE event arrives.
- A single-line **Currently working** row sits above the historical log. It uses a 3px paprika pulse dot and slightly brighter type to show the latest live message in real time. Streaming `thinking` deltas land here first, and when the next activity arrives the previous live line animates up into the history below.
- A scrollable activity log (max-height 280px) streams persisted events (`activity`, `batch_complete`, `checkpoint`, `pipeline_failed`) with icons (🔍, 📦, ⚠️, 🏗️, ✅, 📝), timestamps (HH:MM:SS JetBrains Mono), and auto-scroll behavior. Each durable event carries an SSE `id:` from D1, the frontend tracks the latest seen event ID and a rendered-ID set, and reconnects after ~2 seconds with `Last-Event-ID` so replayed history never duplicates in the UI.
- A six-dot progress indicator (connected line) mirrors the batch order. Completed dots glow emerald, the current batch glows paprika with a halo, and pending dots stay muted. Labels beneath each dot match the batch short names.
- Estimated time remaining counts down from 12 minutes and recalculates dynamically as each `batch_complete` event reports `duration_ms`.
- The entire feed runs without cancel/back controls—Scrimble silently works until a terminal event arrives.
- If a builder returns to `/project/:id` while generation is still running (or while the architecture checkpoint is waiting), the canvas route redirects them back to `/project/:id/generating`, the screen reloads `projects.generation_status`, reconnects to the SSE stream, and reconstructs the full generation state from replayed D1 events before resuming live updates.

**Review checkpoint**
- When `batch_3_architect` emits a `checkpoint` SSE event, AnimatePresence crossfades the activity feed into the review panel (y: 24 → 0, opacity: 0 → 1). The panel shows:
  - "Your stack" grid of stack cards (name + package@version + reason + optional gotcha tooltip).
  - "How it's structured" data-model summary (table name + column list).
  - Feedback textarea (DM Sans 14px) for adjustments and preference buttons for `cursor`, `windsurf`, `vscode`, `claude_desktop`.
  - "Let me adjust" (ghost) and "Looks right, build my plan →" (paprika) buttons. Approval re-enqueues batch 4 with feedback; the panel stays until approved.
  - A Research depth row lives above the stack grid, displaying badges such as `[✓ Web search]`, `[✓ GitHub — authenticated]`, or `[✗ Brave Search — not connected]`. Connected badges follow the mint style (`bg-[rgba(52,211,153,0.1)]`, `border-[rgba(52,211,153,0.2)]`, `text-[#34d399]`, checkmark icon), while offline tools use a muted grey treatment (`bg-[rgba(204,197,185,0.05)]`, `border-[rgba(204,197,185,0.1)]`, `text-[var(--text-muted)]`, X icon, "not connected" suffix). Below the badges, a JetBrains Mono 11px line reads "Researched {n} technologies across {m} sources." If fewer than two tools were connected, a quiet amber nudge appears beneath: "Connect more research tools in Settings for deeper analysis next time." (Links to `/settings#mcp-servers`.)
  - A collapsible "What I read" disclosure expands to show every source the agent consulted: each entry lists the URL or GitHub repo, the MCP tool that fetched it (Brave, GitHub, Context7, or fallback fetch), and a one-line summary of the insight it contributed, proving the agent actually read the Supabase changelog or docs page it cites.
- If the SSE stream reports `pipeline_failed`, the review screen surfaces the error message and a "Try again" button that reconnects the stream.
- On success (terminal `pipeline_complete`), a Sonner toast appears ("Your project plan is ready."), waits 1.5s, then navigates to `/project/:id`.

**Background notes**
- The SSE connection attaches the Firebase auth token via `fetch` headers, reconnects automatically after disconnects, and pings the server every 20s (`: ping`) to keep proxies alive.
- Natural-language plan updates now stream their own mini activity feed inside the update modal. The server performs change analysis, mini MCP research for newly introduced technologies, diff generation, diff application, and automatic re-enrichment of affected steps before returning the final success event.
- Activity icons match the pipeline semantics: 🔍 fetching docs, 📦 hitting GitHub, ⚠️ gotcha/warning, 🏗️ architecture, ✅ completed batch, 📝 writing steps.

### 15.2.1 Auth (`/login` & `/signup`)

- Auth lives on a single, centered card inside the warm radial gradients of the entry page. The hero area stacks the hexagon badge, the mono “Getting started” label, and a heading that switches between “Pick up where you left off.” (login) and “Start your first plan.” (signup) so the surface feels more confident than a generic login form.
- The card is divided into two sections. The upper half showcases Google sign-in: a small title (“Continue with Google”), a supporting sentence about tying your plan to one account, a soft warning banner for errors (`bg-status-skipped` + `text-status-error`), and the primary button with Google’s colored icon, the label “Continue with Google,” and the paprika arrow icon.
- The lower half signals that email sign-in is coming soon. Two disabled inputs (email, password) sit under the helper text “Email sign-in is on the way,” followed by a disabled ghost button. This keeps the copy calm and honest while still hinting that more options are on the roadmap.
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

---

### 15.4 Plan Canvas (`/project/[id]`)

```
┌──────────────────────────────────────────────────────────┐
│  TOP BAR (48px) — project name + avatar                  │
├────────────────┬─────────────────────────────────────────┤
│                │                                         │
│  SIDEBAR       │  REACT FLOW CANVAS                      │
│  280px         │  warm dot-grid background               │
│                │  Stage groups containing step cards     │
│  Project name  │  Edges connecting steps                 │
│  Progress ring │                                         │
│  Risk score    │                           [minimap]     │
│  Stage list    │                      [zoom controls]    │
│                │                                         │
│  ──────────    │                                         │
│  Update plan   │                                         │
│  Export        │                                         │
└────────────────┴─────────────────────────────────────────┘
                        ↑ Step detail panel (420px)
                          slides from right on step click

Sidebar extras:
- "Download AI files" button (download icon) sits above the exports section. It calls `GET /api/projects/:id/skill-files`, shows the tooltip "Files will be ready when your plan is complete." while the pipeline is running, and enables with paprika fill + hint text: "Paste these into your IDE so your AI coding tool knows exactly what you're building."

[BOTTOM PILL NAV]  ◇ Plan   ⊞ Projects   ⚙ Settings
```

**App Bottom Pill Nav** (canvas, dashboard, settings only):
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

Every enriched step now ends with a JetBrains Mono 11px footer that reads `Researched {date} using {tools used}` (Context7, GitHub, Brave, or fallback fetch). The footer explicitly calls out any missing tools and invites the builder to connect them in Settings so future enrichments can go deeper. It anchors the Research depth story from the architecture review, proving the agent actually read the Supabase changelog, Stripe webhook guide, or deployment docs before writing the guidance.

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

### 15.7 Settings — AI Keys (`/settings`)

```
Your AI Keys

Connect the AI tools you already use. Scrimble will use them
to do the work at each step of your plan.

┌──────────────────────────────────────────────────────────┐
│  OpenAI                                    [Connected ✓] │
│  sk-...abc123                                [Remove]    │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  + Add another AI                                        │
│                                                          │
│  Which AI?  [OpenAI ▾]   [Anthropic ▾]   [Gemini ▾]    │
│             [Custom — I'll paste my URL]                 │
│                                                          │
│  Your API key: [________________________]               │
│  Model to use: [________________________]  (optional)   │
│                                                          │
│  For custom AIs — your API URL:                         │
│  [https://...]                                          │
│                                                          │
│  [Save key]                                             │
└──────────────────────────────────────────────────────────┘

Your keys are encrypted and never shared. Scrimble uses
them only to do work on your projects.
```

### 15.8 Settings — Research Tools (`/settings`)

```
Research Tools

Connect tools that let Scrimble do deeper research when
building your plan. The more you connect, the better your
plan will be.

┌──────────────────────────────────────────────────────────┐
│  Brave Search                          [Recommended]     │
│  API key: [________________________]     [Connect]       │
├──────────────────────────────────────────────────────────┤
│  GitHub                                              │
│  Personal Access Token (public_repo): [___________]   │
├──────────────────────────────────────────────────────────┤
│  Context7                              [Recommended]    │
│  API key: [________________________]     [Connect]      │
├──────────────────────────────────────────────────────────┤
│  Custom MCP                                             │
│  Server name: [____________]  Base URL: [___________]   │
└──────────────────────────────────────────────────────────┘

If no tools are connected, a subtle paprika nudge appears
between AI Keys and this section:
"Connect research tools to make your plans significantly
more accurate."

Research tools are only used during plan building. Tokens
are encrypted, masked in the UI, and can be paused or
disconnected per connection.
```

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
| `StepCard` | React Flow custom node — all status states |
| `StageGroup` | React Flow group container for stage clusters |
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

### ✅ Complete
- Firebase Auth (Google OAuth) + protected routes (Zustand authStore)
- Natural language project intake → AI plan generation
- Cloudflare D1 schema (controlled by `001_initial_schema.sql`)
- Firebase JWT verification in Pages Functions (fixed "iss" claim logic)
- Security Headers (CSP, X-Frame-Options, etc.) on all API routes
- React Flow canvas with custom StepCard components and status-driven visuals
- AI Robustness: Outbound retry logic and structured error mapping
- Optimistic UI: Checklist toggles, step completion, and panel transitions
- Step detail panel with section-level loading shimmers
- Dashboard with project cards, progress calculation, and empty states
- AI key management with custom provider URL hints
- AI step enrichment ( Gemini/OpenAI integration + D1 persistence)
- AI plan update (natural language diffing + D1 mutation)
- Sequential 6-batch generation pipeline (research stack → fetch/read → architect → plan build → enrich → file generation) with single-AI-call batches, Zod validation, `agent_runs` auditing, and SSE event persistence so the frontend always knows what the agent is doing.
- **Robustness & Privacy (Latest Updates)**:
  - **Token Guardrails**: Aggressive truncation in Batch 2 (15k docs, 10k readme) to ensure prompts stay within model sweet spots.
  - **Reasoning Guards**: Automatic JSON-only retry if a model emits only thoughts and no content (GLM-5/DeepSeek protection).
  - **Privacy Purge**: Reasoning data is physically deleted from D1 on batch/pipeline completion or project deletion.
  - **Pipeline Fallthrough Prevention**: Individual `executeBatch` functions now propagate errors by throwing a `GenerationPipelineError`. This prevents the pipeline from falling through to subsequent batches and masking the root cause with "Missing output" errors.
  - **Improved Retry Flow**: Backend `/resume` resets the project status to `queued` and clears error flags, allowing the worker to re-run the failed batch. Frontend "Try again" triggers a real re-enqueue.
  - **Dispatch Safety & R2 Checkpoints**: Every run writes a `generation_dispatches` row before enqueuing, and the worker stores checkpoints in D1 plus the R2 bucket `scrimble` (S3 API `https://275802114da3095a634457ef16168244.r2.cloudflarestorage.com/scrimble`), multiplying the durable history without hitting D1 row limits and keeping the queue state honest.
  - **Provider Pinning & Prompt Guardrails**: The queue enforces the BYOK provider assigned to the run (no silent fallbacks), and Batch 2 now builds a trimmed prompt payload from the richest sources so bloated payloads no longer leave AI providers stuck in “isn’t responding.”
  - **Degradation Transparency**: Tool failures raise `ToolExecutionError`, feed `degraded_tools`/`partial_failures`, and the UI badges research depth to explain when Brave Search, Context7, GitHub, or other sources were unavailable.
- Batch 2 now relies on the Worker-side tools layer (`fetchUrl`, `analyzeGithubRepo`, `getLibraryDocs`, `getLibraryIssues`, `searchWeb`), collecting docs, releases, issues, and Brave Search chatter, while also writing the `research_sources` ledger plus `data_quality` stats (`has_brave_search`, `has_github_token`, `has_context7`, `technologies_researched`, `urls_fetched`, `issues_found`). These metadata power the Research depth badges, "What I read" list, and per-step footers. Batch 6 still returns the six required skill/context files that are stored in D1 and zipped through `/api/projects/:id/skill-files` for download.

- Natural-language plan updates now stream through `/api/workflows/:id/update`, emitting mini activity events while the server performs change analysis, runs MCP-powered docs/issue/search research for newly mentioned technologies, generates/applies the diff, and automatically re-enriches affected steps before signaling completion.
- **SSE Streaming Overhaul**: Fully migrated AI reasoning deltas to a throttled, D1-buffered polling model. This architecture supports distributed Cloudflare Queue workers without triggering SQLite performance bottlenecks, ensuring smooth "thinking" streams for project generation, step enrichment, and plan updates.
- **Connection Safety**: Implemented strict stream lifecycle management; `writer.close()` is now guaranteed on all terminal pipeline events and server-side cleanups.
- **UI Transparency**: Introduced `Skeleton` and `ThinkingBubble` components across the dashboard and project canvas to maintain transparency during agent work.
- Research depth badges and the "Researched {date} using {tools}" footer inject transparency into the detail panel and architecture review, highlighting when Context7, Brave Search, or GitHub were used and nudging builders to connect any missing tools for deeper next-time results.
- Live generation screen now streams durable `batch_start`, `activity`, `batch_complete`, `checkpoint`, `pipeline_complete`, and `pipeline_failed` events plus transient `thinking` deltas: animated batch headings, a dedicated “Currently working” live line, icon-coded history entries, a six-dot progress tracker, ETA recalculations, and a Sonner success toast/failure state with auto-nav. The review gate panel crossfades in on `checkpoint`.
- Canvas sidebar exposes a "Download AI files" button with download icon, hint text ("Paste these into your IDE…"), and tooltip-disabled state until the files are ready.
- Human-in-the-loop review panel (Approve/Reject gates)
- Tiered Export system (Markdown + JSON)
- Stage cluster groups on canvas (React Flow `parentNode`)
- Agent working states (sweep animations) and needs-review states (amber pulse)
- First-time user guide (contextual tooltips)
- Project renaming and archiving

---

### 18. Documentation & Handoff Checklist

- [x] All environment variables documented in `ENV_MANIFEST.md`
- [x] Database schema source of truth established in `migrations/001_initial_schema.sql`
- [x] Security audit complete — no sensitive logging, CSP active
- [x] AI proxy robustness verified (Retries + Rate Limit handling)
- [x] UI/UX audit complete across all major pages

---

## 19. Future Roadmap

### Post-MVP V2
- Team collaboration + multi-user editing
- GitHub Issues sync — generate tickets from steps automatically
- Notion export
- Project analytics — time per step, skip rates, risk trends
- Template library — community-built plan templates for common project types

### V3+
- **CLI companion** — stay on track natively in your terminal
  ```bash
  scrimble status    # what's my current step?
  scrimble done      # mark it complete
  scrimble next      # what unlocks?
  scrimble update "switching to Railway" # update the plan
  ```
- Mobile companion app — morning re-entry on your phone
- IDE extension — Scrimble context injected directly into Cursor/VS Code
- Multi-agent orchestration — parallel agent workers for independent stages

---

*Scrimble Documentation v4.0 — March 2026*
*This document supersedes all previous versions and all FlowForge documentation.*
