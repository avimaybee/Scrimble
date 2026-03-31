/**
 * Research Ranking Module (Phase 19 - T1)
 * 
 * Extracts and modularizes source candidate ranking logic for testability
 * and tunability. Provides explicit scoring factors for transparency.
 */

import { normalizeBuilderProfileName } from '../../src/lib/builder-profile';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type SourceType = 'official_docs' | 'github_repository' | 'changelog' | 'community_page';

export type ScoringWeights = {
  relevance: number;
  freshness: number;
  authority: number;
  coverage: number;
};

export type ScoringFactors = {
  relevance: number;
  freshness: number;
  authority: number;
  coverage: number;
  duplicatePenalty: number;
};

export type SourceCandidate = {
  id: string;
  technology: string;
  sourceType: SourceType;
  tool: string;
  url: string;
  title: string;
  summary: string;
  content: string;
  scoringFactors: ScoringFactors;
  rankScore: number;
  selected: boolean;
  rejectionReason: string;
  rankPosition?: number;
};

export type RankedSource = {
  sourceId: string;
  candidateId: string;
  technology: string;
  sourceType: SourceType;
  tool: string;
  url: string;
  title: string;
  summary: string;
  rankScore: number;
  rankPosition: number;
  selected: boolean;
};

export type RankingContext = {
  projectBriefSummary: string;
  confirmedStackTools: string[];
  seenUrls?: Set<string>;
};

export type CandidateInput = {
  technology: string;
  sourceType: SourceType;
  url: string;
  title: string;
  content: string;
  tool: string;
  ordinal: number;
  fallbackSummary: string;
  lastCommitDate?: string;
  latestVersion?: string;
  hasDocs?: boolean;
  hasGithub?: boolean;
  hasCommunity?: boolean;
};

export type RankingResult = {
  sourceCandidates: SourceCandidate[];
  rankedSources: RankedSource[];
  rankingFactors: RankingFactorsReport;
};

export type RankingFactorsReport = {
  totalCandidates: number;
  selectedCount: number;
  selectionCutoffScore: number;
  perTechnologyCounts: Record<string, { total: number; selected: number }>;
  weights: ScoringWeights;
};

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  relevance: 0.38,
  freshness: 0.20,
  authority: 0.24,
  coverage: 0.18,
};

export const RANKED_SOURCES_PER_TECHNOLOGY = 5;

const SOURCE_TYPE_WEIGHTS: Record<SourceType, number> = {
  official_docs: 1.0,
  github_repository: 0.92,
  changelog: 0.85,
  community_page: 0.62,
};

// ─────────────────────────────────────────────────────────────────
// Scoring Functions
// ─────────────────────────────────────────────────────────────────

function buildMatchTokens(...values: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const value of values) {
    const normalized = normalizeBuilderProfileName(value || '');
    if (normalized) {
      tokens.add(normalized);
      for (const word of normalized.split(/[\s\-_]+/)) {
        if (word.length >= 2) {
          tokens.add(word);
        }
      }
    }
  }
  return tokens;
}

function targetsOverlap(setA: Set<string>, setB: Set<string>): boolean {
  for (const token of setA) {
    if (setB.has(token)) {
      return true;
    }
    for (const other of setB) {
      if (token.includes(other) || other.includes(token)) {
        return true;
      }
    }
  }
  return false;
}

export function sourceTypeWeight(sourceType: SourceType): number {
  return SOURCE_TYPE_WEIGHTS[sourceType] ?? 0.62;
}

export function inferAuthorityScore(sourceType: SourceType, url: string): number {
  const normalized = url.toLowerCase();
  if (sourceType === 'official_docs') return 1.0;
  if (sourceType === 'github_repository') return 0.9;
  if (sourceType === 'changelog') return 0.82;
  if (normalized.includes('stackoverflow') || normalized.includes('reddit') || normalized.includes('dev.to')) {
    return 0.48;
  }
  return 0.6;
}

export function inferFreshnessScore(
  sourceType: SourceType,
  lastCommitDate: string,
  latestVersion: string,
  content: string,
): number {
  if (sourceType === 'changelog' || sourceType === 'github_repository') {
    const hasRecentStamp = /\b20(2[4-9]|3[0-9])\b/.test(`${lastCommitDate} ${latestVersion} ${content}`);
    return hasRecentStamp ? 0.9 : 0.5;
  }
  return 0.65;
}

export function inferCoverageScore(
  sourceType: SourceType,
  hasDocs: boolean,
  hasGithub: boolean,
  hasCommunity: boolean,
): number {
  if (sourceType === 'official_docs' && hasDocs) return 0.95;
  if (sourceType === 'github_repository' && hasGithub) return 0.85;
  if (sourceType === 'community_page' && hasCommunity) return 0.7;
  if (sourceType === 'changelog') return 0.78;
  return 0.55;
}

export function inferRelevanceScore(
  sourceType: SourceType,
  technology: string,
  context: RankingContext,
): number {
  const summaryTokens = buildMatchTokens(context.projectBriefSummary, ...context.confirmedStackTools);
  const technologyTokens = buildMatchTokens(technology);
  const briefOverlap = targetsOverlap(summaryTokens, technologyTokens);
  const relevanceBase = briefOverlap ? 0.9 : 0.65;
  return Math.min(1, relevanceBase + sourceTypeWeight(sourceType) * 0.2);
}

function summarizeSnippet(text: string, maxLength: number): string {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const truncated = normalized.slice(0, maxLength - 3).trim();
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLength * 0.6 ? `${truncated.slice(0, lastSpace)}...` : `${truncated}...`;
}

// ─────────────────────────────────────────────────────────────────
// Core Ranking Functions
// ─────────────────────────────────────────────────────────────────

export function buildCandidateId(
  technology: string,
  sourceType: SourceType,
  url: string,
  ordinal: number,
): string {
  const key = normalizeBuilderProfileName(`${technology}-${sourceType}-${url || 'source'}-${ordinal}`);
  return `candidate_${key || `${sourceType}_${ordinal}`}`;
}

export function computeRankScore(
  factors: ScoringFactors,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): number {
  const rawScore =
    factors.relevance * weights.relevance +
    factors.freshness * weights.freshness +
    factors.authority * weights.authority +
    factors.coverage * weights.coverage -
    factors.duplicatePenalty;

  return Number(Math.max(0, Math.min(1, rawScore)).toFixed(4));
}

export function scoreCandidate(
  input: CandidateInput,
  context: RankingContext,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): { factors: ScoringFactors; rankScore: number; summary: string } {
  const seenUrls = context.seenUrls ?? new Set<string>();
  const normalizedUrl = input.url.trim().toLowerCase();
  const duplicatePenalty = normalizedUrl && seenUrls.has(normalizedUrl) ? 0.25 : 0;

  const factors: ScoringFactors = {
    relevance: inferRelevanceScore(input.sourceType, input.technology, context),
    freshness: inferFreshnessScore(
      input.sourceType,
      input.lastCommitDate || '',
      input.latestVersion || '',
      input.content,
    ),
    authority: inferAuthorityScore(input.sourceType, input.url),
    coverage: inferCoverageScore(
      input.sourceType,
      input.hasDocs ?? false,
      input.hasGithub ?? false,
      input.hasCommunity ?? false,
    ),
    duplicatePenalty,
  };

  const rankScore = computeRankScore(factors, weights);
  const summary = summarizeSnippet(input.content, 220) || input.fallbackSummary;

  return { factors, rankScore, summary };
}

export function createSourceCandidate(
  input: CandidateInput,
  context: RankingContext,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): SourceCandidate {
  const { factors, rankScore, summary } = scoreCandidate(input, context, weights);

  return {
    id: buildCandidateId(input.technology, input.sourceType, input.url, input.ordinal),
    technology: input.technology,
    sourceType: input.sourceType,
    tool: input.tool,
    url: input.url,
    title: input.title,
    summary,
    content: input.content,
    scoringFactors: factors,
    rankScore,
    selected: false,
    rejectionReason: '',
  };
}

export function deduplicateCandidates(candidates: SourceCandidate[]): SourceCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const normalizedUrl = candidate.url.trim().toLowerCase();
    if (!normalizedUrl) {
      return true;
    }
    if (seen.has(normalizedUrl)) {
      return false;
    }
    seen.add(normalizedUrl);
    return true;
  });
}

export function rankSourceCandidates(
  candidates: SourceCandidate[],
  maxPerTechnology: number = RANKED_SOURCES_PER_TECHNOLOGY,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): RankingResult {
  // Sort by rank score descending
  const sorted = [...candidates].sort((a, b) => b.rankScore - a.rankScore);

  // Assign rank positions
  const ranked = sorted.map((candidate, index) => ({
    ...candidate,
    rankPosition: index + 1,
  }));

  // Select top N per technology
  const selectedByTechnology = new Map<string, number>();
  const selectedIds = new Set<string>();
  let lowestSelectedScore = 1;

  for (const candidate of ranked) {
    const current = selectedByTechnology.get(candidate.technology) || 0;
    if (current >= maxPerTechnology) {
      continue;
    }
    selectedByTechnology.set(candidate.technology, current + 1);
    selectedIds.add(candidate.id);
    lowestSelectedScore = Math.min(lowestSelectedScore, candidate.rankScore);
  }

  // Mark selected/rejected
  const sourceCandidates: SourceCandidate[] = ranked.map((candidate) => ({
    ...candidate,
    selected: selectedIds.has(candidate.id),
    rejectionReason: selectedIds.has(candidate.id)
      ? ''
      : `ranked below per-technology selection cutoff (score ${candidate.rankScore.toFixed(3)} < cutoff)`,
  }));

  // Build ranked sources
  const rankedSources: RankedSource[] = ranked.map((candidate) => ({
    sourceId: `source_${candidate.id}`,
    candidateId: candidate.id,
    technology: candidate.technology,
    sourceType: candidate.sourceType,
    tool: candidate.tool,
    url: candidate.url,
    title: candidate.title,
    summary: candidate.summary,
    rankScore: candidate.rankScore,
    rankPosition: candidate.rankPosition!,
    selected: selectedIds.has(candidate.id),
  }));

  // Build ranking factors report
  const perTechnologyCounts: Record<string, { total: number; selected: number }> = {};
  for (const candidate of ranked) {
    if (!perTechnologyCounts[candidate.technology]) {
      perTechnologyCounts[candidate.technology] = { total: 0, selected: 0 };
    }
    perTechnologyCounts[candidate.technology].total += 1;
    if (selectedIds.has(candidate.id)) {
      perTechnologyCounts[candidate.technology].selected += 1;
    }
  }

  const rankingFactors: RankingFactorsReport = {
    totalCandidates: candidates.length,
    selectedCount: selectedIds.size,
    selectionCutoffScore: lowestSelectedScore,
    perTechnologyCounts,
    weights,
  };

  return { sourceCandidates, rankedSources, rankingFactors };
}

// ─────────────────────────────────────────────────────────────────
// Confidence Helpers
// ─────────────────────────────────────────────────────────────────

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'degraded';

export function rankScoreToConfidence(rankScore: number): ConfidenceLevel {
  if (rankScore >= 0.82) return 'high';
  if (rankScore >= 0.68) return 'medium';
  if (rankScore >= 0.5) return 'low';
  return 'degraded';
}

// ─────────────────────────────────────────────────────────────────
// Legacy Adapter (for backward compatibility with generation-pipeline)
// ─────────────────────────────────────────────────────────────────

export type LegacySourceCandidate = {
  id: string;
  technology: string;
  source_type: SourceType;
  tool: string;
  url: string;
  title: string;
  summary: string;
  authority_score: number;
  freshness_score: number;
  relevance_score: number;
  duplicate_penalty: number;
  coverage_score: number;
  rank_score: number;
  selected: boolean;
  rejection_reason: string;
  rank_position?: number;
};

export type LegacyRankedSource = {
  source_id: string;
  candidate_id: string;
  technology: string;
  source_type: SourceType;
  tool: string;
  url: string;
  title: string;
  summary: string;
  rank_score: number;
  rank_position: number;
  selected: boolean;
};

export function toLegacyCandidate(candidate: SourceCandidate): LegacySourceCandidate {
  return {
    id: candidate.id,
    technology: candidate.technology,
    source_type: candidate.sourceType,
    tool: candidate.tool,
    url: candidate.url,
    title: candidate.title,
    summary: candidate.summary,
    authority_score: Number(candidate.scoringFactors.authority.toFixed(4)),
    freshness_score: Number(candidate.scoringFactors.freshness.toFixed(4)),
    relevance_score: Number(candidate.scoringFactors.relevance.toFixed(4)),
    duplicate_penalty: Number(candidate.scoringFactors.duplicatePenalty.toFixed(4)),
    coverage_score: Number(candidate.scoringFactors.coverage.toFixed(4)),
    rank_score: candidate.rankScore,
    selected: candidate.selected,
    rejection_reason: candidate.rejectionReason,
    rank_position: candidate.rankPosition,
  };
}

export function toLegacyRankedSource(source: RankedSource): LegacyRankedSource {
  return {
    source_id: source.sourceId,
    candidate_id: source.candidateId,
    technology: source.technology,
    source_type: source.sourceType,
    tool: source.tool,
    url: source.url,
    title: source.title,
    summary: source.summary,
    rank_score: source.rankScore,
    rank_position: source.rankPosition,
    selected: source.selected,
  };
}
