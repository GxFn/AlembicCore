import { knowledgeEntries } from '../../infrastructure/database/drizzle/schema.js';

/** 全量和增量索引必须读取同一组事实；Drizzle 与 raw adapter 共用此内部投影。 */
export const knowledgeSearchIndexSelection = {
  id: knowledgeEntries.id,
  title: knowledgeEntries.title,
  description: knowledgeEntries.description,
  language: knowledgeEntries.language,
  dimensionId: knowledgeEntries.dimensionId,
  scope: knowledgeEntries.scope,
  category: knowledgeEntries.category,
  knowledgeType: knowledgeEntries.knowledgeType,
  kind: knowledgeEntries.kind,
  content: knowledgeEntries.content,
  lifecycle: knowledgeEntries.lifecycle,
  tags: knowledgeEntries.tags,
  trigger: knowledgeEntries.trigger,
  topicHint: knowledgeEntries.topicHint,
  whenClause: knowledgeEntries.whenClause,
  doClause: knowledgeEntries.doClause,
  dontClause: knowledgeEntries.dontClause,
  coreCode: knowledgeEntries.coreCode,
  usageGuide: knowledgeEntries.usageGuide,
  moduleName: knowledgeEntries.moduleName,
  reasoning: knowledgeEntries.reasoning,
  retrievalProfile: knowledgeEntries.retrievalProfile,
  difficulty: knowledgeEntries.difficulty,
  quality: knowledgeEntries.quality,
  stats: knowledgeEntries.stats,
  updatedAt: knowledgeEntries.updatedAt,
  createdAt: knowledgeEntries.createdAt,
};

type IndexColumn = keyof typeof knowledgeSearchIndexSelection;

// 只为已发布的旧 schema 兼容字段提供默认值；缺失必需列仍由查询报错，不能伪造完整读取。
const LEGACY_DEFAULTS: Partial<Record<IndexColumn, string>> = {
  dimensionId: "''",
  scope: "''",
  topicHint: "''",
  whenClause: "''",
  doClause: "''",
  dontClause: "''",
  coreCode: "''",
  usageGuide: "''",
  moduleName: "''",
  reasoning: "'{}'",
  retrievalProfile: 'NULL',
};

export function rawKnowledgeSearchColumn(
  name: IndexColumn,
  available: ReadonlySet<string>
): string {
  const column = knowledgeSearchIndexSelection[name].name;
  const fallback = LEGACY_DEFAULTS[name];
  return fallback !== undefined && !available.has(column) ? `${fallback} AS ${name}` : column;
}

export function rawKnowledgeIndexProjection(available: ReadonlySet<string>): string {
  return (Object.keys(knowledgeSearchIndexSelection) as IndexColumn[])
    .map((name) => rawKnowledgeSearchColumn(name, available))
    .join(', ');
}
