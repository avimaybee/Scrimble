# Research Engine Architecture

This document describes the unified research architecture implemented as part of tasks **B1-B4** of the Scrimble repair plan.

## Overview

The research engine provides all data retrieval for the generation pipeline:
- Web search (Brave Search, Jina fallback)
- Document fetching (Jina Reader, Cloudflare Scrape)
- GitHub analysis (API + scraping)
- Library documentation (Context7, fallback fetch)

## Canonical Interface

**File:** `functions/server/research-facade.ts`

All research operations should go through this facade to ensure:
- Consistent fallback behavior
- Unified metadata shape (`ResearchMetadata`)
- Single source of truth for degradation signals
- Predictable subrequest tracking

### Core Functions

```typescript
// Web search with Brave → Jina fallback
searchWeb(context: ResearchContext, query: string, maxResults?: number): Promise<WebSearchResponse>

// Document fetch with reader/scrape fallback
fetchDocument(context: ResearchContext, url: string): Promise<DocumentFetchResponse>

// GitHub repo analysis with/without token
analyzeGitHubRepo(context: ResearchContext, owner: string, repo: string): Promise<GitHubAnalysisResponse>

// Library docs via Context7 or fallback
fetchLibraryDocs(context: ResearchContext, library: string, topic: string): Promise<LibraryDocsResponse>
```

### Research Context

Every function takes a `ResearchContext` that provides:
- `env`: Cloudflare bindings (DB, R2, secrets)
- `userId`: For MCP token lookup
- `projectId?`: For event tracking
- `batchName?`: For subrequest budgeting
- `subrequestTracker?`: For staying under Cloudflare limits

### Quality Metadata

Every response includes `ResearchMetadata`:

```typescript
interface ResearchMetadata {
  tool: ResearchTool;          // Which tool fulfilled the request
  quality: ResearchQuality;    // 'high' | 'medium' | 'low' | 'degraded' | 'failed'
  cached: boolean;
  degraded: boolean;
  degradationReason?: string;
  fetchedAt: string;
  durationMs?: number;
  subrequestCount?: number;
}
```

## Profile-Driven Research (B2)

Builder profile tools are now **hard inputs** to the research graph, not just hints.

### Before (filtered by inference)
```typescript
// OLD: Profile tools only included if also in inferred stack
const targets = profileTools.filter(t => inferredStack.has(t.name));
```

### After (always included)
```typescript
// NEW: Profile tools always included; inference fills gaps
const profileTargets = manifest.tools.map(t => toResearchTarget(t));
const inferredTargets = inferredStack
  .filter(t => !profileTargetKeys.has(t.name))
  .map(t => toResearchTarget(t));
const allTargets = [...briefTargets, ...profileTargets, ...inferredTargets];
```

**Key files:**
- `functions/server/generation-pipeline.ts`: `buildResearchTargets()`
- `functions/server/user-tools.ts`: Profile prompt instructions

## Live Research Default (B3)

All user-visible steps now use live research by default.

### Before
```typescript
const shouldUseLiveResearch = stepKind !== 'general' || Boolean(stepIsGate);
// General steps (most common) used cached research
```

### After
```typescript
const shouldUseLiveResearch = true;
// ALL steps do live research by default
```

**Key file:** `functions/server/step-research.ts`

## Quality Transparency (B3, B4)

Research quality is now tracked and surfaced to users.

### StepResearchFooterMeta (Extended)

```typescript
interface StepResearchFooterMeta {
  researched_at: string;
  tools: string[];
  // NEW: Quality signals
  quality: 'live' | 'cached' | 'degraded' | 'none';
  live_source_count: number;
  cached_source_count: number;
  degraded_sources?: string[];
}
```

### UI Display

The DetailPanel shows quality badges:
- **Live** (green): Fresh research from current sources
- **Cached** (yellow): Reused from batch 2 research
- **Degraded** (orange): Some sources failed or unavailable
- **Limited** (red): Minimal research available

**Key files:**
- `functions/server/step-research.ts`: `buildFooterMeta()`
- `src/types.ts`: Type definitions and parser
- `src/components/DetailPanel.tsx`: UI display

## Legacy Compatibility

For gradual migration, the facade provides legacy shims:

```typescript
// Old signature compatible
searchWebLegacy(query, userId, env): Promise<SearchResult[]>
fetchUrlLegacy(url, env): Promise<{ url, content, error? }>
analyzeGithubRepoLegacy(owner, repo, userId, env): Promise<GithubRepoAnalysis>
getLibraryDocsLegacy(library, topic, userId, env): Promise<LibraryDocsResult[]>
```

These are marked `@deprecated` and should be migrated to the new interface over time.

## Subrequest Budget

Cloudflare Workers have a 50-subrequest limit. Research uses a sequential queue with tracking:

```typescript
const RESEARCH_SUBREQUEST_LIMIT = 35; // Leave headroom

function canMakeSubrequest(tracker?: SubrequestTracker): boolean {
  return !tracker || tracker.count < tracker.limit;
}

function recordSubrequest(tracker?: SubrequestTracker): void {
  if (tracker) tracker.count++;
}
```

## MCP Integration

The facade automatically uses MCP-configured services when available:
- **Brave Search**: Requires `brave-search` MCP server with API key
- **Context7**: Requires `context7` MCP server with API key
- **GitHub**: Uses `github` MCP server token for higher rate limits

MCP tokens are retrieved via `getActiveMCPServer()` from `mcp-servers.ts`.

---

## Pipeline Simplification (C-Layer)

### C1: Canonical Batch 4 Authorship + Deterministic Batch 6 Rendering

**Problem**: Batch 4 previously produced both markdown and structure, and Batch 6 could effectively re-author the plan surface.

**Solution**: Batch 4 now authors one canonical `PlanAuthoringRecord`; Batch 6 only renders/assembles from that artifact plus Batch 5 enrichments.

```typescript
const enrichedPlan = mergePlanWithEnrichments(plan, enrichments.enrichments);
const currentHash = await computePlanAuthoringHash(plan);
const planContent = buildPlanMarkdown(plan, enrichedPlan, reviewFeedback);
```

**Key functions**:
- `computePlanAuthoringHash()`
- `mergePlanWithEnrichments()`
- `buildPlanMarkdown()`

This ensures:
- Single authored source (`PlanAuthoringRecord`)
- Deterministic rendering in Batch 6
- Fail-closed invariant checks on authored-record drift
- No markdown-first regeneration path
