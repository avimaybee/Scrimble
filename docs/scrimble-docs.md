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
| Framework | Next.js 14 (App Router) | SSR, routing, TypeScript |
| Language | TypeScript | End-to-end type safety |
| Styling | Tailwind CSS + CSS Variables | Utility classes + design tokens |
| Canvas | React Flow (`@xyflow/react`) | Step-based graph rendering |
| Animation | Framer Motion | All transitions and interactions |
| State | Zustand | Client-side app state |
| Icons | Lucide React | Consistent icon set |
| Fonts | Fraunces + DM Sans + JetBrains Mono | See Design System |
| UI Primitives | shadcn/ui (selective only) | Dialog, Tooltip, DropdownMenu, Sonner |
| HTTP Client | `hono/client` or native fetch | Typed API calls to Workers |

### Backend
| Concern | Choice | Notes |
|---|---|---|
| Runtime | Cloudflare Pages Functions | Edge serverless — all API routes live in `/functions` |
| Database | Cloudflare D1 (SQLite) | Relational, edge-native, bound to Pages |
| Auth | Firebase Auth (auth only) | Google OAuth + email/password — JWT verification in Functions |
| AI Routing | Function-side proxy | All AI calls proxied through Functions — user keys never leave server |
| Background Jobs | Cloudflare Queues | Async AI agent tasks (triggered from Functions) |
| Hosting | Cloudflare Pages | Unified frontend and backend deployment |

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

### Firebase JWT Verification in Workers
```typescript
// workers/middleware/auth.ts
async function verifyFirebaseToken(token: string, env: Env): Promise<string> {
  // Fetch Firebase public keys — cached in Cloudflare Cache API (1hr TTL)
  const KEYS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  
  const cache = caches.default
  let keysResponse = await cache.match(KEYS_URL)
  if (!keysResponse) {
    keysResponse = await fetch(KEYS_URL)
    await cache.put(KEYS_URL, keysResponse.clone())
  }
  const keys = await keysResponse.json()
  
  // Verify JWT: signature, expiry, iss, aud = env.FIREBASE_PROJECT_ID
  const uid = await verifyJWT(token, keys, env.FIREBASE_PROJECT_ID)
  return uid // Firebase UID → used as user_id in D1
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
Every section uses a mono uppercase label with a paprika dash before it:
```css
.section-label {
  display: flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono'; font-size: 11px;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--accent-soft);
}
.section-label::before {
  content: ''; width: 16px; height: 1.5px;
  background: var(--accent); border-radius: 2px; flex-shrink: 0;
}
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
// Between routes (Next.js App Router):
// Outgoing: opacity 1 → 0, y 0 → -8, 200ms
// Incoming: opacity 0 → 1, y 8 → 0, 300ms, delay 100ms
```

### Bottom Pill Nav (App Pages)
```typescript
// On mount: y: 24 → 0, opacity: 0 → 1, delay 400ms (after page content)
// Active item switch: background slides with layout animation
// layoutId="active-pill" on the active indicator for smooth morphing
```

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
CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_providers_user  ON ai_providers(user_id);
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
POST   /api/workflows/:id/update   → Natural language plan update → AI diff → D1

GET    /api/steps/:id              → Get full step content
PATCH  /api/steps/:id              → Update step status or content
POST   /api/steps/:id/complete     → Mark complete, unlock downstream steps
POST   /api/steps/:id/skip         → Skip step, note risk, unlock downstream
POST   /api/steps/:id/enrich       → Queue AI enrichment job
POST   /api/steps/:id/review       → Submit human review (approve/reject at gate)

PATCH  /api/checklist/:itemId      → Toggle checklist item

GET    /api/settings/ai-providers  → List user's AI providers (keys masked)
POST   /api/settings/ai-providers  → Add new AI provider key
DELETE /api/settings/ai-providers/:id → Remove AI provider

POST   /api/ai/proxy               → Proxied AI call (uses user's stored key)
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

### API Key Security
```
Storage: AES-256 encrypted in D1 (ai_providers.api_key_enc)
Encryption key: Stored in Cloudflare Worker secret (env.ENCRYPTION_KEY)
In transit: Key is decrypted only inside Worker memory, never sent to client
Displayed: Masked on client (e.g. "sk-...abc123" — first 3 + last 6 chars)
Deleted: Removed from D1 on user request — no recovery
```

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

**On submit → Generating screen:**
- Full screen, pulsing Scrimble logo mark
- Sequential streaming status: "Reading your description..." → "Figuring out the stages..." → "Writing your steps..." → "Almost done..."
- Each line fades in and out with Framer Motion
- Background: subtle warm radial pulse emanating from logo

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
│  Next.js · Supabase · Stripe          2 hours ago       │
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

[BOTTOM PILL NAV]  ◇ Plan   ⊞ Projects   ⚙ Settings
```

**App Bottom Pill Nav** (canvas, dashboard, settings only):
```css
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
3. **What the AI prepared** — shimmer skeleton while loading → rendered markdown artifact
4. **Prompts to use** — copy-pasteable prompt cards with Copy button
5. **Suggested tools** — horizontal chip scroll
6. **Things to check** — interactive checklist, required items marked
7. **Done when...** — exit criteria in emerald border container

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
- Cloudflare D1 schema + Firebase JWT verification in Workers
- React Flow canvas with custom StepCard components
- Graph progression (complete step → unlock downstream)
- Left sidebar with stage list and completion %
- Step detail panel with checklist interaction
- Gated completion (disabled until required items checked)
- Skip logic with risk warning modal
- Dashboard with project cards, loading/empty states

### 🚧 Remaining

**Critical — Core AI loop:**
- [ ] AI step enrichment (shimmer skeleton → Gemini/OpenAI call → D1 write → render)
- [ ] AI plan update (natural language → diff → D1 mutation → canvas re-render)
- [ ] Human-in-the-loop review panel in StepPanel

**Critical — BYOK:**
- [ ] AI Keys settings page (add, list, remove providers)
- [ ] Encrypted key storage in D1
- [ ] AI provider abstraction layer + proxy Worker route
- [ ] User's key used for all agent calls (not hardcoded key)

**Polish:**
- [ ] Stage cluster groups on canvas (React Flow `parentNode`)
- [ ] Accurate dashboard progress bar (real D1 calculation)
- [ ] Unlock toast animation
- [ ] Export to Markdown
- [ ] Agent working state on step cards (sweep animation)
- [ ] Needs-review state on step cards (amber pulse)
- [ ] Welcome guide for first-time users

---

## 18. Remaining Work — Priority Order

```
1.  AI Keys settings page          — unblocks everything else
2.  AI provider abstraction layer  — required for enrichment + update
3.  Fix dashboard progress bar     — 15 min, high visible impact
4.  Unlock toast                   — 20 min, satisfying UX moment
5.  Step enrichment                — core product value
6.  Human-in-the-loop review       — core product value
7.  Plan update (natural language) — core product value
8.  Agent working animations       — makes AI activity visible
9.  Export to Markdown             — useful, low risk
10. Stage clusters on canvas       — React Flow refactor, do last
```

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
