/**
 * Recipe retrieval profile 的 domain 名称。
 *
 * 具体 wire 形状由 KnowledgeWire 统一拥有，避免 Domain/API 两份类型漂移；
 * profile 随 Recipe Markdown 与 SQLite 一起持久化，不建立第二知识库。
 */
export type {
  RecipeRetrievalFactWire as RecipeRetrievalFact,
  RecipeRetrievalProfileWire as RecipeRetrievalProfile,
} from '../../types/KnowledgeWire.js';

import type { RecipeRetrievalProfileWire } from '../../types/KnowledgeWire.js';

export type RecipeRetrievalSummary = RecipeRetrievalProfileWire['summary'];
export type RecipeRetrievalProvenance = RecipeRetrievalProfileWire['provenance'];
