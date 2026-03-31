/**
 * Research Chunks Module (Phase 19 - T2)
 * 
 * Provides stable chunking with traceable IDs for research documents.
 * Chunks have deterministic IDs based on source URL and offset, enabling
 * future cross-run caching and deduplication.
 */

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type ChunkConfig = {
  chunkSize: number;
  overlap: number;
  separators: string[];
};

export type ResearchChunk = {
  id: string;
  sourceId: string;
  content: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceType: string;
  tool: string;
  technology: string;
  rankScore: number;
  startOffset: number;
  endOffset: number;
  contentHash: string;
};

export type ChunkSource = {
  id: string;
  url: string;
  title: string;
  sourceType: string;
  tool: string;
  technology: string;
  rankScore: number;
  content: string;
};

export type ChunkStoreResult = {
  chunks: ResearchChunk[];
  stats: ChunkStats;
};

export type ChunkStats = {
  totalSources: number;
  totalChunks: number;
  totalCharacters: number;
  averageChunkSize: number;
  duplicatesRemoved: number;
};

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

export const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
  chunkSize: 1600,
  overlap: 200,
  separators: ['\n\n', '\n', '. ', ' '],
};

export const CHUNK_WARN_THRESHOLD = 10000;

// ─────────────────────────────────────────────────────────────────
// Chunk ID Generation (uses simple hash for Cloudflare Workers compat)
// ─────────────────────────────────────────────────────────────────

/**
 * Simple hash function for chunk ID generation.
 * Uses djb2 algorithm for fast, deterministic hashing without crypto deps.
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 12);
}

/**
 * Compute a deterministic chunk ID based on source URL, offset, and technology.
 * This enables cross-run deduplication and caching.
 */
export function computeChunkId(
  sourceUrl: string,
  startOffset: number,
  endOffset: number,
  technology: string,
): string {
  const normalizedUrl = sourceUrl.trim().toLowerCase();
  const key = `${normalizedUrl}::${startOffset}::${endOffset}::${technology}`;
  const hash = simpleHash(key);
  return `chunk_${hash}`;
}

/**
 * Compute a content hash for deduplication.
 */
export function computeContentHash(content: string): string {
  return simpleHash(content);
}

/**
 * Build a human-readable chunk ID (legacy format for backward compatibility).
 */
export function buildLegacyChunkId(sourceId: string, ordinal: number): string {
  return `${sourceId}::chunk-${String(ordinal).padStart(3, '0')}`;
}

// ─────────────────────────────────────────────────────────────────
// Text Chunking
// ─────────────────────────────────────────────────────────────────

/**
 * Split text into chunks using hierarchical separators.
 * Returns raw text chunks without metadata.
 */
export function chunkText(
  text: string,
  config: ChunkConfig = DEFAULT_CHUNK_CONFIG,
): string[] {
  const { chunkSize, overlap, separators } = config;
  const normalized = text.replace(/\r\n/g, '\n').trim();

  if (!normalized) {
    return [];
  }

  const splitRecursively = (value: string, separatorIndex: number): string[] => {
    if (value.length <= chunkSize) {
      return [value];
    }

    if (separatorIndex >= separators.length) {
      // Final fallback: hard split by chunk size
      const slices: string[] = [];
      for (let index = 0; index < value.length; index += chunkSize) {
        slices.push(value.slice(index, index + chunkSize));
      }
      return slices;
    }

    const separator = separators[separatorIndex];
    const parts = value.split(separator);

    if (parts.length <= 1) {
      return splitRecursively(value, separatorIndex + 1);
    }

    const chunks: string[] = [];
    let current = '';

    for (const part of parts) {
      const nextCandidate = current ? `${current}${separator}${part}` : part;

      if (nextCandidate.length <= chunkSize) {
        current = nextCandidate;
        continue;
      }

      if (current) {
        chunks.push(current);
        current = '';
      }

      if (part.length > chunkSize) {
        chunks.push(...splitRecursively(part, separatorIndex + 1));
      } else {
        current = part;
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks;
  };

  const rawChunks = splitRecursively(normalized, 0)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  // Apply overlap from previous chunk
  const chunks: string[] = [];
  const safeOverlap = Math.max(0, overlap);

  for (let index = 0; index < rawChunks.length; index++) {
    const previousTail = index > 0 ? rawChunks[index - 1].slice(-safeOverlap) : '';
    const combined = `${previousTail}${rawChunks[index]}`.trim();
    if (combined) {
      chunks.push(combined);
    }
  }

  return chunks;
}

// ─────────────────────────────────────────────────────────────────
// Document Chunking
// ─────────────────────────────────────────────────────────────────

/**
 * Chunk a single document into ResearchChunks with full metadata.
 */
export function chunkDocument(
  source: ChunkSource,
  config: ChunkConfig = DEFAULT_CHUNK_CONFIG,
): ResearchChunk[] {
  const textChunks = chunkText(source.content, config);
  const chunks: ResearchChunk[] = [];
  let cursor = 0;

  for (let index = 0; index < textChunks.length; index++) {
    const content = textChunks[index];
    const startOffset = cursor;
    const endOffset = startOffset + content.length;

    // Advance cursor accounting for overlap
    cursor = Math.max(endOffset - config.overlap, endOffset);

    const chunk: ResearchChunk = {
      id: buildLegacyChunkId(source.id, index + 1),
      sourceId: source.id,
      content,
      sourceUrl: source.url,
      sourceTitle: source.title,
      sourceType: source.sourceType,
      tool: source.tool,
      technology: source.technology,
      rankScore: source.rankScore,
      startOffset: Math.max(0, startOffset),
      endOffset: Math.max(0, endOffset),
      contentHash: computeContentHash(content),
    };

    chunks.push(chunk);
  }

  return chunks;
}

// ─────────────────────────────────────────────────────────────────
// Chunk Store Building
// ─────────────────────────────────────────────────────────────────

/**
 * Deduplicate sources by (tool, url, technology, sourceType).
 */
export function deduplicateSources(sources: ChunkSource[]): ChunkSource[] {
  const seen = new Set<string>();

  return sources.filter((source) => {
    const key = `${source.tool}::${source.url}::${source.technology}::${source.sourceType}`.toLowerCase();
    if (!source.url || !source.content.trim() || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Deduplicate chunks by (sourceId, startOffset, endOffset, technology).
 */
export function deduplicateChunks(chunks: ResearchChunk[]): { chunks: ResearchChunk[]; duplicatesRemoved: number } {
  const seen = new Set<string>();
  const deduplicated: ResearchChunk[] = [];
  let duplicatesRemoved = 0;

  for (const chunk of chunks) {
    const key = `${chunk.sourceId}::${chunk.startOffset}::${chunk.endOffset}::${chunk.technology}`.toLowerCase();
    if (!chunk.content.trim() || seen.has(key)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(key);
    deduplicated.push(chunk);
  }

  return { chunks: deduplicated, duplicatesRemoved };
}

/**
 * Build a complete chunk store from multiple sources.
 */
export function buildChunkStore(
  sources: ChunkSource[],
  config: ChunkConfig = DEFAULT_CHUNK_CONFIG,
): ChunkStoreResult {
  const uniqueSources = deduplicateSources(sources);
  const allChunks: ResearchChunk[] = [];

  for (const source of uniqueSources) {
    const chunks = chunkDocument(source, config);
    allChunks.push(...chunks);
  }

  const { chunks, duplicatesRemoved } = deduplicateChunks(allChunks);
  const totalCharacters = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);

  const stats: ChunkStats = {
    totalSources: uniqueSources.length,
    totalChunks: chunks.length,
    totalCharacters,
    averageChunkSize: chunks.length > 0 ? Math.round(totalCharacters / chunks.length) : 0,
    duplicatesRemoved,
  };

  return { chunks, stats };
}

// ─────────────────────────────────────────────────────────────────
// Chunk Selection
// ─────────────────────────────────────────────────────────────────

/**
 * Select chunks for a specific source.
 */
export function selectChunksForSource(
  chunks: ResearchChunk[],
  sourceId: string,
  maxChunks: number = 4,
): ResearchChunk[] {
  return chunks
    .filter((chunk) => chunk.sourceId === sourceId)
    .slice(0, maxChunks);
}

/**
 * Select chunks by technology.
 */
export function selectChunksByTechnology(
  chunks: ResearchChunk[],
  technology: string,
  maxChunks: number = 10,
): ResearchChunk[] {
  const normalizedTech = technology.toLowerCase();
  return chunks
    .filter((chunk) => chunk.technology.toLowerCase() === normalizedTech)
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, maxChunks);
}

// ─────────────────────────────────────────────────────────────────
// Legacy Adapter (for backward compatibility)
// ─────────────────────────────────────────────────────────────────

export type LegacyResearchChunk = {
  id: string;
  source_id: string;
  content: string;
  source: string;
  source_title: string;
  source_type: string;
  tool: string;
  technology: string;
  rank_score: number;
  start_offset: number;
  end_offset: number;
};

export function toLegacyChunk(chunk: ResearchChunk): LegacyResearchChunk {
  return {
    id: chunk.id,
    source_id: chunk.sourceId,
    content: chunk.content,
    source: chunk.sourceUrl,
    source_title: chunk.sourceTitle,
    source_type: chunk.sourceType,
    tool: chunk.tool,
    technology: chunk.technology,
    rank_score: chunk.rankScore,
    start_offset: chunk.startOffset,
    end_offset: chunk.endOffset,
  };
}

export function fromLegacyChunk(chunk: LegacyResearchChunk): ResearchChunk {
  return {
    id: chunk.id,
    sourceId: chunk.source_id,
    content: chunk.content,
    sourceUrl: chunk.source,
    sourceTitle: chunk.source_title,
    sourceType: chunk.source_type,
    tool: chunk.tool,
    technology: chunk.technology,
    rankScore: chunk.rank_score,
    startOffset: chunk.start_offset,
    endOffset: chunk.end_offset,
    contentHash: computeContentHash(chunk.content),
  };
}
