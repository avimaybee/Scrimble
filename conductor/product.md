# Initial Concept
Scrimble is a CLI-resident execution companion for solo AI-native builders that helps them finish projects.

# Scrimble Product Guide

## Vision
Scrimble is designed as a calm, repo-native operator that assists solo AI-native builders in finishing their projects. It bridges the gap between high-level intent and low-level execution by providing a structured, verifiable, and resumable workflow directly within the terminal.

## Core Features
- **Conversational Orchestration:** An interactive REPL and one-shot command interface that understands natural language goals.
- **Automated Planning:** Automatically proposes short, bounded next-step plans before performing any mutations.
- **Local Ledger Runtime:** Canonical orchestration state is stored locally in `.scrimble/`, ensuring transparency and resumability.
- **Execution Safety:** A safety model based on task ownership scope, where edits to files outside of a task's declared scope are blocked.
- **Multi-Provider AI Support:** Deep integration with various AI providers (OpenAI, Anthropic, Google, GitHub Copilot) via the Vercel AI SDK.
- **Status & Orientation:** Automatically checks setup and progress to orient the user within their project.

## Target Audience
Solo software engineers and developers who use AI tools but need a more structured, local-first companion to manage the execution of long-horizon tasks.

## Success Metrics
- **Completion Rate:** Increase in the number of projects/features successfully completed.
- **Developer Focus:** Reduction in time spent on routine setup and planning tasks.
- **Reliability:** High success rate of proposed plans and executed actions.
