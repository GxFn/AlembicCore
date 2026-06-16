const SCALAR_FILTER_KEYS = [
  'type',
  'category',
  'language',
  'module',
  'regionClass',
  'recipeId',
  'dimensionId',
  'knowledgeType',
  'kind',
  'sourceRefsBridge',
] as const;

function valueMatchesFilter(metadataValue: unknown, filterValue: unknown): boolean {
  if (filterValue === undefined || filterValue === null) {
    return true;
  }
  if (Array.isArray(filterValue)) {
    if (Array.isArray(metadataValue)) {
      return filterValue.some((value) => metadataValue.includes(value));
    }
    return filterValue.includes(metadataValue);
  }
  if (Array.isArray(metadataValue)) {
    return metadataValue.includes(filterValue);
  }
  return metadataValue === filterValue;
}

/**
 * Shared VectorStore metadata gate.
 *
 * Vector adapters must agree on region metadata filtering because APQ3 stores
 * generated Recipe semantic-region chunks next to legacy whole-entry vectors.
 */
export function matchesVectorMetadataFilter(
  metadata: Record<string, unknown> | undefined,
  filter: Record<string, unknown>
): boolean {
  const meta = metadata || {};

  for (const key of SCALAR_FILTER_KEYS) {
    if (!valueMatchesFilter(meta[key], filter[key])) {
      return false;
    }
  }

  if (
    filter.sourcePath &&
    !(meta.sourcePath as string | undefined)?.includes(filter.sourcePath as string)
  ) {
    return false;
  }

  if (filter.tags && Array.isArray(filter.tags)) {
    const itemTags = meta.tags || [];
    if (!Array.isArray(itemTags)) {
      return false;
    }
    if (!(filter.tags as unknown[]).some((tag) => itemTags.includes(tag))) {
      return false;
    }
  }

  if (filter.deprecated === false && meta.deprecated) {
    return false;
  }

  return true;
}
