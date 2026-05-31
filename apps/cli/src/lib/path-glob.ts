import * as path from 'node:path';

export function normalizeWorkspacePath(input: string): string {
  return path.normalize(input).replaceAll('\\', '/').replace(/^\.?\//, '').toLowerCase();
}

export function isGlobPattern(input: string): boolean {
  return input.includes('*') || input.includes('?');
}

function globPrefix(glob: string): string {
  const normalized = normalizeWorkspacePath(glob);
  const wildcardIndex = normalized.search(/[\*\?]/);
  const prefix = wildcardIndex >= 0 ? normalized.slice(0, wildcardIndex) : normalized;
  return prefix.replace(/\/+$/, '');
}

export function globToRegex(glob: string): RegExp {
  const normalized = normalizeWorkspacePath(glob);
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*')
    .replace(/\\\?/g, '[^/]');
  return new RegExp(`^${pattern}$`);
}

export function globsOverlap(left: string, right: string): boolean {
  const leftPrefix = globPrefix(left);
  const rightPrefix = globPrefix(right);
  if (!leftPrefix || !rightPrefix) {
    return true;
  }
  return leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix);
}

export function pathMatchesAnyGlobs(filePath: string, globs: string[]): boolean {
  const normalized = normalizeWorkspacePath(filePath);
  return globs.map(globToRegex).some((regex) => regex.test(normalized));
}

export function ownershipOverlaps(
  requested: { paths: string[]; globs: string[] },
  existing: { paths: string[]; globs: string[] },
): boolean {
  const requestedPaths = requested.paths.map(normalizeWorkspacePath);
  const existingPaths = existing.paths.map(normalizeWorkspacePath);
  const requestedRegexes = requested.globs.map(globToRegex);
  const existingRegexes = existing.globs.map(globToRegex);

  if (requestedPaths.some((candidate) => existingPaths.includes(candidate))) {
    return true;
  }
  if (requestedPaths.some((candidate) => existingRegexes.some((regex) => regex.test(candidate)))) {
    return true;
  }
  if (existingPaths.some((candidate) => requestedRegexes.some((regex) => regex.test(candidate)))) {
    return true;
  }
  return requested.globs.some((requestedGlob) =>
    existing.globs.some((existingGlob) => globsOverlap(requestedGlob, existingGlob)),
  );
}

