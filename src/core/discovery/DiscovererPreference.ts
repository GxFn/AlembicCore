/** Discoverer 冲突判定；偏好持久化由 infrastructure 的独立入口承担。 */
// 保留现有 discovery 包入口，宿主无需改变 load/save 消费方式。
export {
  type DiscovererPreferenceData,
  loadPreference,
  loadProjectDiscovererPreference,
  savePreference,
} from '../../infrastructure/config/DiscovererPreferenceStore.js';

export interface DetectMatch {
  discovererId: string;
  displayName: string;
  confidence: number;
}

export interface ConflictResult {
  ambiguous: boolean;
  reason?: string;
  matches: DetectMatch[];
  recommended?: DetectMatch;
}

// ── Constants ───────────────────────────────────────

/** 两个 Discoverer confidence 差值低于此阈值视为模糊 */
const AMBIGUITY_THRESHOLD = 0.1;

/** 最高 confidence 低于此值视为启发式不确定 */
const HEURISTIC_UNCERTAIN_THRESHOLD = 0.6;

// ── Conflict Detection ──────────────────────────────

/**
 * 检测 Discoverer 匹配结果是否存在冲突/模糊
 */
export function detectConflict(matches: DetectMatch[]): ConflictResult {
  if (matches.length === 0) {
    return { ambiguous: false, matches };
  }

  if (matches.length === 1) {
    return { ambiguous: false, matches, recommended: matches[0] };
  }

  const top = matches[0];
  const second = matches[1];

  // 条件 1: 多个高置信度结果 (≥ 0.60)
  const highConfCount = matches.filter((m) => m.confidence >= 0.6).length;

  // 条件 2: top-1 与 top-2 差距 < 阈值
  const closeDelta = top.confidence - second.confidence < AMBIGUITY_THRESHOLD;

  // 条件 3: 最高分仍低于阈值（仅启发式命中）
  const heuristicOnly = top.confidence < HEURISTIC_UNCERTAIN_THRESHOLD;

  if (highConfCount >= 2 && closeDelta) {
    return {
      ambiguous: true,
      reason: `Multiple build systems detected with similar confidence (${top.displayName}: ${top.confidence.toFixed(2)} vs ${second.displayName}: ${second.confidence.toFixed(2)})`,
      matches,
      recommended: top,
    };
  }

  if (heuristicOnly) {
    return {
      ambiguous: true,
      reason: `No definitive build system identified (highest: ${top.displayName} at ${top.confidence.toFixed(2)})`,
      matches,
      recommended: top,
    };
  }

  return { ambiguous: false, matches, recommended: top };
}
