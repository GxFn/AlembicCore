/**
 * FieldWeightedScorer — 加权字段匹配评分器
 *
 * 结构化知识库的默认搜索评分引擎。
 *
 * 设计动机:
 * - 旧全文统计评分把所有字段拼接为文本，tokenize 去重后会削弱结构化字段权重
 * - 对于 ~50–500 条结构化知识条目，大规模语料假设不成立
 * - FieldWeightedScorer 对每个字段独立打分并加权合并，精确匹配 > token 重叠 > IDF 加权
 *
 * 字段权重:
 *   trigger (5.0) > title (3.0) > tags (2.0) > description (1.5) > content (1.0) > facets (0.5)
 *
 * @module FieldWeightedScorer
 */

import type { Scorer, ScorerResult } from './SearchTypes.js';
import { tokenize } from './tokenizer.js';

// ── 字段权重常量（可调） ──
const TRIGGER_WEIGHT = 5.0;
const TITLE_WEIGHT = 3.0;
const TAG_WEIGHT = 2.0;
const DESCRIPTION_WEIGHT = 1.5;
const CONTENT_WEIGHT = 1.0;
const FACET_WEIGHT = 0.5;

/** 字段加权文档内部表示 */
interface FieldWeightedDocument {
  id: string;
  fields: {
    trigger: string;
    title: string;
    description: string;
    tags: string[];
    language: string;
    category: string;
    knowledgeType: string;
    kind: string;
  };
  tokenizedFields: {
    trigger: string[];
    title: string[];
    description: string[];
    content: string[];
    retrievalIntent: string[];
    retrievalBoundary: string[];
    retrievalSupport: string[];
    kind: Set<string>;
    topics: Set<string>;
    allUnique: Set<string>;
  };
  meta: Record<string, unknown>;
}

/**
 * FieldWeightedScorer — 加权字段匹配评分器
 *
 * 实现 Scorer 接口，可作为 SearchEngine 默认 scorer。
 */
export class FieldWeightedScorer implements Scorer {
  avgLength: number;
  docFreq: Record<string, number>;
  topicDocFreq: Record<string, number>;
  documents: (FieldWeightedDocument | null)[];
  totalDocs: number;
  _idIndex: Map<string, number>;
  _totalLength: number;

  constructor() {
    this.documents = [];
    this.totalDocs = 0;
    this.docFreq = {};
    this.topicDocFreq = {};
    this._idIndex = new Map();
    this._totalLength = 0;
    this.avgLength = 0;
  }

  /** 添加文档到索引 */
  addDocument(id: string, text: string, meta: Record<string, unknown> = {}) {
    if (this._idIndex.has(id)) {
      this.removeDocument(id);
    }

    // 从 meta 提取结构化字段
    const trigger = (meta.trigger as string) || '';
    const title = (meta.title as string) || '';
    const description = (meta.description as string) || '';
    const tags = Array.isArray(meta.tags) ? (meta.tags as string[]) : [];
    const language = (meta.language as string) || '';
    const category = (meta.category as string) || '';
    const knowledgeType = (meta.knowledgeType as string) || '';
    const kind = (meta.kind as string) || '';
    const contentText = (meta.contentText as string) || '';
    const retrievalIntentText = (meta.retrievalIntentText as string) || '';
    const retrievalBoundaryText = (meta.retrievalBoundaryText as string) || '';
    const retrievalSupportText = (meta.retrievalSupportText as string) || '';

    // 独立分词每个字段
    const triggerTokens = tokenize(trigger);
    const titleTokens = tokenize(title);
    const descTokens = tokenize(description);
    // contentText 优先；若 meta 无 contentText 则用拼接文本 text 作为回退
    const contentTokens = tokenize(contentText || text);
    const retrievalIntentTokens = tokenize(retrievalIntentText);
    const retrievalBoundaryTokens = tokenize(retrievalBoundaryText);
    const retrievalSupportTokens = tokenize(retrievalSupportText);
    const kindTokens = new Set(tokenize(kind).map(normalizeTopicToken));
    const topicTokens = new Set(
      tokenize([...tags, knowledgeType, kind].filter(Boolean).join(' ')).map(normalizeTopicToken)
    );

    // 合并所有唯一 token 用于 DF 计算
    const allUnique = new Set<string>();
    for (const t of triggerTokens) {
      allUnique.add(t);
    }
    for (const t of titleTokens) {
      allUnique.add(t);
    }
    for (const t of descTokens) {
      allUnique.add(t);
    }
    for (const t of contentTokens) {
      allUnique.add(t);
    }
    for (const tag of tags) {
      for (const t of tokenize(tag)) {
        allUnique.add(t);
      }
    }

    const doc: FieldWeightedDocument = {
      id,
      fields: { trigger, title, description, tags, language, category, knowledgeType, kind },
      tokenizedFields: {
        trigger: triggerTokens,
        title: titleTokens,
        description: descTokens,
        content: contentTokens,
        retrievalIntent: retrievalIntentTokens,
        retrievalBoundary: retrievalBoundaryTokens,
        retrievalSupport: retrievalSupportTokens,
        kind: kindTokens,
        topics: topicTokens,
        allUnique,
      },
      meta,
    };

    const idx = this.documents.length;
    this.documents.push(doc);
    this._idIndex.set(id, idx);

    for (const token of allUnique) {
      this.docFreq[token] = (this.docFreq[token] || 0) + 1;
    }
    for (const token of topicTokens) {
      this.topicDocFreq[token] = (this.topicDocFreq[token] || 0) + 1;
    }

    this.totalDocs = this._idIndex.size;
    this._totalLength += allUnique.size;
    this.avgLength = this.totalDocs > 0 ? this._totalLength / this.totalDocs : 0;
  }

  /**
   * 移除文档（tombstone + 懒压缩）
   * @returns 是否成功移除
   */
  removeDocument(id: string): boolean {
    const idx = this._idIndex.get(id);
    if (idx === undefined) {
      return false;
    }

    const doc = this.documents[idx];
    if (!doc) {
      return false;
    }

    for (const token of doc.tokenizedFields.allUnique) {
      if (this.docFreq[token]) {
        this.docFreq[token]--;
        if (this.docFreq[token] <= 0) {
          delete this.docFreq[token];
        }
      }
    }
    for (const token of doc.tokenizedFields.topics) {
      if (this.topicDocFreq[token]) {
        this.topicDocFreq[token]--;
        if (this.topicDocFreq[token] <= 0) {
          delete this.topicDocFreq[token];
        }
      }
    }

    this._totalLength -= doc.tokenizedFields.allUnique.size;
    this.documents[idx] = null;
    this._idIndex.delete(id);
    this.totalDocs = this._idIndex.size;
    this.avgLength = this.totalDocs > 0 ? this._totalLength / this.totalDocs : 0;

    const nullCount = this.documents.length - this.totalDocs;
    if (this.documents.length > 100 && nullCount / this.documents.length > 0.3) {
      this._compact();
    }

    return true;
  }

  /** 更新文档（remove + add） */
  updateDocument(id: string, text: string, meta: Record<string, unknown> = {}) {
    this.removeDocument(id);
    this.addDocument(id, text, meta);
  }

  /** 检查文档是否存在 */
  hasDocument(id: string) {
    return this._idIndex.has(id);
  }

  /** 清空索引 */
  clear() {
    this.documents = [];
    this.docFreq = {};
    this.topicDocFreq = {};
    this.totalDocs = 0;
    this._totalLength = 0;
    this.avgLength = 0;
    this._idIndex.clear();
  }

  /** 压缩 documents 数组，清除 tombstone 空洞 */
  _compact() {
    const alive = this.documents.filter((d): d is FieldWeightedDocument => d !== null);
    this.documents = alive;
    this._idIndex.clear();
    for (let i = 0; i < alive.length; i++) {
      this._idIndex.set(alive[i].id, i);
    }
  }

  /** 搜索：对每个文档按字段加权评分，返回降序结果 */
  search(query: string, limit = 20): ScorerResult[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }

    const scores: ScorerResult[] = [];
    const queryTopicTokens = [...new Set(queryTokens.map(normalizeTopicToken))];

    for (const doc of this.documents) {
      if (!doc) {
        continue;
      }

      let totalScore = 0;

      // 1. Trigger 评分 — 最高权重，精确标识
      const triggerString = this._stringMatchScore(query, doc.fields.trigger);
      const triggerToken = this._tokenOverlap(queryTokens, doc.tokenizedFields.trigger);
      totalScore += TRIGGER_WEIGHT * Math.max(triggerString, triggerToken);

      // 2. Title 评分 — 主要描述性字段
      const titleString = this._stringMatchScore(query, doc.fields.title);
      const titleToken = this._tokenOverlap(queryTokens, doc.tokenizedFields.title);
      totalScore += TITLE_WEIGHT * Math.max(titleString, titleToken);

      // 3. Tags 评分 — 分类标记
      totalScore += TAG_WEIGHT * this._tagScore(queryTokens, doc.fields.tags);
      totalScore +=
        TAG_WEIGHT *
        this._semanticTopicCoverage(
          queryTopicTokens,
          doc.tokenizedFields.topics,
          doc.tokenizedFields.kind
        );

      // 4. Description 评分 — IDF 加权 token overlap
      totalScore +=
        DESCRIPTION_WEIGHT * this._idfWeightedOverlap(queryTokens, doc.tokenizedFields.description);

      // 5. Content 评分 — IDF 加权 token overlap
      totalScore +=
        CONTENT_WEIGHT * this._idfWeightedOverlap(queryTokens, doc.tokenizedFields.content);

      // 6. Canonical Recipe roles — only corroborated facts receive trigger-level priority.
      // A token must occur in at least two projected roles, so a shallow title/directive word
      // cannot multiply its score merely by being repeated inside one flattened document.
      totalScore +=
        TRIGGER_WEIGHT *
        this._corroboratedRoleOverlap(
          queryTokens,
          doc.tokenizedFields.retrievalIntent,
          doc.tokenizedFields.retrievalBoundary,
          doc.tokenizedFields.retrievalSupport
        );

      // 7. Facet 评分 — language/category/knowledgeType 精确匹配
      totalScore += FACET_WEIGHT * this._facetScore(queryTokens, doc.fields);

      if (totalScore > 0) {
        scores.push({ id: doc.id, score: totalScore, meta: doc.meta });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, limit);
  }

  // ── 内部评分方法 ──

  /** 字符串级别匹配评分（用于 trigger / title） */
  _stringMatchScore(query: string, field: string): number {
    if (!field) {
      return 0;
    }
    const q = query.toLowerCase();
    const f = field.toLowerCase();

    if (f === q) {
      return 1.0;
    }
    if (f.startsWith(q)) {
      return 0.7;
    }
    if (f.includes(q)) {
      return 0.5;
    }
    if (q.includes(f) && f.length > 3) {
      return 0.3;
    }
    return 0;
  }

  /** Token 集合重叠率（查询侧召回） */
  _tokenOverlap(queryTokens: string[], fieldTokens: string[]): number {
    if (queryTokens.length === 0) {
      return 0;
    }
    const fieldSet = new Set(fieldTokens);
    let matched = 0;
    for (const qt of queryTokens) {
      if (fieldSet.has(qt)) {
        matched++;
      }
    }
    return matched / queryTokens.length;
  }

  /** IDF 加权 token overlap（用于长文本字段） */
  _idfWeightedOverlap(queryTokens: string[], fieldTokens: string[]): number {
    if (queryTokens.length === 0) {
      return 0;
    }
    const fieldSet = new Set(fieldTokens);
    let matchedIdf = 0;
    let totalIdf = 0;

    for (const qt of queryTokens) {
      const idf = this._idf(qt);
      totalIdf += idf;
      if (fieldSet.has(qt)) {
        matchedIdf += idf;
      }
    }
    return totalIdf > 0 ? matchedIdf / totalIdf : 0;
  }

  _corroboratedRoleOverlap(
    queryTokens: string[],
    intentTokens: string[],
    boundaryTokens: string[],
    supportTokens: string[]
  ): number {
    if (queryTokens.length === 0) {
      return 0;
    }
    const query = new Set(queryTokens.map(normalizeTopicToken));
    const roles = [intentTokens, boundaryTokens, supportTokens].map(
      (tokens) => new Set(tokens.map(normalizeTopicToken))
    );
    let matched = 0;
    for (const token of query) {
      if (roles.filter((role) => role.has(token)).length >= 2) {
        matched++;
      }
    }
    return query.size > 0 ? matched / query.size : 0;
  }

  /** Tag 匹配评分 */
  _tagScore(queryTokens: string[], tags: string[]): number {
    if (tags.length === 0 || queryTokens.length === 0) {
      return 0;
    }
    let score = 0;
    let exactTopicSpecificity = 0;
    const qtSet = new Set(queryTokens);
    const maxIdf = Math.log2(1 + this.totalDocs);

    for (const tag of tags) {
      const lowTag = tag.toLowerCase();
      // 精确 token 匹配
      if (qtSet.has(lowTag)) {
        score += 1.0;
        // Tags are curated topic metadata. Preserve the existing overlap score,
        // then restore exact, corpus-discriminative topic evidence that would
        // otherwise disappear as a natural-language query grows longer.
        exactTopicSpecificity = Math.max(
          exactTopicSpecificity,
          maxIdf > 0 ? this._idf(lowTag) / maxIdf : 0
        );
        continue;
      }
      // 部分匹配：query token 包含 tag 或 tag 包含 query token
      let partialFound = false;
      for (const qt of queryTokens) {
        if (lowTag.includes(qt) || qt.includes(lowTag)) {
          score += 0.5;
          partialFound = true;
          break;
        }
      }
      if (!partialFound) {
        // 对 tag 分词再匹配
        const tagTokens = tokenize(tag);
        for (const tt of tagTokens) {
          if (qtSet.has(tt)) {
            score += 0.3;
            break;
          }
        }
      }
    }
    return Math.min(score / queryTokens.length, 1.0) + exactTopicSpecificity;
  }

  /**
   * Query-explicit Recipe kind plus one additional semantic metadata match.
   * This separates project-knowledge intent from incidental title/language hits.
   * English plural folding is deliberately confined to metadata comparison;
   * the shared full-text tokenizer and its sparse evidence remain unchanged.
   */
  _semanticTopicCoverage(
    queryTopics: string[],
    documentTopics: Set<string>,
    documentKind: Set<string>
  ): number {
    const usableTopics = queryTopics.filter((token) => (this.topicDocFreq[token] || 0) > 0);
    if (!usableTopics.some((token) => documentKind.has(token))) {
      return 0;
    }
    const matchedTopics = usableTopics.filter((token) => documentTopics.has(token));
    if (matchedTopics.length < 2) {
      return 0;
    }
    const totalIdf = usableTopics.reduce((sum, token) => sum + this._topicIdf(token), 0);
    if (totalIdf <= 0) {
      return 0;
    }
    const matchedIdf = matchedTopics.reduce((sum, token) => sum + this._topicIdf(token), 0);
    return matchedIdf / totalIdf;
  }

  /** Facet 匹配评分（language / category / knowledgeType） */
  _facetScore(queryTokens: string[], fields: FieldWeightedDocument['fields']): number {
    const facets = [fields.language, fields.category, fields.knowledgeType].filter(Boolean);
    if (facets.length === 0) {
      return 0;
    }

    let matched = 0;
    const qtSet = new Set(queryTokens);
    for (const facet of facets) {
      const lower = facet.toLowerCase();
      if (qtSet.has(lower)) {
        matched++;
        continue;
      }
      for (const ft of tokenize(facet)) {
        if (qtSet.has(ft)) {
          matched++;
          break;
        }
      }
    }
    return matched / facets.length;
  }

  /** 计算 IDF（平滑，始终为正） */
  _idf(token: string): number {
    const df = this.docFreq[token] || 0;
    return Math.log2(1 + this.totalDocs / (df + 1));
  }

  _topicIdf(token: string): number {
    const df = this.topicDocFreq[token] || 0;
    return Math.log2(1 + this.totalDocs / (df + 1));
  }
}

function normalizeTopicToken(token: string): string {
  if (token.endsWith('ies') && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}
