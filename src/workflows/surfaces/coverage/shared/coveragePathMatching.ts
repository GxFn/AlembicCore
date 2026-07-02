export interface CoveragePathRef {
  path: string;
  relativePath?: string;
  qualifiedPath?: string;
}

export function comparablePaths(ref: CoveragePathRef): string[] {
  return sortUnique([ref.path, ref.relativePath, ref.qualifiedPath].filter(isNonEmptyString));
}

export function refsOverlap(left: CoveragePathRef, right: CoveragePathRef): boolean {
  return comparablePaths(left).some((leftPath) =>
    comparablePaths(right).some((rightPath) => pathsOverlap(leftPath, rightPath))
  );
}

export function pathsOverlap(left: string, right: string): boolean {
  const leftPath = normalizePathSegment(left);
  const rightPath = normalizePathSegment(right);
  if (!leftPath || !rightPath) {
    return false;
  }
  return (
    leftPath === rightPath ||
    pathContains(leftPath, rightPath) ||
    pathContains(rightPath, leftPath) ||
    pathSuffixMatches(leftPath, rightPath)
  );
}

export function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

export function sortUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter(isNonEmptyString))].sort();
}

function normalizePathSegment(value: string): string {
  return normalizePath(value).replace(/^\/+/, '').replace(/\/+$/, '');
}

function pathContains(candidatePath: string, ownedPath: string): boolean {
  return candidatePath.startsWith(`${ownedPath}/`);
}

function pathSuffixMatches(left: string, right: string): boolean {
  return left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function isNonEmptyString(value: string | undefined): value is string {
  return Boolean(value?.trim());
}
