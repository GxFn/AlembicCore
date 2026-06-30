/**
 * UnifiedValidator.js — 统一验证链
 *
 * 替代 CandidateGuardrail + RecipeReadinessChecker 的分裂验证，
 * 提供单一入口的三层验证 (字段完整性 + 内容质量 + 去重)。
 *
 * 统一严格模式：完整 REQUIRED 字段检查，无宽松降级。
 *
 * @module shared/UnifiedValidator
 */

import { LanguageService } from '../../shared/LanguageService.js';
import {
  FieldLevel,
  STANDARD_CATEGORIES,
  V3_FIELD_SPEC,
  VALID_KINDS,
  WHITELISTED_CATEGORIES,
} from './FieldSpec.js';
// P1.3 re-point — stage-3 字段门禁常量（markdown 长度下限、代码块/文件引用正则、coreCode 起始字符、
// 通用标题正则、唯一性下限）与代码指纹函数，统一从 RecipeAuthoringSpec gate-rules 表读取，不再内联字面量。
// 取值与原内联实现字节级一致（仅“搬移”不重解释）；该模块零 fs，同层 domain 导入合法。
import { codeFingerprint, getStage3FieldPolicy } from './recipe-authoring-spec/gateRules.js';

// stage-3 字段门禁策略单例：返回的正则均无 g 标志、状态无关，可安全复用同一实例。
const STAGE3_FIELD_POLICY = getStage3FieldPolicy();

// ── UnifiedValidator ────────────────────────────────────────

export class UnifiedValidator {
  /** 已提交标题 (小写) */
  #titles;

  /** 已提交代码指纹 */
  #codeFingerprints;

  /** 已提交 trigger (小写) */
  #triggers;

  /**
   * @param [options.existingTitles] 预填充已有标题
   * @param [options.existingFingerprints] 预填充已有代码指纹
   * @param [options.existingTriggers] 预填充已有 trigger
   */
  constructor(
    options: {
      existingTitles?: Set<string>;
      existingFingerprints?: Set<string>;
      existingTriggers?: Set<string>;
    } = {}
  ) {
    this.#titles = options.existingTitles || new Set();
    this.#codeFingerprints = options.existingFingerprints || new Set();
    this.#triggers = options.existingTriggers || new Set();
  }

  /**
   * 完整验证链 (3 层)
   *
   * @param candidate 候选数据（扁平字段）
   * @param [options.mode] 验证模式（自动检测或手动指定）
   * @param [options.systemInjectedFields] 系统注入的字段（跳过 REQUIRED 检查）
   * @param [options.skipUniqueness=false] 跳过去重检查
   * @returns }
   */
  validate(
    candidate: Record<string, unknown>,
    options: {
      systemInjectedFields?: string[];
      skipUniqueness?: boolean;
    } = {}
  ) {
    const errors: string[] = [];
    const warnings: string[] = [];

    const systemInjected = new Set(options.systemInjectedFields || []);

    // ── Layer 1: 字段完整性 (基于 V3_FIELD_SPEC) ──
    this.#checkFields(candidate, systemInjected, errors, warnings);

    // ── Layer 2: 内容质量 (来自 CandidateGuardrail.validateQuality) ──
    this.#checkContentQuality(candidate, errors, warnings);

    // ── Layer 3: 唯一性 (来自 CandidateGuardrail.validateUniqueness) ──
    if (!options.skipUniqueness) {
      this.#checkUniqueness(candidate, errors);
    }

    return {
      pass: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ── Layer 1: 基于 FieldSpec 检查 ─────────────────────────

  #checkFields(
    candidate: Record<string, unknown>,
    systemInjected: Set<string>,
    errors: string[],
    warnings: string[]
  ) {
    for (const field of V3_FIELD_SPEC) {
      const { name, level, rule } = field;

      // 系统注入字段：跳过
      if (systemInjected.has(name)) {
        continue;
      }

      const value = this.#getNestedValue(candidate, name);
      const missing = this.#isMissing(value, field);

      if (!missing) {
        continue;
      }

      if (level === FieldLevel.REQUIRED) {
        errors.push(`缺少必填字段: ${name} — ${rule}`);
      } else if (level === FieldLevel.EXPECTED) {
        warnings.push(`建议填写: ${name} — ${rule}`);
      }
      // OPTIONAL: 不报任何问题
    }

    // ── 额外的格式/值校验 ──

    // content 必须是对象
    if (candidate.content && typeof candidate.content !== 'object') {
      errors.push(
        '⚠️ content 必须是 JSON 对象（不是字符串！）。正确格式: { "markdown": "...", "rationale": "..." }'
      );
    }

    // reasoning 必须是对象
    if (candidate.reasoning && typeof candidate.reasoning !== 'object') {
      errors.push(
        '⚠️ reasoning 必须是 JSON 对象（不是字符串！）。正确格式: { "whyStandard": "...", "sources": [...], "confidence": 0.85 }'
      );
    }

    // kind 值校验
    if (candidate.kind && !VALID_KINDS.includes(candidate.kind as string)) {
      errors.push(`kind 值无效: "${candidate.kind}" — 取值 rule/pattern/fact`);
    }

    // trigger 格式校验
    if (candidate.trigger && !(candidate.trigger as string).startsWith('@')) {
      warnings.push(`trigger "${candidate.trigger}" 应以 @ 开头`);
    }

    // category 值校验
    if (
      candidate.category &&
      !STANDARD_CATEGORIES.includes(candidate.category as string) &&
      !WHITELISTED_CATEGORIES.includes(candidate.category as string)
    ) {
      warnings.push(
        `category "${candidate.category}" 非标准值，应为: ${STANDARD_CATEGORIES.join('/')}（bootstrap/knowledge 等特殊来源可忽略此建议）`
      );
    }

    // language 校验
    const lang = (candidate.language as string | undefined)?.toLowerCase();
    if (lang && !LanguageService.isKnownLang(lang) && lang !== 'objc' && lang !== 'markdown') {
      warnings.push(
        `language "${candidate.language}" — 请使用标准语言标识 (swift/typescript/python/java/kotlin 等)`
      );
    }
  }

  // ── Layer 2: 内容质量启发式 ──────────────────────────────

  #checkContentQuality(candidate: Record<string, unknown>, errors: string[], warnings: string[]) {
    const markdown =
      ((candidate.content as Record<string, unknown> | undefined)?.markdown as string) || '';

    // markdown ≥ markdownFloor 字符（下限来自 gate-rules 表，渲染值与原 200 一致）
    if (markdown && markdown.length > 0 && markdown.length < STAGE3_FIELD_POLICY.markdownFloor) {
      errors.push(
        `content.markdown 过短 (${markdown.length} 字符, 最少 ${STAGE3_FIELD_POLICY.markdownFloor})。请包含代码片段和项目上下文描述。`
      );
    }

    // 代码块存在性
    if (
      markdown &&
      markdown.length >= STAGE3_FIELD_POLICY.markdownFloor &&
      !STAGE3_FIELD_POLICY.codeBlockRe.test(markdown) &&
      !STAGE3_FIELD_POLICY.fileRefRe.test(markdown)
    ) {
      errors.push('content.markdown 中必须包含至少一个代码块或文件引用');
    }

    // 来源引用（建议）
    if (markdown && markdown.length >= STAGE3_FIELD_POLICY.markdownFloor) {
      const hasSourceRef =
        /来源[:：]|[Ss]ource[:：]|\(\w+\.\w+:\d+\)/.test(markdown) ||
        /[A-Z]\w+\.(?:m|h|swift|java|kt|js|ts|go|py|rs|rb|cs|cpp|c)/.test(markdown);
      if (!hasSourceRef) {
        warnings.push('建议在内容中标注代码来源 (来源: FileName.ext:行号)');
      }

      // 源码位置质量检查 — 优先使用完整相对路径
      const hasFullPathRef =
        /来源[:：]\s*\S+\/\S+\.\w+:\d+/.test(markdown) || /\(\S+\/\S+\.\w+:\d+\)/.test(markdown);
      const hasBareName =
        /来源[:：]\s*[A-Z]\w+\.\w+:\d+/.test(markdown) || /\([A-Z]\w+\.\w+:\d+\)/.test(markdown);
      if (hasBareName && !hasFullPathRef) {
        warnings.push(
          '源码位置应使用完整相对路径+行号（如 Packages/ModuleName/Sources/.../FileName.swift:42），而非仅文件名'
        );
      }
    }

    // coreCode 语法完整性
    {
      const coreCode = ((candidate.coreCode as string) || '').trim();
      if (coreCode) {
        const firstChar = coreCode[0];
        if (STAGE3_FIELD_POLICY.incompleteCoreCodeFirstChars.has(firstChar)) {
          errors.push(
            `coreCode 以 "${firstChar}" 开头 — 代码片段不完整，请包含完整的函数/方法/表达式`
          );
        }
      }
    }

    // 通用知识检测（正则来自 gate-rules 表，保留 i 标志）
    const title = (candidate.title as string) || '';
    if (STAGE3_FIELD_POLICY.genericTitleRe.test(title.trim())) {
      errors.push(`标题过于通用: "${title}" — 请加上项目特定的上下文`);
    }

    // 内容过于简单
    if (markdown && markdown.length > 0 && markdown.length >= STAGE3_FIELD_POLICY.markdownFloor) {
      const lines = markdown.split('\n').filter((l: string) => l.trim().length > 0);
      if (lines.length <= 2 && !STAGE3_FIELD_POLICY.codeBlockRe.test(markdown)) {
        warnings.push(`内容仅 ${lines.length} 行 — 建议包含更多代码片段和设计意图描述`);
      }
    }

    // reasoning.sources 路径质量检查 — 应包含路径分隔符，而非仅类名/文件名
    const reasoning = candidate.reasoning as Record<string, unknown> | undefined;
    const sources = reasoning?.sources;
    if (Array.isArray(sources) && sources.length > 0) {
      const bareSources = sources.filter(
        (s: unknown) => typeof s === 'string' && !s.includes('/') && !s.includes('\\')
      );
      if (bareSources.length > 0 && bareSources.length === sources.length) {
        warnings.push(
          `reasoning.sources 中的路径缺少目录结构（如 "${bareSources[0]}"）— 应使用完整相对路径（如 Packages/ModuleName/Sources/.../FileName.swift）`
        );
      }
    }
  }

  // ── Layer 3: 去重 ────────────────────────────────────────

  #checkUniqueness(candidate: Record<string, unknown>, errors: string[]) {
    const title = ((candidate.title as string) || '').toLowerCase().trim();
    if (title && this.#titles.has(title)) {
      errors.push(`标题重复: "${candidate.title}"`);
    }

    const trigger = ((candidate.trigger as string) || '').toLowerCase().trim();
    if (trigger && this.#triggers.has(trigger)) {
      errors.push(`trigger 重复: "${candidate.trigger}"`);
    }

    const pattern = (
      ((candidate.content as Record<string, unknown> | undefined)?.pattern as string) || ''
    ).trim();
    if (pattern.length >= STAGE3_FIELD_POLICY.patternFloor) {
      const fp = codeFingerprint(pattern);
      if (fp.length >= STAGE3_FIELD_POLICY.codeFingerprintFloor && this.#codeFingerprints.has(fp)) {
        errors.push('代码模式重复 — 已存在相同核心代码的候选。请提交不同的代码片段。');
      }
    }
  }

  // ── 提交记录 ─────────────────────────────────────────────

  /**
   * 记录已提交的标题和代码指纹（提交成功后调用）
   * @param [pattern] 代码模式
   */
  recordSubmission(
    title: string | null | undefined,
    pattern: string | null | undefined,
    trigger?: string | null
  ) {
    if (title && typeof title === 'string') {
      this.#titles.add(title.toLowerCase().trim());
    }
    if (trigger && typeof trigger === 'string') {
      this.#triggers.add(trigger.toLowerCase().trim());
    }
    if (
      pattern &&
      typeof pattern === 'string' &&
      pattern.length >= STAGE3_FIELD_POLICY.patternFloor
    ) {
      const fp = codeFingerprint(pattern);
      if (fp.length >= STAGE3_FIELD_POLICY.codeFingerprintFloor) {
        this.#codeFingerprints.add(fp);
      }
    }
  }

  // ── 工具函数 ─────────────────────────────────────────────

  /**
   * 获取嵌套字段值
   * @param path 如 'content.markdown' 或 'reasoning.sources'
   */
  #getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  /** 检查值是否为"缺失" */
  #isMissing(value: unknown, field: { name: string; type?: string }) {
    if (value === undefined || value === null) {
      return true;
    }

    if (field.type === 'string') {
      return typeof value !== 'string' || !value.trim();
    }
    if (field.type === 'array') {
      if (!Array.isArray(value)) {
        return true;
      }
      // reasoning.sources 必须非空
      if (field.name === 'reasoning.sources') {
        return value.length === 0;
      }
      // headers 允许空数组
      if (field.name === 'headers') {
        return false;
      }
      return false;
    }
    if (field.type === 'object') {
      return typeof value !== 'object';
    }

    return !value;
  }
}

// ── 便捷工厂函数 ────────────────────────────────────────────

/** 创建一个无状态验证器实例（不含去重缓存），适用于一次性校验 */
export function createStatelessValidator() {
  return new UnifiedValidator();
}

export default UnifiedValidator;
