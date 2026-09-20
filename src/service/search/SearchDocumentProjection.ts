import type { RecipeRetrievalProfile } from '../../domain/knowledge/RecipeRetrievalProfile.js';
import {
  projectRecipeRetrievalDocumentSet,
  projectRecipeRetrievalSparseProjection,
} from '../knowledge/RecipeRetrieval.js';
import type { DbRow } from './SearchTypes.js';

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value !== 'string' || !value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * DB 行 → scorer 文档的单一纯投影。文本和 metadata 消费同一份 canonical roles，
 * 避免 full/refresh 每条知识各构造两次 document set。保留旧 JSON/空值兼容与计分事实。
 */
export function projectSearchDocument(r: DbRow) {
  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(r.tags || '[]');
  } catch {
    /* ignore */
  }
  let usageCount = 0;
  let authorityScore = 0;
  try {
    const stats = JSON.parse(r.stats || '{}');
    usageCount = (stats.adoptions || 0) + (stats.applications || 0) + (stats.searchHits || 0);
    authorityScore = stats.authority || 0;
  } catch {
    /* ignore */
  }
  let qualityOverall = 0;
  try {
    qualityOverall = JSON.parse(r.quality || '{}').overall || 0;
  } catch {
    /* ignore */
  }
  const documentSet = projectRecipeRetrievalDocumentSet({
    ...r,
    content: parseJsonObject(r.content),
    reasoning: parseJsonObject(r.reasoning),
    retrievalProfile: r.retrievalProfile
      ? (parseJsonObject(r.retrievalProfile) as unknown as RecipeRetrievalProfile)
      : null,
    tags: parseJsonArray(r.tags),
  });
  const sparseProjection = projectRecipeRetrievalSparseProjection(documentSet);
  const meta = {
    type: 'knowledge',
    title: r.title,
    trigger: r.trigger || '',
    description: r.description || '',
    contentText: sparseProjection.text,
    retrievalIntentText: sparseProjection.intentText,
    retrievalBoundaryText: sparseProjection.boundaryText,
    retrievalSupportText: sparseProjection.supportText,
    status: r.lifecycle,
    knowledgeType: r.knowledgeType,
    kind: r.kind || 'pattern',
    language: r.language || '',
    dimensionId: r.dimensionId || '',
    category: r.category || '',
    scope: r.scope || '',
    updatedAt: r.updatedAt || null,
    createdAt: r.createdAt || null,
    difficulty: r.difficulty || 'intermediate',
    tags: parsedTags,
    usageCount,
    authorityScore,
    qualityScore: qualityOverall,
  };
  return { text: sparseProjection.text, meta };
}
