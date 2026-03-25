# Scrimble — Core Product Vision
### What This Is, Why It Exists, and What It Needs to Become
*Written March 2026 — For the builder who built it*

---

## The One-Line Truth

Scrimble is the tool you have open next to your IDE while you build — not a tool you visit, but a companion that tells you exactly what to do next, one step at a time, referenced to your actual tools, until the project is done.

---

## Why This Exists

There is a specific kind of builder this was made for. They move fast. They think in products, not in engineering theory. They use Claude, Cursor, ChatGPT, and whatever else gets the job done. They can spin up a working prototype in a weekend.

But they cannot finish things.

Not because they lack skill. Because they lack a system.

Here is what actually happens to them on every project:

They start with a clear idea. Three days in, they are deep inside a feature they did not plan for — something shiny, something interesting, something that felt urgent in the moment. The core features are half-built. The foundation is not solid. But they are already three layers on top of it.

Then they step away for a weekend. When they come back, they genuinely do not remember what state the project is in. Which parts work. What was next. They have to reconstruct context from their own code, their own chat history, their own scattered notes. Half the time they just start something new.

The result is a graveyard of 70% done projects. Apps that work in demos but fall apart in real use. Ideas that were genuinely good, killed by the absence of a system to see them through.

This is not a skill problem. This is a focus problem. A structure problem. A "no one is keeping me on track" problem.

Scrimble exists to be that system.

---

## What Scrimble Actually Is

The mental model is GPS, not a map.

A map shows you the territory. A GPS tells you what to do right now — turn left in 200 metres, take the second exit, you have arrived. It knows where you are. It recalculates when you go off route. It never overwhelms you with the full picture when all you need is the next instruction.

Scrimble is GPS for building software.

You describe what you want to build. Scrimble asks a few sharp questions to understand what you actually mean — not a form, not a dropdown, a real conversation. Then it does the work: reads the documentation for your specific stack, studies what other builders ran into with the same tools, looks at GitHub issues, understands the current state of the libraries you are using. All of that research feeds into a single output: a plan built specifically for you, for your tools, for your project.

Then it guides you through it. One step at a time. Each step tells you exactly where to go, what to open, what to do there, what to bring back. Not "set up authentication." More like: open Supabase, go to Authentication, enable Google OAuth, grab your client ID and secret from Google Cloud Console, paste them here, set the redirect URL to this exact value, then come back and mark this done.

You read the step. You go do it in your IDE. You come back. You mark it done. The next step unlocks.

That loop, repeated, is how projects get finished.

---

## The Three Things That Make It Work

### 1. Research That Is Actually Deep

Before a single step is written, Scrimble's research agent studies your stack. Not generic documentation — the specific tools you use, in the versions you use them, with the actual problems people are running into right now.

It reads the official docs. It checks the GitHub issues. It searches for recent gotchas and breaking changes. It knows your workspace — the IDEs you use, the frameworks you have selected, the services you are paying for — and it uses all of that to tailor every step to your actual situation.

The plan it produces is not a template. It is not generic advice reworded. It is evidence-based guidance built from real research into your real stack. When a step tells you to do something, there is a reason grounded in what the docs actually say, what the community has actually run into, what the current best practice actually is.

This is the foundation. Without deep research, the steps are hollow. With it, they are trustworthy.

### 2. Turn-by-Turn Navigation, Not Advice

Every step in Scrimble follows one standard: it tells you exactly what to do, not conceptually what should happen.

The difference matters enormously.

Advice sounds like: "Set up your database schema with the appropriate tables for your use case."

Navigation sounds like: "Open Supabase. Go to Table Editor. Create a new table called `users`. Add these columns: `id` (uuid, primary key, default gen_random_uuid()), `email` (text, unique, not null), `created_at` (timestamptz, default now()). Then go to Authentication → Policies and enable Row Level Security on this table."

The first is something you already know you need to do. The second is something you can actually do, right now, without having to figure out the specifics yourself.

Every step in Scrimble should read like a senior engineer briefing a capable colleague — specific, directional, respectful of their intelligence, focused only on what is non-obvious. Not a tutorial. Not a lecture. A brief.

And critically: the instructions reference your actual tools by name. Not "your database" — Supabase. Not "your deployment platform" — Railway. Not "your auth provider" — Clerk. The step knows your stack because Scrimble knows your workspace, and it uses that knowledge to make every instruction immediately actionable.

### 3. The Forcing Function

You cannot skip ahead.

This is not a punishment. It is the entire product philosophy in one rule.

The single biggest reason vibe coders do not finish projects is scope drift — the tendency to start working on something new before the current thing is done. It feels productive. It feels creative. It is actually the thing that kills projects.

Scrimble prevents it structurally. You cannot touch the next step until the current one is complete. You can skip a step if you consciously choose to — but Scrimble tells you what you are risking when you do, and it remembers that you skipped it. The plan adapts. But the linear path forward is always there, always clear, always one step at a time.

This is structured discipline. Not gamification, not streaks, not badges. Just a system that enforces what every builder knows is true but cannot hold themselves to: finish this before you touch that.

---

## The Workspace Profile — The Intelligence Engine

The settings page where you add your tools, frameworks, databases, IDEs, subscriptions, and AI models is not just a preferences page. It is the intelligence source that makes everything else work.

The more you fill it in, the more specific Scrimble becomes.

If you have Supabase in your profile and you are building something that needs authentication, Scrimble does not give you a generic auth step — it gives you the Supabase Auth step, with the exact configuration options for the version you are using, with the specific gotchas that come up with Supabase Auth in your framework.

If you have Railway in your profile, the deployment steps reference Railway. If you have Stripe, the payment steps pull from Stripe's actual documentation. If you use Cursor as your IDE, the AI prompts are written specifically for Cursor.

The workspace profile is what separates a generic plan from your plan.

This integration between profile and plan is the single most important feature to get right. It is what makes Scrimble feel like it actually knows you — because it does.

---

## The Daily Re-Entry

The most important moment in Scrimble is not when you create a project. It is when you come back to one.

You have been away. Maybe a day, maybe a week. You open Scrimble. In three seconds you know: where you are, what is next, and what the AI has already prepared for you. No reconstruction. No archaeology through your own files. Just clarity.

This is the daily anchor. The thing that makes Scrimble not just useful for starting projects, but essential for finishing them.

Every morning you open Scrimble and you know exactly what to do. That is the product promise. Everything else serves that moment.

---

## The Living Plan

Projects change. Scrimble's plan changes with them.

You get an idea halfway through — a new feature, a different approach, a technology swap. You do not file a ticket or open a settings panel. You tell Scrimble in plain language: "I want to switch from Vercel to Railway" or "I need to add a payment flow" or "I decided to drop the mobile view for now."

Scrimble reads your existing plan, understands what has already been done and what has not, runs targeted research on the new technology if needed, and weaves the changes into the workflow. Completed steps stay complete. New steps appear in the right order. The path forward is always coherent.

The plan is never a document. It is always a living structure that reflects the current state of the project.

---

## What the User Feels

At the end of a session, the user should feel: I made real progress. I know exactly where I am. I know exactly what is next. Nothing is ambiguous.

After finishing a project through Scrimble, the user should feel: I actually built that. It works. It is real. And — almost as a side effect — I understand the process now. I have done it once. I could do it again.

That subconscious learning is the long-term product value. Not because Scrimble teaches them anything explicitly. But because they lived the process, step by step, every time. After three or four projects, the workflow is in their bones.

---

## What Scrimble Is Not

**It is not a project manager.** It does not track teams, sprints, or deadlines. It guides a single builder through a single project at a time.

**It is not a code generator.** The AI coding tools do that — Cursor, Claude Code, Windsurf. Scrimble guides when to use them and what to ask them to do.

**It is not a chatbot.** It has memory, structure, and a visual workflow. It does not just answer questions — it holds the thread of an entire project across sessions.

**It is not generic.** A plan built for a Spotify clone using Next.js, Cloudflare D1, and Firebase Auth should read completely differently from a plan built for a SaaS dashboard using Remix, Supabase, and Stripe. If the steps could have been written for anyone, they were written for no one.

**It is not a tool that respects false intelligence in its users.** Scrimble trusts the builder to be capable and smart. It does not over-explain obvious things. It does not add warnings before every action. It gives you what you need and trusts you to handle it.

---

## The North Star

One sentence: a builder finishes a real project through Scrimble and, when they start the next one, they already know how to think about it.

Not because Scrimble lectured them. Because they lived it.

---

## The Gaps That Matter Most Right Now

These are the places where the current product diverges most from this vision. They are listed in order of how much they matter:

**1. Step content quality.** Steps currently give guidance. They need to give navigation. The difference between "configure your database" and "open Supabase, go to Table Editor, create this table with these exact columns" is the whole product. This is the most important thing to fix.

**2. Workspace profile integration.** The profile is collected but not fully used. When Scrimble researches a plan, it should be using the profile to decide what to research — which documentation to read, which GitHub repos to check, which tool-specific gotchas to look for. A plan generated for someone with Supabase, Railway, and Clerk should look completely different from one generated for someone with Firebase, Vercel, and Auth0.

**3. The plan view.** The current vertical timeline is a placeholder. The intended experience is a node-based canvas where you can see the entire project laid out — where you have been, where you are, the path ahead. It should feel like looking at a map of your project, not scrolling through a list. This is the daily anchor screen and it needs to feel like one.

**4. Research depth.** The research phase works but does not yet consistently produce the depth that makes steps trustworthy. The goal is that when Scrimble tells you something about your stack, it is because it actually read the documentation, not because it guessed.

---

## The One Thing

If Scrimble does one thing better than anything else in the world, it should be this:

A builder opens it at 9am, sees exactly what they need to do today, does it, marks it done, and closes their laptop knowing they made real progress on something that is actually going to get finished.

Everything else is in service of that moment.

---

*This document describes the intended product experience. It was written to orient all future development toward the real vision rather than the current implementation state.*