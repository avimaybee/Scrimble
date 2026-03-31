/**
 * Research Evidence Module (Phase 19 - T3)
 * 
 * Builds entity-level evidence packs from source notes and chunks.
 * Evidence packs are grouped by technology + concern (not just topic),
 * with explicit citation tracing and coverage assessment.
 */

import { normalizeBuilderProfileName } from '../../src/lib/builder-profile';
import type { ResearchChunk } from './research-chunks';
import type { RankedSource } from './research-ranking';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'degraded';

export type EvidencePackTopic =
  | 'architecture'
  | 'setup_configuration'
  | 'integration_gotchas'
  | 'deployment_concerns'
  | 'breaking_changes';

export type EvidencePackConcern =
  | 'gotchas'
  | 'setup'
  | 'migration'
  | 'performance'
  | 'security'
  | 'deprecation';

export type CoverageStatus = 'strong' | 'thin' | 'degraded';

export type SourceNote = {
  id: string;
  sourceId: string;
  technology: string;
  sourceType: string;
  summary: string;
  whatChanged: string;
  confidence: ConfidenceLevel;
  chunkCitations: string[];
};

export type EvidencePack = {
  id: string;
  topic: EvidencePackTopic;
  concern: EvidencePackConcern;
  technology: string;
  summary: string;
  confidence: ConfidenceLevel;
  coverage: CoverageStatus;
  sourceIds: string[];
  sourceNoteIds: string[];
  chunkCitations: string[];
  rankScore: number;
};

export type EvidenceBuildContext = {
  selectedSources: RankedSource[];
  chunkStore: ResearchChunk[];
  maxChunksPerNote?: number;
};

export type EvidenceBuildResult = {
  sourceNotes: SourceNote[];
  evidencePacks: EvidencePack[];
  coverageSummary: CoverageSummary;
};

export type CoverageSummary = {
  totalNotes: number;
  totalPacks: number;
  strongPacks: number;
  thinPacks: number;
  degradedPacks: number;
  technologiesCovered: string[];
  topicsCovered: EvidencePackTopic[];
};

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

export const MAX_CHUNKS_PER_NOTE = 4;
export const STRONG_COVERAGE_THRESHOLD = 3;
export const THIN_COVERAGE_THRESHOLD = 2;

export const TOPIC_MATCHERS: Array<{ topic: EvidencePackTopic; concern: EvidencePackConcern; matcher: RegExp }> = [
  {
    topic: 'architecture',
    concern: 'setup',
    matcher: /\b(architecture|data model|schema|service|api|infrastructure)\b/i,
  },
  {
    topic: 'setup_configuration',
    concern: 'setup',
    matcher: /\b(setup|install|config|environment|initialize)\b/i,
  },
  {
    topic: 'integration_gotchas',
    concern: 'gotchas',
    matcher: /\b(gotcha|issue|bug|regression|conflict|breaking)\b/i,
  },
  {
    topic: 'deployment_concerns',
    concern: 'performance',
    matcher: /\b(deploy|release|rollout|production|hosting)\b/i,
  },
  {
    topic: 'breaking_changes',
    concern: 'migration',
    matcher: /\b(changelog|release|deprecat|breaking|migration)\b/i,
  },
];

// Additional concern-specific matchers for entity-level evidence
export const CONCERN_MATCHERS: Array<{ concern: EvidencePackConcern; matcher: RegExp }> = [
  { concern: 'security', matcher: /\b(security|vulnerability|auth|permission|csrf|xss|injection)\b/i },
  { concern: 'performance', matcher: /\b(performance|latency|throughput|optimize|cache|slow)\b/i },
  { concern: 'deprecation', matcher: /\b(deprecat|sunset|eol|end.of.life|legacy|obsolete)\b/i },
  { concern: 'migration', matcher: /\b(migrat|upgrade|version|breaking|incompatible)\b/i },
];

// ─────────────────────────────────────────────────────────────────
// Confidence Helpers
// ─────────────────────────────────────────────────────────────────

export function scoreToConfidence(rankScore: number): ConfidenceLevel {
  if (rankScore >= 0.82) return 'high';
  if (rankScore >= 0.68) return 'medium';
  if (rankScore >= 0.5) return 'low';
  return 'degraded';
}

export function coverageFromNoteCount(count: number): CoverageStatus {
  if (count >= STRONG_COVERAGE_THRESHOLD) return 'strong';
  if (count >= THIN_COVERAGE_THRESHOLD) return 'thin';
  return 'degraded';
}

// ─────────────────────────────────────────────────────────────────
// Text Utilities
// ─────────────────────────────────────────────────────────────────

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
// Source Notes
// ─────────────────────────────────────────────────────────────────

/**
 * Build source notes from ranked sources and chunk store.
 */
export function buildSourceNotes(
  selectedSources: RankedSource[],
  chunkStore: ResearchChunk[],
  maxChunksPerNote: number = MAX_CHUNKS_PER_NOTE,
): SourceNote[] {
  return selectedSources.map((source, index) => {
    // Find chunks for this source
    const sourceChunks = chunkStore
      .filter((chunk) => chunk.sourceId === source.sourceId)
      .slice(0, maxChunksPerNote);

    const chunkCitations = sourceChunks.map((chunk) => chunk.id);
    const aggregateText = sourceChunks.map((chunk) => chunk.content).join(' ');
    const confidence = scoreToConfidence(source.rankScore);

    return {
      id: `source_note_${String(index + 1).padStart(3, '0')}`,
      sourceId: source.sourceId,
      technology: source.technology,
      sourceType: source.sourceType,
      summary: summarizeSnippet(`${source.title} ${source.summary} ${aggregateText}`, 240),
      whatChanged: summarizeSnippet(aggregateText, 200),
      confidence,
      chunkCitations,
    };
  });
}

// ─────────────────────────────────────────────────────────────────
// Evidence Pack Building
// ─────────────────────────────────────────────────────────────────

/**
 * Match chunks to an evidence pack topic.
 */
export function matchChunksToEvidence(
  chunks: ResearchChunk[],
  topic: EvidencePackTopic,
  technology: string,
): string[] {
  const matcher = TOPIC_MATCHERS.find((m) => m.topic === topic)?.matcher;
  if (!matcher) return [];

  return chunks
    .filter((chunk) =>
      chunk.technology.toLowerCase() === technology.toLowerCase() &&
      matcher.test(chunk.content),
    )
    .map((chunk) => chunk.id);
}

/**
 * Infer the primary concern for a set of notes.
 */
function inferConcern(notes: SourceNote[]): EvidencePackConcern {
  const combinedText = notes.map((n) => `${n.summary} ${n.whatChanged}`).join(' ');

  for (const { concern, matcher } of CONCERN_MATCHERS) {
    if (matcher.test(combinedText)) {
      return concern;
    }
  }

  return 'setup';
}

/**
 * Build evidence packs grouped by technology and topic.
 */
export function buildEvidencePacks(
  sourceNotes: SourceNote[],
  selectedSources: RankedSource[],
  chunkStore: ResearchChunk[],
): EvidencePack[] {
  const evidencePacks: EvidencePack[] = [];
  const technologies = Array.from(new Set(sourceNotes.map((note) => note.technology)));

  for (const technology of technologies) {
    const notesForTechnology = sourceNotes.filter((note) => note.technology === technology);

    for (const { topic, concern: defaultConcern, matcher } of TOPIC_MATCHERS) {
      const matchedNotes = notesForTechnology.filter((note) =>
        matcher.test(`${note.summary} ${note.whatChanged}`),
      );

      if (matchedNotes.length === 0) {
        continue;
      }

      // Gather chunk citations from matched notes
      const chunkCitations = Array.from(
        new Set(matchedNotes.flatMap((note) => note.chunkCitations)),
      );

      // Calculate rank score as average of source scores
      const rankScore = Number(
        (
          matchedNotes.reduce((sum, note) => {
            const source = selectedSources.find((s) => s.sourceId === note.sourceId);
            return sum + (source?.rankScore || 0);
          }, 0) / matchedNotes.length
        ).toFixed(4),
      );

      // Determine coverage and confidence
      const coverage = coverageFromNoteCount(matchedNotes.length);
      const confidence = scoreToConfidence(rankScore);
      const concern = inferConcern(matchedNotes) || defaultConcern;

      evidencePacks.push({
        id: `evidence_pack_${normalizeBuilderProfileName(`${technology}-${topic}`)}`,
        topic,
        concern,
        technology,
        summary: summarizeSnippet(
          matchedNotes.map((note) => note.summary || note.whatChanged).join(' '),
          260,
        ),
        confidence,
        coverage,
        sourceIds: Array.from(new Set(matchedNotes.map((note) => note.sourceId))),
        sourceNoteIds: matchedNotes.map((note) => note.id),
        chunkCitations,
        rankScore,
      });
    }
  }

  return evidencePacks;
}

/**
 * Build entity-level evidence packs (technology + specific concern).
 * This provides more granular evidence than topic-based packs.
 */
export function buildEntityEvidencePacks(
  sourceNotes: SourceNote[],
  selectedSources: RankedSource[],
  chunkStore: ResearchChunk[],
): EvidencePack[] {
  const entityPacks: EvidencePack[] = [];
  const technologies = Array.from(new Set(sourceNotes.map((note) => note.technology)));

  for (const technology of technologies) {
    const notesForTechnology = sourceNotes.filter((note) => note.technology === technology);
    const chunksForTechnology = chunkStore.filter(
      (chunk) => chunk.technology.toLowerCase() === technology.toLowerCase(),
    );

    for (const { concern, matcher } of CONCERN_MATCHERS) {
      // Find notes that match this concern
      const matchedNotes = notesForTechnology.filter((note) =>
        matcher.test(`${note.summary} ${note.whatChanged}`),
      );

      // Also check chunks directly for concern-specific content
      const concernChunks = chunksForTechnology.filter((chunk) =>
        matcher.test(chunk.content),
      );

      if (matchedNotes.length === 0 && concernChunks.length === 0) {
        continue;
      }

      const chunkCitations = Array.from(
        new Set([
          ...matchedNotes.flatMap((note) => note.chunkCitations),
          ...concernChunks.map((chunk) => chunk.id),
        ]),
      );

      const rankScore = matchedNotes.length > 0
        ? Number(
            (
              matchedNotes.reduce((sum, note) => {
                const source = selectedSources.find((s) => s.sourceId === note.sourceId);
                return sum + (source?.rankScore || 0);
              }, 0) / matchedNotes.length
            ).toFixed(4),
          )
        : concernChunks.length > 0
          ? Number(
              (concernChunks.reduce((sum, c) => sum + c.rankScore, 0) / concernChunks.length).toFixed(4),
            )
          : 0.5;

      const coverage = coverageFromNoteCount(matchedNotes.length + Math.min(concernChunks.length, 2));
      const confidence = scoreToConfidence(rankScore);

      // Map concern to topic for ID generation
      const topic: EvidencePackTopic =
        concern === 'gotchas' ? 'integration_gotchas' :
        concern === 'migration' || concern === 'deprecation' ? 'breaking_changes' :
        concern === 'performance' ? 'deployment_concerns' :
        concern === 'security' ? 'integration_gotchas' :
        'setup_configuration';

      entityPacks.push({
        id: `entity_pack_${normalizeBuilderProfileName(`${technology}-${concern}`)}`,
        topic,
        concern,
        technology,
        summary: summarizeSnippet(
          [
            ...matchedNotes.map((note) => note.summary || note.whatChanged),
            ...concernChunks.slice(0, 2).map((chunk) => chunk.content.slice(0, 100)),
          ].join(' '),
          260,
        ),
        confidence,
        coverage,
        sourceIds: Array.from(new Set(matchedNotes.map((note) => note.sourceId))),
        sourceNoteIds: matchedNotes.map((note) => note.id),
        chunkCitations,
        rankScore,
      });
    }
  }

  return entityPacks;
}

// ─────────────────────────────────────────────────────────────────
// Combined Builder
// ─────────────────────────────────────────────────────────────────

/**
 * Build source notes and evidence packs from context.
 */
export function buildSourceNotesAndEvidencePacks(
  context: EvidenceBuildContext,
): EvidenceBuildResult {
  const { selectedSources, chunkStore, maxChunksPerNote } = context;

  // Build source notes
  const sourceNotes = buildSourceNotes(
    selectedSources,
    chunkStore,
    maxChunksPerNote ?? MAX_CHUNKS_PER_NOTE,
  );

  // Build topic-based evidence packs
  const topicPacks = buildEvidencePacks(sourceNotes, selectedSources, chunkStore);

  // Build entity-level evidence packs
  const entityPacks = buildEntityEvidencePacks(sourceNotes, selectedSources, chunkStore);

  // Merge and deduplicate evidence packs
  const allPacks = [...topicPacks];
  const existingIds = new Set(allPacks.map((p) => p.id));

  for (const pack of entityPacks) {
    // Only add entity packs that provide new coverage
    if (!existingIds.has(pack.id)) {
      allPacks.push(pack);
      existingIds.add(pack.id);
    }
  }

  // Sort by rank score descending
  const evidencePacks = allPacks.sort((a, b) => b.rankScore - a.rankScore);

  // Build coverage summary
  const coverageSummary: CoverageSummary = {
    totalNotes: sourceNotes.length,
    totalPacks: evidencePacks.length,
    strongPacks: evidencePacks.filter((p) => p.coverage === 'strong').length,
    thinPacks: evidencePacks.filter((p) => p.coverage === 'thin').length,
    degradedPacks: evidencePacks.filter((p) => p.coverage === 'degraded').length,
    technologiesCovered: Array.from(new Set(evidencePacks.map((p) => p.technology))),
    topicsCovered: Array.from(new Set(evidencePacks.map((p) => p.topic))),
  };

  return { sourceNotes, evidencePacks, coverageSummary };
}

// ─────────────────────────────────────────────────────────────────
// Evidence Pack Selection
// ─────────────────────────────────────────────────────────────────

/**
 * Select evidence packs relevant to a query.
 */
export function selectRelevantPacks(
  packs: EvidencePack[],
  query: string,
  maxPacks: number = 6,
): EvidencePack[] {
  const queryLower = query.toLowerCase();
  const queryTerms = new Set(
    queryLower.split(/\s+/).filter((term) => term.length >= 3),
  );

  return packs
    .map((pack) => {
      const packText = `${pack.technology} ${pack.topic} ${pack.summary}`.toLowerCase();
      let score = pack.rankScore;

      // Boost for query term matches
      for (const term of queryTerms) {
        if (packText.includes(term)) {
          score += 0.1;
        }
      }

      // Boost for coverage
      if (pack.coverage === 'strong') score += 0.15;
      else if (pack.coverage === 'thin') score += 0.05;

      return { pack, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPacks)
    .map(({ pack }) => pack);
}

// ─────────────────────────────────────────────────────────────────
// Legacy Adapter
// ─────────────────────────────────────────────────────────────────

export type LegacySourceNote = {
  id: string;
  source_id: string;
  technology: string;
  source_type: string;
  summary: string;
  what_changed: string;
  confidence: ConfidenceLevel;
  chunk_citations: string[];
};

export type LegacyEvidencePack = {
  id: string;
  topic: EvidencePackTopic;
  technology: string;
  summary: string;
  confidence: ConfidenceLevel;
  coverage: CoverageStatus;
  source_ids: string[];
  source_note_ids: string[];
  chunk_citations: string[];
  rank_score: number;
};

export function toLegacySourceNote(note: SourceNote): LegacySourceNote {
  return {
    id: note.id,
    source_id: note.sourceId,
    technology: note.technology,
    source_type: note.sourceType,
    summary: note.summary,
    what_changed: note.whatChanged,
    confidence: note.confidence,
    chunk_citations: note.chunkCitations,
  };
}

export function toLegacyEvidencePack(pack: EvidencePack): LegacyEvidencePack {
  return {
    id: pack.id,
    topic: pack.topic,
    technology: pack.technology,
    summary: pack.summary,
    confidence: pack.confidence,
    coverage: pack.coverage,
    source_ids: pack.sourceIds,
    source_note_ids: pack.sourceNoteIds,
    chunk_citations: pack.chunkCitations,
    rank_score: pack.rankScore,
  };
}
