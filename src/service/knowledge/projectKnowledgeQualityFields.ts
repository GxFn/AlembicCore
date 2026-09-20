import type { KnowledgeEntry } from '../../domain/knowledge/KnowledgeEntry.js';

/**
 * 路由与质量重算共享的纯字段投影；只保留既有空值语义，不负责评分或准入。
 * engagement、深度接地和 doClause 用法回退仍由持久化后的质量重算追加。
 */
export function projectKnowledgeQualityFields(entry: KnowledgeEntry) {
  const content =
    entry.content && typeof entry.content === 'object'
      ? (entry.content as unknown as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const reasoning =
    entry.reasoning && typeof entry.reasoning === 'object'
      ? (entry.reasoning as unknown as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  return {
    title: entry.title,
    trigger: entry.trigger,
    description: entry.description || '',
    language: entry.language,
    category: entry.category,
    doClause: entry.doClause || '',
    dontClause: entry.dontClause || '',
    whenClause: entry.whenClause || '',
    coreCode: entry.coreCode || '',
    usageGuide: entry.usageGuide || (content.markdown as string) || '',
    contentMarkdown: (content.markdown as string) || '',
    contentRationale: (content.rationale as string) || '',
    reasoningWhyStandard: (reasoning.whyStandard as string) || '',
    reasoningSources: (reasoning.sources as string[]) || [],
    reasoningConfidence: (reasoning.confidence as number) || 0,
    source: entry.source || '',
    headers: entry.headers || [],
    tags: entry.tags || [],
  };
}
