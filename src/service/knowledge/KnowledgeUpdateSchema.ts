import { z } from 'zod';
import { RECIPE_RETRIEVAL_PROFILE_SCHEMA_VERSION } from './RecipeRetrieval.js';

// 编辑入口只拦 wire 结构错误和不支持的 schema：空值、未接地、重复或 source hash 失配仍是
// pending/staging 可修复的 readiness 问题。passthrough 保留未来扩展字段，null 保持旧 Recipe 的
// compatibility 语义；校验结果不替换原始对象，避免 Markdown/SQLite wire 被 Zod 清洗而丢字段。
const RECIPE_RETRIEVAL_CONCEPT_UPDATE_SCHEMA = z
  .object({
    term: z.string(),
    language: z.string(),
    provenanceRefs: z.array(z.string()),
  })
  .passthrough();
const RECIPE_RETRIEVAL_TEXT_FACT_UPDATE_SCHEMA = z
  .object({
    text: z.string(),
    language: z.string(),
    provenanceRefs: z.array(z.string()),
  })
  .passthrough();
export const RECIPE_RETRIEVAL_PROFILE_UPDATE_SCHEMA = z
  .object({
    schemaVersion: z.literal(RECIPE_RETRIEVAL_PROFILE_SCHEMA_VERSION),
    primaryLanguage: z.string(),
    summary: z
      .object({
        primary: z.string(),
        technicalEnglish: z.string(),
      })
      .passthrough(),
    concepts: z.array(RECIPE_RETRIEVAL_CONCEPT_UPDATE_SCHEMA),
    scenarios: z.array(RECIPE_RETRIEVAL_TEXT_FACT_UPDATE_SCHEMA),
    exclusions: z.array(RECIPE_RETRIEVAL_TEXT_FACT_UPDATE_SCHEMA),
    provenance: z
      .object({
        evidenceRefs: z.array(z.string()),
        sourceFieldRefs: z.array(z.string()),
        sourceContentHash: z.string(),
        generator: z.string(),
      })
      .passthrough(),
  })
  .passthrough()
  .nullable();
