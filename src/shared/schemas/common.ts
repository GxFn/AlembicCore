/**
 * common.ts — 共用基础 Zod Schema
 *
 * 提供可复用的基础校验片段，被 mcp-tools.ts / http-requests.ts 等引用。
 *
 * @module shared/schemas/common
 */

import { z } from 'zod';

// ── 分页 / 列表 ──────────────────────────────────────────────

export const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(200).default(20),
  offset: z.number().int().min(0).default(0),
});

// ── 知识类型枚举 ──────────────────────────────────────────────

export const KindEnum = z.enum(['all', 'rule', 'pattern', 'fact']);
export const StrictKindEnum = z.enum(['rule', 'pattern', 'fact']);

export const KnowledgeTypeEnum = z.enum([
  'code-pattern',
  'architecture',
  'best-practice',
  'code-standard',
  'code-style',
  'code-relation',
  'data-flow',
  'event-and-data-flow',
  'module-dependency',
  'boundary-constraint',
  'solution',
  'anti-pattern',
]);

export const ComplexityEnum = z.enum(['beginner', 'intermediate', 'advanced']);
export const ScopeEnum = z.enum(['universal', 'project-specific', 'target-specific']);

// ── content 值对象 ───────────────────────────────────────────

export const ContentSchema = z
  .object({
    pattern: z.string().optional(),
    markdown: z.string().optional(),
    rationale: z.string().min(1, 'rationale is required'),
    steps: z.array(z.record(z.string(), z.unknown())).optional(),
    codeChanges: z.array(z.record(z.string(), z.unknown())).optional(),
    verification: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((c) => c.pattern || c.markdown, {
    message: 'content must have at least one of "pattern" or "markdown"',
  });

// ── reasoning 值对象 ─────────────────────────────────────────

export const ReasoningSchema = z.object({
  whyStandard: z.string().min(1, 'whyStandard is required'),
  sources: z.array(z.string()).min(1, 'at least one source is required'),
  confidence: z.number().min(0).max(1),
  qualitySignals: z.record(z.string(), z.unknown()).optional(),
  alternatives: z.array(z.string()).optional(),
  // 挖掘产出升级 M1 收尾（2026-07-04）：zod 严格对象 parse 会剥离未声明键——下列提交侧
  // 扩展字段此前在此静默丢失（run-9 取证：styleAdvisories attach×5 未落库；既有 styleWaiver
  // 同理从未持久化）。声明为可选使其随候选入库，供 Dashboard 人工复核与证据溯源。
  evidenceRefs: z.array(z.string()).optional(),
  styleAdvisories: z.array(z.string()).optional(),
  styleWaiver: z.object({ codes: z.array(z.string()), justification: z.string() }).optional(),
});

// ── ID / 常用字段 ────────────────────────────────────────────

export const IdField = z.string().min(1, 'id is required');
export const TitleField = z.string().min(1, 'title is required');
export const LanguageField = z.string().min(1, 'language is required');
