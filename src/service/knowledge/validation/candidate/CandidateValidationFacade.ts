/**
 * CandidateValidationFacade — 统一候选验证入口（CO2 B3）
 *
 * 组合三个既有验证器，使调用方不会意外选择更弱的子集：
 *   1. aggregateCandidates — 批内 title 模糊去重；
 *   2. RecipeCandidateValidator — V3 结构化字段校验；
 *   3. UnifiedValidator — 字段完整性 + 内容质量 + 跨提交唯一性。
 *
 * 边界（层契约 B3）：本门面只做组合，不改变任何单项验证器的判定语义；
 * 不执行 enforcement（质量门禁归 CKG3）；咨询性打分（QualityScorer）
 * 保持独立，不进入本门面。
 */

import { UnifiedValidator } from '../../../../domain/knowledge/UnifiedValidator.js';
import { RecipeCandidateValidator } from '../recipe/RecipeCandidateValidator.js';
import { aggregateCandidates } from './CandidateAggregator.js';

export interface UnifiedCandidateValidationOptions {
  /** 去重相似度阈值，透传给 aggregateCandidates */
  aggregateThreshold?: number;
  /** 透传给 UnifiedValidator.validate 的系统注入字段 */
  systemInjectedFields?: string[];
  /** 透传给 UnifiedValidator.validate：跳过跨提交唯一性检查 */
  skipUniqueness?: boolean;
  /** 复用既有的有状态 UnifiedValidator（默认新建无状态实例） */
  unifiedValidator?: UnifiedValidator;
}

export interface UnifiedCandidateValidationItem {
  candidate: Record<string, unknown>;
  /** UnifiedValidator 三层验证结果（字段/质量/唯一性） */
  unified: { pass: boolean; errors: string[]; warnings: string[] };
  /** RecipeCandidateValidator V3 结构校验结果 */
  recipe: { valid: boolean; errors: string[]; warnings: string[] };
  /** 全链通过：unified.pass 且 recipe.valid（纯合取，无新增判定） */
  valid: boolean;
}

export interface UnifiedCandidateValidationResult {
  items: UnifiedCandidateValidationItem[];
  /** 批内去重移除的条目（与 aggregateCandidates 输出一致） */
  duplicates: { item: Record<string, unknown>; duplicateOf: string }[];
}

/**
 * 对候选批次运行完整验证链（去重 → V3 结构 → 统一三层验证）。
 *
 * 结果是三个验证器各自输出的并列呈现加上它们的合取 `valid`；
 * 不丢弃、不弱化、不重排任何单项验证器的 errors/warnings。
 */
export function validateCandidatesUnified(
  candidates: Record<string, unknown>[],
  options: UnifiedCandidateValidationOptions = {}
): UnifiedCandidateValidationResult {
  const unifiedValidator = options.unifiedValidator ?? new UnifiedValidator();
  const recipeValidator = new RecipeCandidateValidator();
  const aggregated = aggregateCandidates(
    (candidates ?? []) as { title: string; [key: string]: unknown }[],
    options.aggregateThreshold === undefined ? {} : { threshold: options.aggregateThreshold }
  );

  const items = aggregated.items.map((candidate) => {
    const recipe = recipeValidator.validate(candidate);
    const unified = unifiedValidator.validate(candidate, {
      systemInjectedFields: options.systemInjectedFields,
      skipUniqueness: options.skipUniqueness,
    });
    return {
      candidate,
      unified,
      recipe,
      valid: unified.pass && recipe.valid,
    };
  });

  return { items, duplicates: aggregated.duplicates };
}
