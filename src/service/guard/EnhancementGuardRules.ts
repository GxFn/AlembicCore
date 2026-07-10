// RIC-2a / R1 — read-only high-level helper on the @alembic/core/guard facade
// that surfaces the Guard rules contributed by enhancement packs. Outer repos
// (Plugin/Alembic guard handlers + HTTP routes) consume Guard rules through this
// method instead of importing @alembic/core/core/enhancement directly — the only
// business use of enhancement is producing Guard rules, which is guard domain.
//
// Additive to the guard surface; does NOT change the D4 decision (guard stays a
// Core export consumed by both execution routes). The enhancement registry is a
// blessed lazy singleton hydrated at bootstrap (initEnhancementRegistry — infra
// wiring, RIC-2a/R3); the sync helper returns [] when the registry has not been
// initialized yet (graceful, never throws), while the project-precise async
// helper below self-hydrates (idempotent init) before resolving.

import {
  type DetectedProjectFrameworks,
  detectProjectFrameworks,
} from '../../core/enhancement/detectFrameworks.js';
import type { EnhancementPack, GuardRule } from '../../core/enhancement/EnhancementPack.js';
import { getEnhancementRegistry, initEnhancementRegistry } from '../../core/enhancement/index.js';

/** A Guard rule contributed by an enhancement pack (re-exported via @alembic/core/guard). */
export type EnhancementGuardRule = GuardRule;

export interface ResolveEnhancementGuardRulesOptions {
  /** Primary language; when set, packs are matched via the registry resolver. */
  language?: string;
  /** Detected frameworks used alongside `language` to narrow matching packs. */
  frameworks?: string[];
  /**
   * Generic-only mode (RIC-2a-2): when true, return Guard rules ONLY from packs
   * with no framework conditions, ignoring `language`/`frameworks` (the resolver
   * is not used). Mirrors the Plugin guard handler, which defers
   * framework-conditioned packs (e.g. go-grpc) to a later precise resolve so
   * non-matching projects do not get false-positive findings.
   */
  frameworkAgnostic?: boolean;
}

/**
 * Collect the Guard rules contributed by enhancement packs.
 *
 * - No options → all registered packs' Guard rules.
 * - `frameworkAgnostic: true` → only packs with no framework conditions
 *   (generic-only; takes precedence over the resolver path).
 * - `language` (+ optional `frameworks`) → only packs matched by the registry
 *   resolver (framework/language aware).
 *
 * Returns an empty array when the enhancement registry has not been initialized.
 */
export function resolveEnhancementGuardRules(
  options: ResolveEnhancementGuardRulesOptions = {}
): EnhancementGuardRule[] {
  const registry = getEnhancementRegistry();
  let packs: EnhancementPack[];
  if (options.frameworkAgnostic) {
    // Generic-only: packs without framework conditions — semantics identical to
    // the Plugin guard handler's all().filter((p) => !p.conditions?.frameworks?.length).
    packs = registry.all().filter((pack) => !pack.conditions?.frameworks?.length);
  } else if (options.language) {
    packs = registry.resolve(options.language, options.frameworks ?? []);
  } else {
    packs = registry.all();
  }
  return packs.flatMap((pack) => pack.getGuardRules());
}

/** 项目级精确 resolve 的结果:规则 + 判定依据(诊断/日志/测试用)。 */
export interface ProjectEnhancementGuardRules {
  rules: EnhancementGuardRule[];
  /** 命中的增强包 id(去重排序,确定性)。 */
  packIds: string[];
  /** 依赖清单推导出的语言/框架/清单证据。 */
  detection: DetectedProjectFrameworks;
}

/**
 * 项目级精确 resolve(2026-07-10 链路验通审计补齐):从项目根的真实依赖清单推导
 * { languages, frameworks },逐语言走注册表 resolver 并集去重,产出该项目应得的
 * 增强包 Guard 规则。
 *
 * 这是 detectedFrameworks 此前缺失的生产来源——14 个包全部带框架条件,导致
 * Plugin guard 的 frameworkAgnostic 路径恒空集(注释里的"Bootstrap Phase 4 精确
 * resolve"从未存在)、主体 HTTP 路径无条件全集。两宿主统一改走本入口:匹配项目
 * (如 React)得到对应包规则,无对应生态(如纯 Swift)得到空集——评估期语言门
 * (GuardCheckEngine 按文件语言过滤)仍是第二道网。
 *
 * 内部先 await initEnhancementRegistry()(幂等),不再依赖调用方 bootstrap 顺序;
 * 检测/初始化任一失败都返回空结果并把原因交给调用方日志,绝不抛错阻断 guard。
 */
export async function resolveEnhancementGuardRulesForProject(
  projectRoot: string
): Promise<ProjectEnhancementGuardRules> {
  const empty: DetectedProjectFrameworks = { frameworks: [], languages: [], manifests: [] };
  try {
    await initEnhancementRegistry();
    const detection = await detectProjectFrameworks(projectRoot);
    const registry = getEnhancementRegistry();
    const matched = new Map<string, EnhancementPack>();
    for (const language of detection.languages) {
      for (const pack of registry.resolve(language, [...detection.frameworks])) {
        matched.set(pack.id, pack);
      }
    }
    const packIds = [...matched.keys()].sort();
    return {
      detection,
      packIds,
      rules: packIds.flatMap((id) => matched.get(id)?.getGuardRules() ?? []),
    };
  } catch {
    // 检测器已逐清单容错,走到这里通常是注册表动态加载失败:按"无匹配包"降级。
    return { detection: empty, packIds: [], rules: [] };
  }
}
