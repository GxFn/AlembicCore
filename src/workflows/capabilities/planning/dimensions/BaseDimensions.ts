/**
 * BaseDimensions — DimensionRegistry 的适配层
 *
 * 从统一维度注册表 (DimensionRegistry) 派生的瘦适配层：
 *   - `baseDimensions` 从 DIMENSION_REGISTRY 转换为下游兼容格式
 *   - `resolveActiveDimensions()` 委托给 DimensionRegistry
 *   - `BaseDimension` 接口保留给 MissionBriefingBuilder 等消费者使用
 */

import {
  resolveActiveDimensions as _resolveActive,
  resolvePlanDimensionDefinitions as _resolvePlanDimensionDefinitions,
  DIMENSION_REGISTRY,
  type UnifiedDimension,
} from '../../../../domain/dimension/index.js';

// ═══════════════════════════════════════════════════════════
// 基础维度定义 — 从统一注册表派生
// ═══════════════════════════════════════════════════════════

/** Single dimension definition with optional language/framework conditions */
export interface BaseDimension {
  id: string;
  label: string;
  guide: string;
  knowledgeTypes: string[];
  skillWorthy?: boolean;
  dualOutput?: boolean;
  skillMeta?: { name: string; description: string };
  conditions?: { languages?: string[]; frameworks?: string[] };
  tierHint?: number;
}

/**
 * 将 UnifiedDimension 转换为旧 BaseDimension 格式
 * 保持下游 MissionBriefingBuilder / dimension-configs 兼容
 */
function toBaseDimension(dim: UnifiedDimension): BaseDimension {
  return {
    id: dim.id,
    label: dim.label,
    guide: dim.extractionGuide,
    knowledgeTypes: [...dim.allowedKnowledgeTypes],
    skillWorthy: dim.outputMode === 'dual',
    dualOutput: dim.outputMode === 'dual',
    conditions: dim.conditions
      ? {
          languages: dim.conditions.languages ? [...dim.conditions.languages] : undefined,
          frameworks: dim.conditions.frameworks ? [...dim.conditions.frameworks] : undefined,
        }
      : undefined,
    tierHint: dim.tierHint,
  };
}

/**
 * 从统一注册表派生的维度列表
 * 保持数组结构与旧 baseDimensions 兼容
 */
export const baseDimensions: BaseDimension[] = DIMENSION_REGISTRY.map(toBaseDimension);

// ═══════════════════════════════════════════════════════════
// 维度条件化过滤
// ═══════════════════════════════════════════════════════════

/**
 * 根据项目主语言和检测到的框架过滤条件维度
 * @param allDimensions 所有维度定义（含 conditions 字段）
 * @param primaryLang 主语言
 * @param detectedFrameworks 检测到的框架
 * @returns 适用的维度列表
 */
export function resolveActiveDimensions(
  allDimensions: BaseDimension[],
  primaryLang: string,
  detectedFrameworks: string[] = []
) {
  // 若传入的是完整 baseDimensions，直接委托给注册表
  if (allDimensions === baseDimensions) {
    return _resolveActive(primaryLang, detectedFrameworks).map(toBaseDimension);
  }
  // 若传入自定义维度列表（如 Enhancement Pack 追加），使用原有逻辑
  return allDimensions.filter((dim) => {
    if (!dim.conditions) {
      return true;
    }
    const langMatch = !dim.conditions.languages || dim.conditions.languages.includes(primaryLang);
    const fwMatch =
      !dim.conditions.frameworks ||
      dim.conditions.frameworks.some((f) => detectedFrameworks.includes(f));
    return langMatch && (dim.conditions.frameworks ? fwMatch : true);
  });
}

/**
 * Plan generation scope 专用：按 confirmed Plan IDs 解析维度定义。
 *
 * 该路径不再用语言/框架重算活跃维度，避免 no-signal 场景把
 * Agent 已确认的 framework/domain 维度裁掉。下游 Plugin/Alembic
 * 迁移 generation scope 时应优先接此入口。
 */
export function resolvePlanDimensionDefinitions(
  allDimensions: BaseDimension[],
  dimensionIds: readonly string[]
): { dimensions: BaseDimension[]; missingDimensionIds: readonly string[] } {
  if (allDimensions === baseDimensions) {
    const resolution = _resolvePlanDimensionDefinitions(dimensionIds);
    return {
      dimensions: resolution.dimensions.map(toBaseDimension),
      missingDimensionIds: resolution.missingDimensionIds,
    };
  }

  const byId = new Map(allDimensions.map((dimension) => [dimension.id, dimension]));
  const seen = new Set<string>();
  const dimensions: BaseDimension[] = [];
  const missingDimensionIds: string[] = [];
  for (const dimensionId of dimensionIds) {
    if (!dimensionId || seen.has(dimensionId)) {
      continue;
    }
    seen.add(dimensionId);
    const dimension = byId.get(dimensionId);
    if (dimension) {
      dimensions.push(dimension);
    } else {
      missingDimensionIds.push(dimensionId);
    }
  }
  return { dimensions, missingDimensionIds };
}
