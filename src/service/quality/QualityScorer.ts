/**
 * QualityScorer v2 — Recipe 质量评分器
 *
 * 面向知识管理场景重新设计，采用渐进式评分（非二元判断），
 * 充分利用 KnowledgeEntry 所有可用字段。
 *
 * 5 维度加权:
 * - completeness  (0.25): 结构完整性 — 核心字段齐全度
 * - contentDepth  (0.30): 内容深度   — markdown 丰富度、推理、溯源
 * - deliveryReady (0.20): 交付就绪   — trigger/language/tags/category
 * - actionability (0.15): 可操作性   — coreCode、do/dont/when 质量
 * - provenance    (0.10): 溯源可信   — confidence、sources、authority
 *
 * 设计参考:
 * - RAG Triad (TruLens): Relevance + Groundedness + Answer Relevance
 * - RAGAS: Context Precision + Faithfulness + Factual Correctness
 * - SonarQube: 多维度渐进评级，非二元判断
 */

import { reviewRecipeDepth } from '../../domain/knowledge/recipe-authoring-spec/index.js';
import { QUALITY_GRADES, QUALITY_WEIGHTS } from '../../shared/constants.js';
import { LanguageProfiles } from '../../shared/LanguageProfiles.js';

const DEFAULT_WEIGHTS = QUALITY_WEIGHTS;

export interface RecipeInput {
  // Core identity
  title?: string;
  trigger?: string;
  description?: string;
  language?: string;
  category?: string;

  // Delivery fields
  doClause?: string;
  dontClause?: string;
  whenClause?: string;
  coreCode?: string;
  usageGuide?: string;

  // Content depth
  contentMarkdown?: string;
  contentRationale?: string;

  // Reasoning / provenance
  reasoningWhyStandard?: string;
  reasoningSources?: string[];
  reasoningConfidence?: number;
  source?: string;

  // P5/C8 深度接地评分输入（由 KnowledgeService._adaptForScorer 经 C7 接线透传）。
  // groundingAvailable=false（宿主未注入接地 port）时评分走 legacy 公式，字节不变、零回归；
  // =true 时启用深度加权公式：长度降为及格线、depthCoverage 只认接地维度。
  groundingAvailable?: boolean;
  groundedSourcePaths?: string[];
  constraintsBoundaries?: string[];
  constraintsPreconditions?: string[];
  constraintsSideEffects?: string[];
  contentVerification?: { method?: string; expected_result?: string; test_code?: string } | null;
  reasoningAlternatives?: string[];

  // Metadata
  headers?: string[];
  tags?: string[];

  // Engagement (from stats)
  views?: number;
  clicks?: number;
  rating?: number;

  [key: string]: unknown;
}

// ─── 渐进式评分辅助函数 ─────────────────────────────────

/** 文本长度渐进评分: 低于 minLen 给 20% 基础分，minLen→optimalLen 线性增长到满分 */
function textScore(text: string | undefined, minLen: number, optimalLen: number, weight: number) {
  if (!text?.trim()) {
    return 0;
  }
  const len = text.trim().length;
  if (len < minLen) {
    return weight * 0.2;
  }
  if (len <= optimalLen) {
    return weight * (0.5 + 0.5 * (len / optimalLen));
  }
  return weight;
}

/** 存在性检查: 有值给满分 */
function presenceScore(value: string | undefined, weight: number) {
  return value?.trim() ? weight : 0;
}

export class QualityScorer {
  #weights;

  constructor(options: { weights?: Record<string, number> } = {}) {
    this.#weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  }

  /**
   * 计算综合质量分
   * @returns { score: 0-1, dimensions: Record<string,number>, grade: A-F }
   */
  score(recipe: RecipeInput) {
    const dimensions = {
      completeness: this.#scoreCompleteness(recipe),
      contentDepth: this.#scoreContentDepth(recipe),
      deliveryReady: this.#scoreDeliveryReady(recipe),
      actionability: this.#scoreActionability(recipe),
      provenance: this.#scoreProvenance(recipe),
    };

    let totalScore = 0;
    for (const [dim, weight] of Object.entries(this.#weights)) {
      totalScore +=
        (((dimensions as Record<string, number>)[dim] || 0) as number) * (weight as number);
    }

    totalScore = Math.min(1, Math.max(0, totalScore));

    return {
      score: parseFloat(totalScore.toFixed(3)),
      dimensions,
      grade: this.#toGrade(totalScore),
    };
  }

  /** 批量评分 */
  scoreBatch(recipes: RecipeInput[]) {
    return recipes.map((r: RecipeInput) => ({ recipe: r, ...this.score(r) }));
  }

  /** 获取维度权重 */
  getWeights() {
    return { ...this.#weights };
  }

  // ─── 维度评分 ─────────────────────────────────────────

  /**
   * 结构完整性 (0-1)
   * 渐进式检查核心字段齐全度
   */
  #scoreCompleteness(r: RecipeInput) {
    let s = 0;
    s += textScore(r.title, 3, 40, 0.15);
    s += presenceScore(r.trigger, 0.15);
    s += textScore(r.description, 10, 60, 0.15);
    s += textScore(r.doClause, 10, 50, 0.15);
    s += textScore(r.whenClause, 10, 50, 0.15);
    s += textScore(r.coreCode, 10, 200, 0.15);
    s += presenceScore(r.dontClause, 0.1);
    return Math.min(1, s);
  }

  /**
   * 内容深度 (0-1) — P5/C8 分流。
   *
   * 关键安全设计：只有当宿主注入了接地 port(groundingAvailable=true，见 C7)时才启用深度加权公式；否则
   * 走 legacy 公式，与历史评分【字节不变】——因为生产宿主接线落地前 groundedSourcePaths 恒空，若此时削长度
   * 权重会让全量历史 recipe 评分雪崩(违反主指标不回归)。深度公式随接线+真机快照验证(P6)一并激活。
   */
  #scoreContentDepth(r: RecipeInput) {
    if (r.groundingAvailable) {
      return this.#scoreContentDepthGrounded(r);
    }
    return this.#scoreContentDepthLegacy(r);
  }

  /**
   * legacy 内容深度公式 —— 与 C8 之前逐字一致。宿主未注入接地 port 时的默认路径，保证零回归。
   */
  #scoreContentDepthLegacy(r: RecipeInput) {
    let s = 0;
    const md = r.contentMarkdown || r.usageGuide || '';

    // markdown 内容长度 (最优 200-800 字符)
    s += textScore(md || undefined, 50, 800, 0.3);

    // 结构化标记: 标题 / 代码块 / 列表
    if (md) {
      if (/^#{1,4}\s/m.test(md)) {
        s += 0.08;
      }
      if (/```[\s\S]*?```|`[^`]+`/.test(md)) {
        s += 0.08;
      }
      if (/^[\s]*[-*+]\s/m.test(md)) {
        s += 0.04;
      }
    }

    // rationale: 设计原理
    s += textScore(r.contentRationale, 10, 100, 0.15);

    // reasoning.whyStandard
    s += textScore(r.reasoningWhyStandard, 10, 100, 0.15);

    // reasoning.sources 来源文件
    if (r.reasoningSources && r.reasoningSources.length > 0) {
      s += Math.min(0.1, r.reasoningSources.length * 0.03);
    }

    // usageGuide（如果与 markdown 不同则额外加分）
    if (r.usageGuide && r.usageGuide !== md) {
      s += textScore(r.usageGuide, 20, 200, 0.1);
    }

    return Math.min(1, s);
  }

  /**
   * P5/C8 深度加权内容深度公式（接地 port 就位后启用）。
   *
   * 口径转变(直击「800 字 + ## 刷满 contentDepth」失败模式)：
   *   - 长度从满分杠杆(0.3 斜坡到 800 字)降为**及格线**(0.12 斜坡到 400 字，400 字足够容纳深度分节)。
   *   - 结构标记/rationale/whyStandard/sources 保留但**降权**——非接地内容合计封顶约 0.56。
   *   - 新增 depthCoverage(权重 0.44)：调 Core `reviewRecipeDepth`(与契约/裁判/retry/host depthGaps 字节同源)，
   *     **只认在 groundedSourcePaths 上的 file:line**——编造边界/凑字数拿不到分；接地覆盖 ≥3 个深度维度给满。
   * 唯一冲上 contentDepth 高分的路径 = 真接地覆盖更多深度维度，此时涨分即价值(直击用户红线)。
   */
  #scoreContentDepthGrounded(r: RecipeInput) {
    let s = 0;
    const md = r.contentMarkdown || r.usageGuide || '';

    // 长度降为及格线：满权 0.12，最优 400 字（足够写下四个深度分节）。
    s += textScore(md || undefined, 50, 400, 0.12);

    // 结构化标记降权（不再是刷分杠杆）。
    if (md) {
      if (/^#{1,4}\s/m.test(md)) {
        s += 0.05;
      }
      if (/```[\s\S]*?```|`[^`]+`/.test(md)) {
        s += 0.05;
      }
      if (/^[\s]*[-*+]\s/m.test(md)) {
        s += 0.03;
      }
    }

    // rationale / whyStandard / sources / usageGuide 保留但降权。
    s += textScore(r.contentRationale, 10, 100, 0.1);
    s += textScore(r.reasoningWhyStandard, 10, 100, 0.1);
    if (r.reasoningSources && r.reasoningSources.length > 0) {
      s += Math.min(0.06, r.reasoningSources.length * 0.02);
    }
    if (r.usageGuide && r.usageGuide !== md) {
      s += textScore(r.usageGuide, 20, 200, 0.05);
    }

    // depthCoverage：只认接地的深度维度（权重 0.44，覆盖 ≥3 维给满）。
    const verificationText = r.contentVerification
      ? [r.contentVerification.method, r.contentVerification.expected_result]
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .join('\n')
      : undefined;
    const review = reviewRecipeDepth(
      {
        markdown: md,
        boundaries: r.constraintsBoundaries,
        preconditions: r.constraintsPreconditions,
        sideEffects: r.constraintsSideEffects,
        verification: verificationText,
        alternatives: r.reasoningAlternatives,
      },
      { validSourcePaths: r.groundedSourcePaths ?? [] }
    );
    s += Math.min(1, review.grounded.length / 3) * 0.44;

    return Math.min(1, s);
  }

  /**
   * 交付就绪度 (0-1)
   * trigger 格式 + language 合法性 + 分类 + 标签
   */
  #scoreDeliveryReady(r: RecipeInput) {
    let s = 0;

    // trigger 格式
    if (r.trigger) {
      const valid =
        /^[a-zA-Z0-9_\-:.@]+$/.test(r.trigger) && r.trigger.length >= 2 && r.trigger.length <= 80;
      s += valid ? 0.25 : r.trigger.length >= 2 ? 0.15 : 0;
    }

    // language 合法性
    if (r.language) {
      s += LanguageProfiles.validCodeLanguages.has(r.language.toLowerCase()) ? 0.25 : 0.1;
    }

    // category
    s += presenceScore(r.category, 0.2);

    // tags 丰富度
    if (r.tags && r.tags.length > 0) {
      s += Math.min(0.15, r.tags.length * 0.04);
    }

    // headers (语言相关导入声明)
    if (r.headers && r.headers.length > 0) {
      s += Math.min(0.15, r.headers.length * 0.05);
    }

    return Math.min(1, s);
  }

  /**
   * 可操作性 (0-1)
   * AI agent 能否基于此知识有效行动
   */
  #scoreActionability(r: RecipeInput) {
    let s = 0;
    const code = r.coreCode || '';
    const md = r.contentMarkdown || r.usageGuide || '';

    // 具体代码示例
    const codeLen = code.trim().length;
    if (codeLen >= 30 && codeLen <= 500) {
      s += 0.3;
    } else if (codeLen >= 10) {
      s += 0.2;
    } else if (/```[\s\S]{10,}?```/.test(md)) {
      s += 0.2;
    }

    // doClause 具体度
    if (r.doClause) {
      const len = r.doClause.trim().length;
      s += len >= 15 && len <= 200 ? 0.25 : len >= 5 ? 0.1 : 0;
    }

    // 正反约束（do + don't → 引导更精确）
    if (r.doClause?.trim() && r.dontClause?.trim()) {
      s += 0.2;
    } else if (r.doClause?.trim()) {
      s += 0.1;
    }

    // whenClause 具体度
    if (r.whenClause) {
      const len = r.whenClause.trim().length;
      s += len >= 15 ? 0.25 : len >= 5 ? 0.1 : 0;
    }

    return Math.min(1, s);
  }

  /**
   * 溯源可信度 (0-1)
   * 知识的可追溯性和可信度
   */
  #scoreProvenance(r: RecipeInput) {
    let s = 0;

    // AI confidence (0-1 → 0-0.30)
    if (r.reasoningConfidence != null && r.reasoningConfidence > 0) {
      s += r.reasoningConfidence * 0.3;
    }

    // 来源文件引用
    if (r.reasoningSources && r.reasoningSources.length > 0) {
      s += Math.min(0.3, r.reasoningSources.length * 0.1);
    }

    // 来源类型 (manual > mcp > bootstrap)
    if (r.source === 'manual') {
      s += 0.2;
    } else if (r.source === 'mcp') {
      s += 0.15;
    } else if (r.source === 'bootstrap' || r.source === 'cursor-scan') {
      s += 0.1;
    }

    // usage authority (0-5 → 0-0.20)
    if (r.rating && r.rating > 0) {
      s += (r.rating / 5) * 0.2;
    }

    return Math.min(1, s);
  }

  /** 分数转等级 */
  #toGrade(score: number) {
    if (score >= QUALITY_GRADES.A) {
      return 'A';
    }
    if (score >= QUALITY_GRADES.B) {
      return 'B';
    }
    if (score >= QUALITY_GRADES.C) {
      return 'C';
    }
    if (score >= QUALITY_GRADES.D) {
      return 'D';
    }
    return 'F';
  }
}
